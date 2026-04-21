import { Injectable, Logger } from '@nestjs/common';
import { getMothershipPoolDefinition } from '@uv/game-systems';

import { AnthropicService } from '../anthropic/anthropic.service';
import { CampaignRepository } from '../campaign/campaign.repository';

import { applyToCampaignState } from './session.applier';
import { buildCorrectionRequest } from './session.correction';
import { buildSessionRequest } from './session.prompt';
import { SessionRepository } from './session.repository';
import { submitGmResponseSchema } from './session.schema';
import { buildStateSnapshot } from './session.snapshot';
import { buildAdventureTelemetryPayload } from './session.telemetry';
import { SESSION_TOOLS } from './session.tools';
import { validateStateChanges } from './session.validator';
import { buildMessageWindow } from './session.window';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { SubmitGmResponse } from './session.schema';
import type { CampaignStateData, GmContextBlob } from './session.snapshot';
import type {
  ThresholdCrossing,
  ValidationRejection,
  ValidationResult,
} from './session.validator';
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
  playerUserId: string;
  playerMessage: string;
}

export interface SendMessageResult {
  message: DbMessage;
  applied: ValidationResult['applied'];
  thresholds: ThresholdCrossing[];
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly repo: SessionRepository,
    private readonly anthropic: AnthropicService,
    private readonly campaignRepo: CampaignRepository,
  ) {}

  async sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
    // 1. Preconditions.
    const [rawBlob, rawState, playerEntityIds, priorMessages] =
      await Promise.all([
        this.repo.getGmContextBlob(args.adventureId),
        this.campaignRepo.getStateData(args.campaignId),
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
    const windowMessages = buildMessageWindow(priorMessages);

    // 2. Persist the incoming player message OUTSIDE the atomic turn
    //    transaction. A retry after any downstream failure can still
    //    reproduce the action without re-typing.
    await this.repo.insertMessage({
      adventureId: args.adventureId,
      role: 'player',
      content: args.playerMessage,
    });

    // 3. Build prompt; call Claude; parse tool call.
    const request = buildSessionRequest({
      gmContextBlob,
      campaignStateData,
      windowMessages,
      playerMessage: args.playerMessage,
      tools: SESSION_TOOLS,
    });
    const { response: originalResponse, parsed: originalParsed } =
      await this.callClaudeOnce(request, args.adventureId);

    // 4. Validate first-round state changes.
    let validation = validateStateChanges({
      proposed: originalParsed.stateChanges,
      currentData: campaignStateData,
      poolDef: getMothershipPoolDefinition,
    });

    const firstRoundRejections = validation.rejections;
    let correctionResponse: Anthropic.Message | undefined;
    let correctionParsed: SubmitGmResponse | undefined;

    // 5. One correction round on rejections. Failed correction ⇒ hard 502.
    if (firstRoundRejections.length > 0) {
      const correctionRequest = buildCorrectionRequest({
        originalRequest: request,
        originalAssistant: originalResponse,
        rejections: firstRoundRejections,
      });
      const { response, parsed } = await this.callClaudeOnce(
        correctionRequest,
        args.adventureId,
      );
      correctionResponse = response;
      correctionParsed = parsed;

      validation = validateStateChanges({
        proposed: parsed.stateChanges,
        currentData: campaignStateData,
        poolDef: getMothershipPoolDefinition,
      });

      if (validation.rejections.length > 0) {
        throw new SessionCorrectionError(
          `Correction round rejected for adventure=${args.adventureId}`,
          firstRoundRejections,
          validation.rejections,
        );
      }
    }

    // 6. Compute the final state by merging applied deltas.
    const finalState = applyToCampaignState({
      currentData: campaignStateData,
      applied: validation.applied,
    });

    // 7. Telemetry payload — keyed by convention to the original
    //    `gm_response` sequence, even on a correction turn.
    const snapshotSent = buildStateSnapshot({
      gmContextBlob,
      campaignStateData,
    });
    const telemetryPayload = buildAdventureTelemetryPayload({
      playerMessage: args.playerMessage,
      snapshotSent,
      originalRequest: request,
      originalResponse,
      originalParsed,
      correction: correctionResponse
        ? {
            rejections: firstRoundRejections,
            response: correctionResponse,
            parsed: correctionParsed!,
          }
        : undefined,
      applied: validation.applied,
      thresholds: validation.thresholds,
    });

    // 8. The final narration sent to the player is always the corrected
    //    text when a correction fired, otherwise the original.
    const finalParsed = correctionParsed ?? originalParsed;

    // 9. Bundle every write into one transaction.
    //    Phase 1 hardcodes autoPromoteCanon = true (every campaign is Solo
    //    Blind). Phase 2 introduces `campaign.creation_mode` and this becomes
    //    `creationMode === 'solo_blind'`.
    const result = await this.repo.applyTurnAtomic({
      adventureId: args.adventureId,
      campaignId: args.campaignId,
      playerUserId: args.playerUserId,
      campaignStateData: finalState,
      playerAction: { content: args.playerMessage },
      gmResponse: originalParsed,
      correction: correctionParsed,
      applied: validation.applied,
      thresholds: validation.thresholds,
      proposedCanon: finalParsed.gmUpdates?.proposedCanon ?? [],
      npcStates: finalParsed.gmUpdates?.npcStates ?? {},
      gmText: finalParsed.playerText,
      telemetryPayload,
      autoPromoteCanon: true,
    });

    return {
      message: result.persistedMessage,
      applied: validation.applied,
      thresholds: validation.thresholds,
    };
  }

  /**
   * Returns the full chronological message log for an adventure, for the
   * frontend play view to render on mount. Roles are mapped to the same
   * wire-format the POST response uses: `player → user`, `gm → assistant`,
   * `system → system`.
   */
  async listMessages(adventureId: string): Promise<
    Array<{
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: string;
    }>
  > {
    const rows = await this.repo.getMessagesAsc(adventureId);
    return rows.map((m) => ({
      id: m.id,
      role:
        m.role === 'player' ? 'user' : m.role === 'gm' ? 'assistant' : 'system',
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  private async callClaudeOnce(
    request: CallSessionParams,
    adventureId: string,
  ): Promise<{ response: Anthropic.Message; parsed: SubmitGmResponse }> {
    const response = await this.anthropic.callSession(request);
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === 'submit_gm_response',
    );
    if (!toolUse) {
      throw new SessionOutputError(
        `Claude did not call submit_gm_response for adventure=${adventureId}`,
      );
    }
    const parsed = submitGmResponseSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new SessionOutputError(
        `submit_gm_response failed validation for adventure=${adventureId}: ${parsed.error.message}`,
      );
    }
    return { response, parsed: parsed.data };
  }
}
