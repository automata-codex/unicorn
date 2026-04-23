import { Injectable, Logger } from '@nestjs/common';
import { getMothershipPoolDefinition } from '@uv/game-systems';

import { AnthropicService } from '../anthropic/anthropic.service';
import { CampaignRepository } from '../campaign/campaign.repository';
import { DiceService } from '../dice/dice.service';
import { RulesLookupService } from '../rules/rules-lookup.service';

import { parseDiceNotation } from '@uv/game-systems';

import { applyToCampaignState } from './session.applier';
import { buildCorrectionRequest } from './session.correction';
import { insertDiceRollEvent, nextSequenceNumber } from './session.events';
import { buildSessionRequest } from './session.prompt';
import { SessionRepository } from './session.repository';
import {
  rollDiceInputSchema,
  rulesLookupInputSchema,
  submitGmResponseSchema,
} from './session.schema';

import type { DiceResultAction } from './session.schema';
import { buildStateSnapshot } from './session.snapshot';
import { SESSION_TOOLS } from './session.tools';
import { validateStateChanges } from './session.validator';
import { buildMessageWindow } from './session.window';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { PendingSystemRoll } from './session.events';
import type {
  DiceRequestInput,
  DiceRequestRow,
} from './session.repository';
import type { SubmitGmResponse } from './session.schema';
import type { CampaignStateData, GmContextBlob } from './session.snapshot';
import type { RulesLookupRecord } from './session.telemetry';
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

/**
 * Thrown when the inner tool-use loop hits its iteration cap without
 * receiving a `submit_gm_response` tool call. Indicates Claude is stuck —
 * either looping on rules_lookup or issuing rolls indefinitely. Translated
 * to 502 with body error code `gm_tool_loop_exhausted`.
 */
export class SessionToolLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionToolLoopError';
  }
}

/**
 * Thrown when a submitted `diceResult` cannot be applied to a known pending
 * dice_request — unknown id, already-resolved, cancelled, or scoped to a
 * different adventure. Translated to 409 by the controller.
 */
export class DiceResultConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceResultConflictError';
  }
}

/**
 * Thrown when a submitted `diceResult` fails shape validation against the
 * persisted dice_request — notation mismatch or results that don't match
 * the parsed count / per-die range. Translated to 422 by the controller.
 */
export class DiceResultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceResultValidationError';
  }
}

/**
 * Thrown when narrative submission is attempted while any dice_request for
 * the adventure is still `pending`. Carries the pending request ids so the
 * client can show them in the response. Translated to 409 with body error
 * code `dice_pending` by the controller.
 */
export class DicePendingError extends Error {
  constructor(
    message: string,
    public readonly pendingRequestIds: string[],
  ) {
    super(message);
    this.name = 'DicePendingError';
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
  /** Backend-assigned player dice prompts issued by this turn. */
  diceRequests: DiceRequestRow[];
}

/**
 * Cap on inner tool-loop iterations. A typical turn is zero or one
 * rules_lookup plus zero to two dice rolls. Hitting this cap means Claude is
 * pathologically looping — we'd rather fail hard than spin up Claude cost
 * indefinitely.
 */
export const INNER_TOOL_LOOP_CAP = 8;

interface InnerToolLoopResult {
  finalRequest: CallSessionParams;
  finalResponse: Anthropic.Message;
  finalParsed: SubmitGmResponse;
  executedRolls: PendingSystemRoll[];
  rulesLookups: RulesLookupRecord[];
  iterations: number;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly repo: SessionRepository,
    private readonly anthropic: AnthropicService,
    private readonly campaignRepo: CampaignRepository,
    private readonly dice: DiceService,
    private readonly rules: RulesLookupService,
  ) {}

  async sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
    // 0. Hard block: if any dice_request is still pending, refuse narrative
    //    submission. The controller translates this to 409 with body
    //    `{ error: 'dice_pending', pendingRequestIds }`. Frontend blocks this
    //    UI-side too (Part 13); this is the server-side invariant.
    const stillPending = await this.repo.pendingDiceRequestsForAdventure(
      args.adventureId,
    );
    if (stillPending.length > 0) {
      throw new DicePendingError(
        `dice_requests pending for adventure=${args.adventureId}`,
        stillPending.map((r) => r.id),
      );
    }

