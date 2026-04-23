import { Inject, Injectable } from '@nestjs/common';
import { type MothershipCampaignState } from '@uv/game-systems';
import { and, asc, eq, sql } from 'drizzle-orm';

import { CanonRepository } from '../canon/canon.repository';
import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import {
  insertDiceRollEvent,
  nextSequenceNumber,
  writeTurnEvents,
  type PendingSystemRoll,
  type WrittenDiceRollRecord,
} from './session.events';
import {
  buildAdventureTelemetryPayload,
  writeAdventureTelemetry,
} from './session.telemetry';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { Db, DbOrTx } from '../db/db.provider';
import type { SubmitGmResponse } from './session.schema';
import type {
  ExecutedRollRecord,
  RulesLookupRecord,
} from './session.telemetry';
import type {
  ThresholdCrossing,
  ValidationRejection,
  ValidationResult,
} from './session.validator';
import type { DbMessage } from './session.window';

export interface DiceRequestRow {
  id: string;
  adventureId: string;
  issuedAtSequence: number;
  notation: string;
  purpose: string;
  target: number | null;
  status: 'pending' | 'resolved' | 'cancelled';
  resolvedAtSequence: number | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface DiceRequestInput {
  notation: string;
  purpose: string;
  target: number | null;
}

/**
 * Inputs for the turn-level telemetry row. Passed as raw data rather than a
 * pre-built `AdventureTelemetryPayload` because the payload's `diceRolls`
 * entries need real `sequence_number` values from this turn's inserts, which
 * only become known inside the atomic transaction.
 */
export interface TelemetryInputs {
  playerMessage: string;
  snapshotSent: string;
  originalRequest: CallSessionParams;
  originalResponse: Anthropic.Message;
  originalParsed: SubmitGmResponse;
  correction?: {
    rejections: ValidationRejection[];
    response: Anthropic.Message;
    parsed: SubmitGmResponse;
  };
  /** Player-entered rolls from before this turn, with real DB sequence numbers. */
  preTurnPlayerRolls: ExecutedRollRecord[];
  /** Lookups from the inner tool loop. */
  rulesLookups: RulesLookupRecord[];
  /** Inner tool-loop iteration count. */
  toolLoopIterations: number;
}

export interface ApplyTurnAtomicArgs {
  adventureId: string;
  campaignId: string;
  playerUserId: string;
  campaignStateData: MothershipCampaignState;
  playerAction: { content: string };
  /** System-generated rolls from the inner tool loop, in issue order. */
  executedRolls?: PendingSystemRoll[];
  gmResponse: SubmitGmResponse;
  correction?: SubmitGmResponse;
  applied: ValidationResult['applied'];
  thresholds: ThresholdCrossing[];
  proposedCanon: Array<{ summary: string; context: string }>;
  npcStates: Record<string, string>;
  /** Player-facing dice prompts to persist after gm_response. */
  diceRequests?: DiceRequestInput[];
  gmText: string;
  telemetry: TelemetryInputs;
  autoPromoteCanon: boolean;
}

export interface ApplyTurnAtomicResult {
  persistedMessage: DbMessage;
  gmResponseSequence: number;
  diceRollSequences: WrittenDiceRollRecord[];
  persistedDiceRequests: DiceRequestRow[];
}

@Injectable()
export class SessionRepository {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly canonRepo: CanonRepository,
  ) {}

