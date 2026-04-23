import { AnthropicError } from '@anthropic-ai/sdk';
import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';

import { AdventureService } from '../adventure/adventure.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import {
  diceResultActionSchema,
  type DiceResultAction,
} from './session.schema';
import {
  DicePendingError,
  DiceResultConflictError,
  DiceResultValidationError,
  SessionCorrectionError,
  SessionOutputError,
  SessionPreconditionError,
  SessionService,
  SessionToolLoopError,
} from './session.service';

import { z } from 'zod';

import type { AuthUser } from '@uv/auth-core';
import type { SendMessageResult } from './session.service';

const messagesRequestSchema = z.object({
  content: z.string().min(1),
});
type MessagesRequestDto = z.infer<typeof messagesRequestSchema>;

interface TurnPayload {
  message: {
    id: string;
    role: 'assistant';
    content: string;
    createdAt: string;
  };
  applied: SendMessageResult['applied'];
  thresholds: SendMessageResult['thresholds'];
  /** Player dice prompts issued by this turn. Empty array if none. */
  diceRequests: Array<{
    id: string;
    notation: string;
    purpose: string;
    target: number | null;
  }>;
}

type MessagesResponse = TurnPayload;

function serializeTurn(result: SendMessageResult): TurnPayload {
  return {
    message: {
      id: result.message.id,
      role: 'assistant',
      content: result.message.content,
      createdAt: result.message.createdAt.toISOString(),
    },
    applied: result.applied,
    thresholds: result.thresholds,
    diceRequests: result.diceRequests.map((r) => ({
      id: r.id,
      notation: r.notation,
      purpose: r.purpose,
      target: r.target,
    })),
  };
}

@Controller('campaigns/:campaignId/adventures/:adventureId')
@UseGuards(SessionGuard)
export class SessionController {
  private readonly logger = new Logger(SessionController.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly adventureService: AdventureService,
  ) {}

  @Get('messages')
  async listMessages(
    @Param('campaignId') campaignId: string,
    @Param('adventureId') adventureId: string,
    @CurrentUser() user: AuthUser,
  ) {
    // assertMember is baked into adventureService.findById.
    await this.adventureService.findById(campaignId, adventureId, user.id);
    const [messages, pendingDiceRequests] = await Promise.all([
      this.sessionService.listMessages(adventureId),
      this.sessionService.getPendingDiceRequests(adventureId),
    ]);
    return { messages, pendingDiceRequests };
  }

  @Post('messages')
  async sendMessage(
    @Param('campaignId') campaignId: string,
    @Param('adventureId') adventureId: string,
    @Body(new ZodValidationPipe(messagesRequestSchema))
    dto: MessagesRequestDto,
    @CurrentUser() user: AuthUser,
  ): Promise<MessagesResponse> {
    const adventure = await this.adventureService.findById(
      campaignId,
      adventureId,
      user.id,
    );
    if (adventure.status !== 'ready' && adventure.status !== 'in_progress') {
      throw new ConflictException(
        `Adventure status must be "ready" or "in_progress", got "${adventure.status}"`,
      );
    }

    try {
      const result = await this.sessionService.sendMessage({
        adventureId,
        campaignId,
        playerUserId: user.id,
        playerMessage: dto.content,
      });

      return serializeTurn(result);
    } catch (err) {
      this.translateTurnError(err, adventureId);
    }
  }

