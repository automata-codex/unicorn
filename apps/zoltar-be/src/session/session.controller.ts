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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AdventureService } from '../adventure/adventure.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import {
  SessionCorrectionError,
  SessionOutputError,
  SessionPreconditionError,
  SessionService,
} from './session.service';

import type { AuthUser } from '@uv/auth-core';
import type { SendMessageResult } from './session.service';

const messagesRequestSchema = z.object({
  content: z.string().min(1),
});
type MessagesRequestDto = z.infer<typeof messagesRequestSchema>;

interface MessagesResponse {
  message: {
    id: string;
    role: 'assistant';
    content: string;
    createdAt: string;
  };
  applied: SendMessageResult['applied'];
  thresholds: SendMessageResult['thresholds'];
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
    const messages = await this.sessionService.listMessages(adventureId);
    return { messages };
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

      return {
        message: {
          id: result.message.id,
          role: 'assistant',
          content: result.message.content,
          createdAt: result.message.createdAt.toISOString(),
        },
        applied: result.applied,
        thresholds: result.thresholds,
      };
    } catch (err) {
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
            "GM re-narration was rejected by the validator. Try sending your action again.",
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
  }
}