  async getGmContextBlob(
    adventureId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.db
      .select({ blob: schema.gmContexts.blob })
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, adventureId))
      .limit(1);
    return (rows[0]?.blob as Record<string, unknown> | undefined) ?? null;
  }

  async getPlayerEntityIds(campaignId: string): Promise<string[]> {
    const rows = await this.db
      .select({ data: schema.characterSheets.data })
      .from(schema.characterSheets)
      .where(eq(schema.characterSheets.campaignId, campaignId));
    const ids: string[] = [];
    for (const row of rows) {
      const entityId = (row.data as { entityId?: unknown } | null)?.entityId;
      if (typeof entityId === 'string' && entityId.length > 0) {
        ids.push(entityId);
      }
    }
    return ids;
  }

  async getMessagesAsc(adventureId: string): Promise<DbMessage[]> {
    return this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.adventureId, adventureId))
      .orderBy(asc(schema.messages.createdAt));
  }

  async insertMessage(args: {
    adventureId: string;
    role: DbMessage['role'];
    content: string;
    tx?: DbOrTx;
  }): Promise<DbMessage> {
    const runner = args.tx ?? this.db;
    const rows = await runner
      .insert(schema.messages)
      .values({
        adventureId: args.adventureId,
        role: args.role,
        content: args.content,
      })
      .returning();
    return rows[0];
  }

  async writeCampaignState(args: {
    campaignId: string;
    data: MothershipCampaignState;
    tx?: DbOrTx;
  }): Promise<void> {
    const runner = args.tx ?? this.db;
    await runner
      .update(schema.campaignStates)
      .set({ data: args.data, updatedAt: sql`now()` })
      .where(eq(schema.campaignStates.campaignId, args.campaignId));
  }

  /**
   * Merges Claude's `gmUpdates.npcStates` into `gm_context.blob.narrative.npcAgendas`.
   * Reads the current blob, shallow-merges the new agendas over existing
   * ones (Claude wins on key collision), and writes the updated blob back.
   * No-op when `npcStates` is empty — avoids a pointless read/write that
   * would invalidate the blob's cache byte range for no semantic change.
   *
   * `gmUpdates.notes` is intentionally NOT persisted here; it lives in
   * `adventure_telemetry.payload.notes` instead (see spec §"Part 6 → GM
   * context blob merges").
   */
  async mergeNpcAgendas(args: {
    tx: DbOrTx;
    adventureId: string;
    npcStates: Record<string, string>;
  }): Promise<void> {
    if (Object.keys(args.npcStates).length === 0) return;

    const rows = await args.tx
      .select({ blob: schema.gmContexts.blob })
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, args.adventureId))
      .limit(1);

    const currentBlob =
      (rows[0]?.blob as Record<string, unknown> | undefined) ?? {};
    const currentNarrative =
      (currentBlob.narrative as Record<string, unknown> | undefined) ?? {};
    const existingAgendas =
      (currentNarrative.npcAgendas as Record<string, string> | undefined) ?? {};

    const updatedBlob = {
      ...currentBlob,
      narrative: {
        ...currentNarrative,
        npcAgendas: { ...existingAgendas, ...args.npcStates },
      },
    };

    await args.tx
      .update(schema.gmContexts)
      .set({ blob: updatedBlob, updatedAt: sql`now()` })
      .where(eq(schema.gmContexts.adventureId, args.adventureId));
  }

  /**
   * Insert a pending dice_request row. Called from within the per-turn
   * transaction in M8 once `submit_gm_response.diceRequests` has been parsed —
   * the backend owns request-id generation so Claude never sees or supplies
   * them. Returns the full row (the caller needs at least `id` to echo back
   * on the HTTP response; returning everything keeps callers decoupled from
   * future field additions).
   */
  async insertDiceRequest(args: {
    tx: DbOrTx;
    adventureId: string;
    issuedAtSequence: number;
    notation: string;
    purpose: string;
    target: number | null;
  }): Promise<DiceRequestRow> {
    const [row] = await args.tx
      .insert(schema.diceRequests)
      .values({
        adventureId: args.adventureId,
        issuedAtSequence: args.issuedAtSequence,
        notation: args.notation,
        purpose: args.purpose,
        target: args.target,
      })
      .returning();
    return row as DiceRequestRow;
  }

  /**
   * Load a dice_request by id. Used by the diceResult action branch (M9) to
   * validate that the row exists, is pending, and belongs to the given
   * adventure before accepting a submitted result. Returns null for unknown
   * ids so the controller can return 409 without needing a separate
   * not-found exception.
   */
  async loadDiceRequest(id: string): Promise<DiceRequestRow | null> {
    const rows = await this.db
      .select()
      .from(schema.diceRequests)
      .where(eq(schema.diceRequests.id, id))
      .limit(1);
    return (rows[0] as DiceRequestRow | undefined) ?? null;
  }

  /**
   * Transition a dice_request from `pending` to `resolved`, stamping the
   * resolving `dice_roll.sequence_number` and `now()`. Called inside the same
   * transaction that writes the `dice_roll` event so the two stay consistent.
   */
  async resolveDiceRequest(args: {
    tx: DbOrTx;
    id: string;
    resolvedAtSequence: number;
  }): Promise<void> {
    await args.tx
      .update(schema.diceRequests)
      .set({
        status: 'resolved',
        resolvedAtSequence: args.resolvedAtSequence,
        resolvedAt: sql`now()`,
      })
      .where(eq(schema.diceRequests.id, args.id));
  }

  /**
   * Player-entered dice_roll events that landed after the most recent
   * `gm_response` for this adventure. These are rolls the player submitted
   * between turns; the prompt builder renders them as a synthetic
   * `[Dice results]` block immediately before the next narrative input so
   * Claude knows what the dice said before narrating the outcome.
   *
   * Joins `game_event` (for results/total) back to `dice_request` (for the
   * purpose/target metadata Claude needs to interpret success/failure).
   * Ordered by sequence_number so the render is chronological.
   */
  async playerDiceRollsSinceLastGmResponse(
    adventureId: string,
  ): Promise<
    Array<{
      sequenceNumber: number;
      notation: string;
      purpose: string;
      target: number | null;
      results: number[];
      modifier: number;
      total: number;
      requestId: string;
    }>
  > {
    const result = await this.db.execute<{
      sequence_number: number;
      notation: string;
      purpose: string;
      target: number | null;
      results: number[];
      modifier: number;
      total: number;
      request_id: string;
    }>(sql`
      WITH last_gm AS (
        SELECT COALESCE(MAX(sequence_number), 0) AS seq
        FROM game_event
        WHERE adventure_id = ${adventureId}
          AND event_type = 'gm_response'
      )
      SELECT ev.sequence_number,
             dq.notation,
             dq.purpose,
             dq.target,
             (ev.payload->'results')::jsonb AS results,
             COALESCE((ev.payload->>'modifier')::int, 0) AS modifier,
             (ev.payload->>'total')::int    AS total,
             (ev.payload->>'requestId')     AS request_id
      FROM game_event ev
      JOIN dice_request dq
        ON dq.id = (ev.payload->>'requestId')::uuid
      WHERE ev.adventure_id = ${adventureId}
        AND ev.event_type   = 'dice_roll'
        AND ev.roll_source  = 'player_entered'
        AND ev.sequence_number > (SELECT seq FROM last_gm)
      ORDER BY ev.sequence_number ASC
    `);
    return result.rows.map((r) => ({
      sequenceNumber: Number(r.sequence_number),
      notation: r.notation,
      purpose: r.purpose,
      target: r.target,
      results: Array.isArray(r.results) ? r.results : [],
      modifier: Number(r.modifier),
      total: Number(r.total),
      requestId: r.request_id,
    }));
  }

  /**
   * All `pending` dice_requests for an adventure, ordered by issue sequence.
   * Used by the adventure-bootstrap endpoint (so a returning user lands in
   * the DicePrompt if they left mid-roll) and by the narrative-action guard
   * (which blocks narrative submission while any request is still pending).
   */
  async pendingDiceRequestsForAdventure(
    adventureId: string,
  ): Promise<DiceRequestRow[]> {
    const rows = await this.db
      .select()
      .from(schema.diceRequests)
      .where(
        and(
          eq(schema.diceRequests.adventureId, adventureId),
          eq(schema.diceRequests.status, 'pending'),
        ),
      )
      .orderBy(asc(schema.diceRequests.issuedAtSequence));
    return rows as DiceRequestRow[];
  }

  /**
   * Atomic write path for a player-submitted `diceResult`. Inside a single
   * transaction: allocate the next sequence number, write a `dice_roll`
   * event (`roll_source = 'player_entered'`, actor the submitting user),
   * and flip the `dice_request` to `resolved` stamping the resolving
   * sequence. Service-layer validation runs before this is called.
   */
  async applyDiceResultAtomic(args: {
    adventureId: string;
    campaignId: string;
    requestId: string;
    actorUserId: string;
    source: 'player_entered' | 'system_generated';
    payload: {
      notation: string;
      purpose: string;
      results: number[];
      modifier: number;
      total: number;
    };
  }): Promise<{ diceRollEventId: string; sequenceNumber: number }> {
    return this.db.transaction(async (tx) => {
      const sequenceNumber = await nextSequenceNumber(tx, args.adventureId);
      const { id } = await insertDiceRollEvent({
        tx,
        adventureId: args.adventureId,
        campaignId: args.campaignId,
        sequenceNumber,
        actorType: 'player',
        actorId: args.actorUserId,
        rollSource: args.source,
        payload: {
          notation: args.payload.notation,
          purpose: args.payload.purpose,
          results: args.payload.results,
          modifier: args.payload.modifier,
          total: args.payload.total,
          requestId: args.requestId,
        },
      });
      await this.resolveDiceRequest({
        tx,
        id: args.requestId,
        resolvedAtSequence: sequenceNumber,
      });
      return { diceRollEventId: id, sequenceNumber };
    });
  }

  /**
   * Atomic write path for a completed turn. Bundles state update, game_event
   * writes, pending_canon insertion (+ auto-promote in Solo Blind), blob
   * merge, final GM message insert, and telemetry insert into a single
   * transaction. On any failure the whole turn rolls back — the player
   * message (persisted by the service before this call) is preserved so
   * a retry can reproduce the action.
   */
  async applyTurnAtomic(
    args: ApplyTurnAtomicArgs,
  ): Promise<ApplyTurnAtomicResult> {
    return this.db.transaction(async (tx) => {
      await this.writeCampaignState({
        campaignId: args.campaignId,
        data: args.campaignStateData,
        tx,
      });

      const events = await writeTurnEvents({
        tx,
        adventureId: args.adventureId,
        campaignId: args.campaignId,
        playerUserId: args.playerUserId,
        playerAction: args.playerAction,
        executedRolls: args.executedRolls,
        gmResponse: args.gmResponse,
        correction: args.correction,
        applied: args.applied,
        thresholds: args.thresholds,
      });

      // Dice requests issued by submit_gm_response.diceRequests land here,
      // with issuedAtSequence tied to the gm_response row. The service
      // returns the full persisted rows so the HTTP response can echo
      // backend-assigned ids to the client.
      const persistedDiceRequests: DiceRequestRow[] = [];
      for (const req of args.diceRequests ?? []) {
        persistedDiceRequests.push(
          await this.insertDiceRequest({
            tx,
            adventureId: args.adventureId,
            issuedAtSequence: events.gmResponseSeq,
            notation: req.notation,
            purpose: req.purpose,
            target: req.target,
          }),
        );
      }

      await this.canonRepo.insertPendingCanon({
        tx,
        adventureId: args.adventureId,
        entries: args.proposedCanon,
      });

      if (args.autoPromoteCanon) {
        await this.canonRepo.autoPromoteCanon(args.adventureId, tx);
      }

      await this.mergeNpcAgendas({
        tx,
        adventureId: args.adventureId,
        npcStates: args.npcStates,
      });

      const persistedMessage = await this.insertMessage({
        adventureId: args.adventureId,
        role: 'gm',
        content: args.gmText,
        tx,
      });

      // Materialize the final diceRolls array with real sequence numbers
      // now that `writeTurnEvents` has assigned them. System-generated rolls
      // get their seqs from events.diceRollSequences (positional match to
      // args.executedRolls); player-entered rolls already carry real seqs
      // from prior `diceResult` transactions.
      const systemRollRecords: ExecutedRollRecord[] =
        events.diceRollSequences.map((r) => ({
          source: 'system_generated',
          sequenceNumber: r.sequenceNumber,
          notation: r.notation,
          purpose: r.purpose,
          results: r.results,
          modifier: r.modifier,
          total: r.total,
        }));
      const telemetryPayload = buildAdventureTelemetryPayload({
        playerMessage: args.telemetry.playerMessage,
        snapshotSent: args.telemetry.snapshotSent,
        originalRequest: args.telemetry.originalRequest,
        originalResponse: args.telemetry.originalResponse,
        originalParsed: args.telemetry.originalParsed,
        correction: args.telemetry.correction,
        applied: args.applied,
        thresholds: args.thresholds,
        diceRolls: [...args.telemetry.preTurnPlayerRolls, ...systemRollRecords],
        rulesLookups: args.telemetry.rulesLookups,
        toolLoopIterations: args.telemetry.toolLoopIterations,
      });
      await writeAdventureTelemetry({
        tx,
        adventureId: args.adventureId,
        sequenceNumber: events.gmResponseSeq,
        payload: telemetryPayload,
      });

      // Flip status on the first turn. Conditional on `status = 'ready'` so
      // subsequent turns no-op; also avoids clobbering a terminal status
      // (completed / failed) if one was reached out-of-band.
      await tx
        .update(schema.adventures)
        .set({ status: 'in_progress' })
        .where(
          and(
            eq(schema.adventures.id, args.adventureId),
            eq(schema.adventures.status, 'ready'),
          ),
        );

      return {
        persistedMessage,
        gmResponseSequence: events.gmResponseSeq,
        diceRollSequences: events.diceRollSequences,
        persistedDiceRequests,
      };
    });
  }
}