    // 1. Preconditions.
    const [rawBlob, rawState, playerEntityIds, priorMessages, resolvedPlayerRolls] =
      await Promise.all([
        this.repo.getGmContextBlob(args.adventureId),
        this.campaignRepo.getStateData(args.campaignId),
        this.repo.getPlayerEntityIds(args.campaignId),
        this.repo.getMessagesAsc(args.adventureId),
        this.repo.playerDiceRollsSinceLastGmResponse(args.adventureId),
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
    //
    //    Empty `playerMessage` means the turn was auto-advanced from a
    //    dice-result submission (see submitDiceResult with autoAdvance):
    //    the [Dice results] block is the implicit turn input, so there's
    //    no player message to persist or render.
    if (args.playerMessage.length > 0) {
      await this.repo.insertMessage({
        adventureId: args.adventureId,
        role: 'player',
        content: args.playerMessage,
      });
    }

    // 3. Resolve the active system for rules_lookup filtering. Pre-loop so a
    //    missing game_system row fails before we spend on Claude.
    const systemId = await this.campaignRepo.getSystemId(args.campaignId);
    if (!systemId) {
      throw new SessionPreconditionError(
        `game_system missing for campaign=${args.campaignId}`,
      );
    }

    // 4. Build prompt; run the inner tool loop until submit_gm_response.
    //    `resolvedPlayerRolls` carries any player-entered dice outcomes that
    //    landed between the last gm_response and this turn; the prompt
    //    builder renders them as a synthetic `[Dice results]` block before
    //    the narrative input.
    const request = buildSessionRequest({
      gmContextBlob,
      campaignStateData,
      windowMessages,
      playerMessage: args.playerMessage,
      resolvedPlayerRolls,
      tools: SESSION_TOOLS,
    });
    const innerLoop = await this.runInnerToolLoop({
      initialRequest: request,
      systemId,
      adventureId: args.adventureId,
    });
    const originalResponse = innerLoop.finalResponse;
    const originalParsed = innerLoop.finalParsed;

    // 5. Validate first-round state changes.
    let validation = validateStateChanges({
      proposed: originalParsed.stateChanges,
      currentData: campaignStateData,
      poolDef: getMothershipPoolDefinition,
    });

    const firstRoundRejections = validation.rejections;
    let correctionResponse: Anthropic.Message | undefined;
    let correctionParsed: SubmitGmResponse | undefined;

    // 6. One correction round on rejections — single-shot, no inner loop.
    //    Per docs/decisions.md, the correction path must not re-invoke
    //    roll_dice / rules_lookup. Rolls are inputs, not retry levers.
    //    buildCorrectionRequest forces tool_choice back to submit_gm_response.
    if (firstRoundRejections.length > 0) {
      const correctionRequest = buildCorrectionRequest({
        originalRequest: innerLoop.finalRequest,
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

    // 7. Snapshot the prompt that was sent — stored in telemetry for
    //    playtest replay. Keyed by convention to the original `gm_response`
    //    sequence, even on a correction turn.
    const snapshotSent = buildStateSnapshot({
      gmContextBlob,
      campaignStateData,
    });

    // 8. Materialize player-entered pre-turn rolls as ExecutedRollRecord.
    //    These already carry real sequence numbers from the diceResult
    //    transactions that wrote them; system-generated rolls from this
    //    turn's inner loop get their seqs inside applyTurnAtomic.
    const preTurnPlayerRolls = resolvedPlayerRolls.map((r) => ({
      source: 'player_entered' as const,
      sequenceNumber: r.sequenceNumber,
      notation: r.notation,
      purpose: r.purpose,
      results: r.results,
      modifier: r.modifier,
      total: r.total,
      requestId: r.requestId,
    }));

    // 9. The final narration sent to the player is always the corrected
    //    text when a correction fired, otherwise the original.
    const finalParsed = correctionParsed ?? originalParsed;

    // 10. Bundle every write into one transaction.
    //     Phase 1 hardcodes autoPromoteCanon = true (every campaign is Solo
    //     Blind). Phase 2 introduces `campaign.creation_mode` and this becomes
    //     `creationMode === 'solo_blind'`.
    //
    //     Dice requests surfaced on the final submit_gm_response (whether
    //     from the original or the correction) are persisted here — Claude
    //     never supplies ids, the backend assigns them.
    const diceRequestInputs: DiceRequestInput[] = (
      finalParsed.diceRequests ?? []
    ).map((r) => ({
      notation: r.notation,
      purpose: r.purpose,
      target: r.target ?? null,
    }));

    const result = await this.repo.applyTurnAtomic({
      adventureId: args.adventureId,
      campaignId: args.campaignId,
      playerUserId: args.playerUserId,
      campaignStateData: finalState,
      playerAction: { content: args.playerMessage },
      executedRolls: innerLoop.executedRolls,
      gmResponse: originalParsed,
      correction: correctionParsed,
      applied: validation.applied,
      thresholds: validation.thresholds,
      proposedCanon: finalParsed.gmUpdates?.proposedCanon ?? [],
      npcStates: finalParsed.gmUpdates?.npcStates ?? {},
      diceRequests: diceRequestInputs,
      gmText: finalParsed.playerText,
      telemetry: {
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
        preTurnPlayerRolls,
        rulesLookups: innerLoop.rulesLookups,
        toolLoopIterations: innerLoop.iterations,
      },
      autoPromoteCanon: true,
    });

    return {
      message: result.persistedMessage,
      applied: validation.applied,
      thresholds: validation.thresholds,
      diceRequests: result.persistedDiceRequests,
    };
  }

  /**
   * Apply a player-submitted dice result to the adventure. Validates the
   * submission against the persisted dice_request, then writes a `dice_roll`
   * event (`roll_source` mirrors the client path) and flips the request to
   * `resolved` atomically. By default does not call Claude — the result is
   * folded into the next narrative turn's prompt via
   * `playerDiceRollsSinceLastGmResponse` in `buildSessionRequest`.
   *
   * When `submission.autoAdvance` is true and this submission resolves the
   * last pending dice_request for the adventure, immediately runs a fresh
   * Claude turn with no narrative input — the `[Dice results]` block is the
   * only new user message. Mirrors the TTRPG beat where a player reporting
   * a roll prompts the GM to narrate the outcome.
   *
   * Errors:
   *   - `DiceResultConflictError` (→ 409): unknown request, already resolved,
   *     or scoped to a different adventure.
   *   - `DiceResultValidationError` (→ 422): notation mismatch, wrong number
   *     of results, or a result outside the per-die range.
   *   - Any error surfaced by `sendMessage` when the auto-advance branch
   *     runs — the dice_request is already resolved at that point, so
   *     callers can retry via the narrative endpoint.
   */
  async submitDiceResult(args: {
    adventureId: string;
    campaignId: string;
    actorUserId: string;
    submission: DiceResultAction;
  }): Promise<{
    requestId: string;
    accepted: true;
    pendingRequestIds: string[];
    turn?: SendMessageResult;
  }> {
    const request = await this.repo.loadDiceRequest(args.submission.requestId);
    if (
      !request ||
      request.status !== 'pending' ||
      request.adventureId !== args.adventureId
    ) {
      throw new DiceResultConflictError(
        `No pending dice_request ${args.submission.requestId} for adventure=${args.adventureId}`,
      );
    }

    // Defensive: the client echoes the notation for audit. A mismatch means
    // the client has drifted from the request — refuse rather than silently
    // applying a different roll.
    if (request.notation !== args.submission.notation) {
      throw new DiceResultValidationError(
        `notation mismatch: request=${request.notation}, submitted=${args.submission.notation}`,
      );
    }

    let parsed;
    try {
      parsed = parseDiceNotation(request.notation);
    } catch (err) {
      // A persisted request with un-parseable notation would be a data bug
      // in the writer, not a client error. Surface as validation so the
      // request can't deadlock the adventure.
      const message = err instanceof Error ? err.message : String(err);
      throw new DiceResultValidationError(
        `persisted notation is unparseable: ${message}`,
      );
    }

    if (args.submission.results.length !== parsed.count) {
      throw new DiceResultValidationError(
        `expected ${parsed.count} result(s) for ${request.notation}, got ${args.submission.results.length}`,
      );
    }
    for (const value of args.submission.results) {
      if (value < 1 || value > parsed.sides) {
        throw new DiceResultValidationError(
          `result ${value} out of range [1, ${parsed.sides}] for ${request.notation}`,
        );
      }
    }

    // Player-entered rolls are raw face values; modifiers are applied elsewhere
    // (character sheet integration) per docs/zoltar-design-doc.md § Raw rolls
    // only. Total = sum of faces.
    const total = args.submission.results.reduce((a, b) => a + b, 0);

    await this.repo.applyDiceResultAtomic({
      adventureId: args.adventureId,
      campaignId: args.campaignId,
      requestId: request.id,
      actorUserId: args.actorUserId,
      source: args.submission.source,
      payload: {
        notation: request.notation,
        purpose: request.purpose,
        results: args.submission.results,
        modifier: 0,
        total,
      },
    });

    const stillPending = await this.repo.pendingDiceRequestsForAdventure(
      args.adventureId,
    );
    const pendingRequestIds = stillPending.map((r) => r.id);

    // Auto-advance: if the client asked us to continue the turn and there are
    // no other outstanding prompts, run a fresh Claude turn immediately with
    // no narrative input. The [Dice results] block is the implicit turn
    // input, fetched by `sendMessage` via playerDiceRollsSinceLastGmResponse.
    if (args.submission.autoAdvance && pendingRequestIds.length === 0) {
      const turn = await this.sendMessage({
        adventureId: args.adventureId,
        campaignId: args.campaignId,
        playerUserId: args.actorUserId,
        playerMessage: '',
      });
      return {
        requestId: request.id,
        accepted: true,
        pendingRequestIds,
        turn,
      };
    }

    return {
      requestId: request.id,
      accepted: true,
      pendingRequestIds,
    };
  }

  /**
   * Pending dice_requests for the adventure, surfaced to the client on
   * bootstrap and used to guard narrative submissions. Delegates to the repo
   * so callers don't need to know about dice_request internals.
   */
  async getPendingDiceRequests(
    adventureId: string,
  ): Promise<
    Array<{ id: string; notation: string; purpose: string; target: number | null }>
  > {
    const rows = await this.repo.pendingDiceRequestsForAdventure(adventureId);
    return rows.map((r) => ({
      id: r.id,
      notation: r.notation,
      purpose: r.purpose,
      target: r.target,
    }));
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

  /**
   * All `dice_roll` events for an adventure, wire-formatted for the play view.
   * Surfaces the info the FE needs to render a `DiceRollBubble`: source,
   * notation, results, total, optional target (for player-entered rolls
   * resolving a dice_request in soft_accountability mode).
   */
  async listDiceRolls(adventureId: string): Promise<
    Array<{
      id: string;
      sequenceNumber: number;
      createdAt: string;
      source: 'system_generated' | 'player_entered';
      notation: string;
      purpose: string;
      results: number[];
      total: number;
      target: number | null;
    }>
  > {
    const rows = await this.repo.listDiceRollEvents(adventureId);
    return rows.map((r) => ({
      id: r.id,
      sequenceNumber: r.sequenceNumber,
      createdAt: r.createdAt.toISOString(),
      source: r.source,
      notation: r.notation,
      purpose: r.purpose,
      results: r.results,
      total: r.total,
      target: r.target,
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

  /**
   * Inner tool-use loop: keep calling Claude until `submit_gm_response`
   * arrives, routing any intervening `roll_dice` / `rules_lookup` calls
   * through their respective services and feeding the results back to
   * Claude as tool_results on the next iteration.
   *
   * Dice rolls executed here are collected in memory and returned to the
   * caller, which persists them atomically alongside the other turn events
   * once `submit_gm_response` is accepted. `rules_lookup` calls are captured
   * in telemetry only — lookups are metadata about how Claude arrived at a
   * decision, not state-changing events (see docs/decisions.md).
   *
   * Bounded by INNER_TOOL_LOOP_CAP — exhaustion throws SessionToolLoopError,
   * mapped to HTTP 502 `gm_tool_loop_exhausted`.
   */
  async runInnerToolLoop(args: {
    initialRequest: CallSessionParams;
    systemId: string;
    adventureId: string;
  }): Promise<InnerToolLoopResult> {
    let request = args.initialRequest;
    let iteration = 0;
    const executedRolls: PendingSystemRoll[] = [];
    const rulesLookups: RulesLookupRecord[] = [];

    while (iteration < INNER_TOOL_LOOP_CAP) {
      const response = await this.anthropic.callSession(request);

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      // Happy path: Claude called submit_gm_response. A single assistant
      // turn may carry other tool_use blocks alongside it; per spec the
      // presence of submit_gm_response terminates the loop immediately.
      const submitGmCall = toolUses.find((t) => t.name === 'submit_gm_response');
      if (submitGmCall) {
        const parsed = submitGmResponseSchema.safeParse(submitGmCall.input);
        if (!parsed.success) {
          throw new SessionOutputError(
            `submit_gm_response failed validation for adventure=${args.adventureId}: ${parsed.error.message}`,
          );
        }
        return {
          finalRequest: request,
          finalResponse: response,
          finalParsed: parsed.data,
          executedRolls,
          rulesLookups,
          iterations: iteration + 1,
        };
      }

      if (toolUses.length === 0) {
        throw new SessionOutputError(
          `Claude returned no tool_use block for adventure=${args.adventureId}`,
        );
      }

      // Execute each intervening tool call and accumulate tool_result blocks.
      const toolResultBlocks: Anthropic.ContentBlockParam[] = [];
      for (const use of toolUses) {
        if (use.name === 'roll_dice') {
          toolResultBlocks.push(
            await this.handleRollDice(use, executedRolls, args.adventureId),
          );
          continue;
        }
        if (use.name === 'rules_lookup') {
          toolResultBlocks.push(
            await this.handleRulesLookup(
              use,
              rulesLookups,
              args.systemId,
              args.adventureId,
            ),
          );
          continue;
        }
        // Unknown tool name: most likely a hallucination. Hand Claude an
        // error tool_result rather than throwing so it has a chance to
        // recover.
        this.logger.warn(
          `Unknown tool call from Claude for adventure=${args.adventureId}: ${use.name}`,
        );
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: `Unknown tool: ${use.name}`,
        });
      }

      // Append the assistant turn + tool_result user turn, loop.
      request = {
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResultBlocks },
        ],
      };
      iteration++;
    }

    throw new SessionToolLoopError(
      `Inner tool loop did not terminate within ${INNER_TOOL_LOOP_CAP} iterations for adventure=${args.adventureId}`,
    );
  }

  private async handleRollDice(
    use: Anthropic.ToolUseBlock,
    executedRolls: PendingSystemRoll[],
    adventureId: string,
  ): Promise<Anthropic.ContentBlockParam> {
    const parsed = rollDiceInputSchema.safeParse(use.input);
    if (!parsed.success) {
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: true,
        content: `Invalid roll_dice input: ${parsed.error.message}`,
      };
    }
    try {
      const result = this.dice.rollForGm(parsed.data);
      executedRolls.push({
        notation: result.notation,
        purpose: parsed.data.purpose,
        results: result.results,
        modifier: result.modifier,
        total: result.total,
      });
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `roll_dice failed for adventure=${adventureId}: ${message}`,
      );
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: true,
        content: message,
      };
    }
  }

  private async handleRulesLookup(
    use: Anthropic.ToolUseBlock,
    rulesLookups: RulesLookupRecord[],
    systemId: string,
    adventureId: string,
  ): Promise<Anthropic.ContentBlockParam> {
    const parsed = rulesLookupInputSchema.safeParse(use.input);
    if (!parsed.success) {
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: true,
        content: `Invalid rules_lookup input: ${parsed.error.message}`,
      };
    }
    try {
      const result = await this.rules.lookup(systemId, parsed.data);
      rulesLookups.push({
        query: parsed.data.query,
        limit: parsed.data.limit ?? 3,
        resultCount: result.results.length,
        topSimilarity: result.results[0]?.similarity ?? null,
        sources: result.results.map((r) => r.source),
      });
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `rules_lookup failed for adventure=${adventureId}: ${message}`,
      );
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: true,
        content: message,
      };
    }
  }
}