  /**
   * Maps a `sendMessage`-surfaced error to an HTTP exception. Reused by
   * both `POST /messages` and the auto-advance branch of
   * `POST /dice-results`. Always throws; the `never` return is a hint to
   * callers that execution does not continue past this call.
   */
  private translateTurnError(err: unknown, adventureId: string): never {
    if (err instanceof DicePendingError) {
      this.logger.warn(
        `Narrative submission blocked (dice pending) for adventure=${adventureId}`,
      );
      throw new ConflictException({
        error: 'dice_pending',
        message:
          'Resolve the pending dice prompts before submitting a narrative action.',
        pendingRequestIds: err.pendingRequestIds,
      });
    }
    if (err instanceof SessionPreconditionError) {
      this.logger.warn(
        `Session precondition failed for adventure=${adventureId}: ${err.message}`,
      );
      throw new ConflictException(err.message);
    }
    if (err instanceof SessionCorrectionError) {
      this.logger.error(
        `GM correction failed for adventure=${adventureId}: ${err.message}`,
      );
      throw new BadGatewayException({
        error: 'gm_correction_failed',
        message:
          'GM re-narration was rejected by the validator. Try sending your action again.',
      });
    }
    if (err instanceof SessionToolLoopError) {
      this.logger.error(
        `GM tool loop exhausted for adventure=${adventureId}: ${err.message}`,
      );
      throw new BadGatewayException({
        error: 'gm_tool_loop_exhausted',
        message:
          'The GM is stuck in a tool-use loop. Try sending your action again.',
      });
    }
    if (err instanceof SessionOutputError) {
      this.logger.error(
        `Session output error for adventure=${adventureId}: ${err.message}`,
      );
      throw new BadGatewayException('GM response could not be parsed.');
    }
    if (err instanceof AnthropicError) {
      this.logger.error(
        `Anthropic SDK error for adventure=${adventureId}: ${err.message}`,
      );
      throw new BadGatewayException('GM service is unavailable.');
    }
    throw err;
  }

  /**
   * Player submits the result of a dice roll issued on a prior turn via
   * `submit_gm_response.diceRequests`. Writes a `dice_roll` event, flips the
   * `dice_request` to `resolved`, returns remaining pending ids.
   *
   * By default does NOT call Claude — the result folds into the next
   * narrative turn's prompt. When `autoAdvance: true` and this submission
   * resolves the last pending request, runs a fresh turn immediately and
   * includes the resulting narration under `turn` in the response; callers
   * can render the GM's reply without requiring the player to type first.
   *
   * Turn-level errors surfaced from the auto-advance branch (validator,
   * tool-loop cap, Anthropic failures, etc.) use the same mappings as
   * `POST /messages`. The dice_request is always resolved before the turn
   * fires, so failures here do not leave the request hanging — the caller
   * can retry via `POST /messages` if desired.
   */
  @Post('dice-results')
  async submitDiceResult(
    @Param('campaignId') campaignId: string,
    @Param('adventureId') adventureId: string,
    @Body(new ZodValidationPipe(diceResultActionSchema))
    submission: DiceResultAction,
    @CurrentUser() user: AuthUser,
  ): Promise<{
    requestId: string;
    accepted: true;
    pendingRequestIds: string[];
    turn?: TurnPayload;
  }> {
    // assertMember via findById; also confirms the adventure exists and
    // belongs to this campaign.
    await this.adventureService.findById(campaignId, adventureId, user.id);
    let result;
    try {
      result = await this.sessionService.submitDiceResult({
        adventureId,
        campaignId,
        actorUserId: user.id,
        submission,
      });
    } catch (err) {
      if (err instanceof DiceResultConflictError) {
        this.logger.warn(
          `Dice result rejected (conflict) for adventure=${adventureId}: ${err.message}`,
        );
        throw new ConflictException({
          error: 'dice_request_conflict',
          message: err.message,
        });
      }
      if (err instanceof DiceResultValidationError) {
        this.logger.warn(
          `Dice result rejected (validation) for adventure=${adventureId}: ${err.message}`,
        );
        throw new UnprocessableEntityException({
          error: 'dice_result_invalid',
          message: err.message,
        });
      }
      // Errors surfaced during the auto-advance turn share the /messages
      // mapping — gm_correction_failed, gm_tool_loop_exhausted, etc.
      this.translateTurnError(err, adventureId);
    }
    return {
      requestId: result.requestId,
      accepted: result.accepted,
      pendingRequestIds: result.pendingRequestIds,
      ...(result.turn ? { turn: serializeTurn(result.turn) } : {}),
    };
  }
}
