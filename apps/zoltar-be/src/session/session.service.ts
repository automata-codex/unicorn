import { Injectable, Logger } from '@nestjs/common';

import { AnthropicService } from '../anthropic/anthropic.service';

import { buildSessionRequest } from './session.prompt';
import { SessionRepository } from './session.repository';
import { submitGmResponseSchema } from './session.schema';
import { SESSION_TOOLS } from './session.tools';
import { buildMessageWindow } from './session.window';

import type Anthropic from '@anthropic-ai/sdk';
import type { SubmitGmResponse } from './session.schema';
import type { CampaignStateData, GmContextBlob } from './session.snapshot';
import type { ValidationRejection } from './session.validator';
import type { DbMessage } from './session.window';

/**
 * Thrown when Claude's response can't be coerced into a `submit_gm_response`
 * payload — missing tool_use block, schema validation failure, etc. The
 * controller translates this to 502.
 */
export class SessionOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionOutputError';
  }
}

/**
 * Thrown when the repository can't produce the inputs the turn loop needs —
 * adventure exists but no GM context / campaign state row has been persisted.
 * The controller translates this to 409; it means synthesis wasn't actually
 * completed despite `adventure.status = 'ready'`, which would be a data bug.
 */
export class SessionPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionPreconditionError';
  }
}

/**
 * Thrown when Claude's corrected response (after a validator-rejection
 * re-prompt) also fails validation. Carries both rejection rounds so the
 * controller / telemetry can surface what went wrong. Translated to 502 with
 * body error code `gm_correction_failed`.
 */
export class SessionCorrectionError extends Error {
  constructor(
    message: string,
    public readonly firstRoundRejections: ValidationRejection[],
    public readonly secondRoundRejections: ValidationRejection[],
  ) {
    super(message);
    this.name = 'SessionCorrectionError';
  }
}

export interface SendMessageArgs {
  adventureId: string;
  campaignId: string;
  playerMessage: string;
}

export interface SendMessageResult {
  message: DbMessage;
  proposals: SubmitGmResponse;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly repo: SessionRepository,
    private readonly anthropic: AnthropicService,
  ) {}

  async sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
    // 1. Load context, state, player entity ids, and message history.
    const [rawBlob, rawState, playerEntityIds, priorMessages] =
      await Promise.all([
        this.repo.getGmContextBlob(args.adventureId),
        this.repo.getCampaignStateData(args.campaignId),
        this.repo.getPlayerEntityIds(args.campaignId),
        this.repo.getMessagesAsc(args.adventureId),
      ]);

    if (!rawBlob) {
      throw new SessionPreconditionError(
        `gm_context missing for adventure=${args.adventureId}`,
      );
    }
    if (!rawState) {
      throw new SessionPreconditionError(
        `campaign_state missing for campaign=${args.campaignId}`,
      );
    }

    const gmContextBlob: GmContextBlob = {
      ...(rawBlob as GmContextBlob),
      playerEntityIds,
    };
    const campaignStateData = rawState as CampaignStateData;

    // 2. Build the rolling window before persisting the player message.
    const windowMessages = buildMessageWindow(priorMessages);

    // 3. Persist the incoming player message. Intentionally persisted before
    //    the Anthropic call — the player's input is a valid action even if
    //    the response generation fails. A retry affordance is M6's job.
    await this.repo.insertMessage({
      adventureId: args.adventureId,
      role: 'player',
      content: args.playerMessage,
    });

    // 4. Assemble the prompt.
    const request = buildSessionRequest({
      gmContextBlob,
      campaignStateData,
      windowMessages,
      playerMessage: args.playerMessage,
      tools: SESSION_TOOLS,
    });

    // 5. Call Claude with forced tool choice.
    const message = await this.anthropic.callSession(request);

    // 6. Extract the tool_use block.
    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === 'submit_gm_response',
    );
    if (!toolUse) {
      throw new SessionOutputError(
        `Claude did not call submit_gm_response for adventure=${args.adventureId}`,
      );
    }

    // 7. Validate against the schema.
    const parsed = submitGmResponseSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new SessionOutputError(
        `submit_gm_response failed validation for adventure=${args.adventureId}: ${parsed.error.message}`,
      );
    }
    const proposals = parsed.data;

    // 8. Persist the GM narration as an assistant message.
    const persisted = await this.repo.insertMessage({
      adventureId: args.adventureId,
      role: 'gm',
      content: proposals.playerText,
    });

    // 9. Return the persisted GM message + the full parsed proposal payload.
    //    stateChanges, proposedCanon, game_events, telemetry — all M6.
    return { message: persisted, proposals };
  }
}
