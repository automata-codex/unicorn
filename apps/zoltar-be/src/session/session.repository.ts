import { Inject, Injectable } from '@nestjs/common';
import { type MothershipCampaignState } from '@uv/game-systems';
import { and, asc, eq, sql } from 'drizzle-orm';

import { CanonRepository } from '../canon/canon.repository';
import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import {
  GM_CONTEXT_SCHEMA_VERSION,
  migrateGmContextBlob,
} from './gm-context.migration';
import {
  insertDiceRollEvent,
  nextSequenceNumber,
  type PendingSystemRoll,
  type WrittenDiceRollRecord,
  writeTurnEvents,
} from './session.events';
import {
  buildAdventureTelemetryPayload,
  latestGmContextHash,
  writeAdventureTelemetry,
} from './session.telemetry';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { Db, DbOrTx } from '../db/db.provider';
import type { SubmitGmResponse } from './session.schema';
import type {
  ExecutedRollRecord,
  RulesLookupRecord,
  WardenPromptRef,
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
  /** Warden prompt in effect this turn — filename + 8-char hash prefix. */
  wardenPrompt: WardenPromptRef;
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
  /** Fully-merged `gm_context.blob` for this turn, computed by the service
   * via `applyValidatedTurn` before the transaction opens. Written verbatim
   * — no further merge logic here. */
  gmContextBlob: Record<string, unknown>;
  /** Player-facing dice prompts to persist after gm_response. */
  diceRequests?: DiceRequestInput[];
  gmText: string;
  telemetry: TelemetryInputs;
  autoPromoteCanon: boolean;
}

export interface ApplyTurnAtomicResult {
  persistedMessage: DbMessage;
  gmResponseSequence: number;
  /**
   * 1-based ordinal of this turn among the adventure's `gm_response` events
   * — the number the play view labels the turn with. See
   * `listMessagesWithTurnNumber` for the definition and why it is not the
   * same thing as `gmResponseSequence`.
   */
  turnNumber: number;
  diceRollSequences: WrittenDiceRollRecord[];
  persistedDiceRequests: DiceRequestRow[];
}

/** A play-view message row, tagged with the turn it belongs to. */
export interface MessageWithTurnNumber {
  id: string;
  role: DbMessage['role'];
  content: string;
  createdAt: Date;
  turnNumber: number | null;
}

@Injectable()
export class SessionRepository {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly canonRepo: CanonRepository,
  ) {}

  /**
   * Migrated on the way out (`ADR-0118`). This is the read that feeds the
   * prompt builder, so an unmigrated v1 blob here renders `scenario_premise:
   * undefined` to the Warden on every turn of an old adventure.
   *
   * **`schemaVersion` is part of the projection, and must stay there.** It is
   * what selects which migrations run; dropping it from this select is how the
   * migration would silently stop happening. There is deliberately no default
   * on `migrateGmContextBlob`'s second parameter, so removing it here is a type
   * error rather than a quiet regression.
   */
  async getGmContextBlob(
    adventureId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.db
      .select({
        blob: schema.gmContexts.blob,
        schemaVersion: schema.gmContexts.schemaVersion,
      })
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, adventureId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return migrateGmContextBlob(
      row.blob as Record<string, unknown>,
      row.schemaVersion,
    );
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

  /**
   * Messages for the play view, each tagged with the 1-based ordinal of the
   * turn it belongs to — the same number `playtest-review.render.ts` prints
   * as `### Turn N`, so a note taken against the UI mid-playtest resolves
   * against the review report (and the `turnNN-*` eval fixtures) without
   * counting. Deliberately *not* `game_event.sequence_number`, which is a
   * sparser per-event counter.
   *
   * Assignment rule: a message belongs to the earliest `gm_response` at or
   * after its own `created_at`.
   * - A `gm` message matches its own event exactly — both are written inside
   *   `applyTurnAtomic`'s transaction and take the same `now()`.
   * - A `player` message resolves forward to the turn it initiates, which is
   *   always strictly later (it is persisted before the turn transaction
   *   opens, so a retry survives a failed turn).
   * - A player message orphaned by a failed turn resolves forward to the
   *   retry that eventually succeeded. Both copies read the same turn, which
   *   is the intended reading.
   * - `null` means no turn followed: a turn in flight, or one that never
   *   completed. The play view renders those unlabelled.
   *
   * Superseded `gm_response` rows are counted, not filtered — a corrected
   * turn is still one turn, and `playtest-review.render.ts` numbers it the
   * same way.
   *
   * Kept separate from `getMessagesAsc` on purpose: that one feeds
   * `buildMessageWindow` on the prompt path, which must not start carrying
   * turn numbers into Claude's context.
   *
   * See `docs/plans/015-play-view-turn-number.md` for the playtest data this
   * was verified against.
   */
  async listMessagesWithTurnNumber(
    adventureId: string,
  ): Promise<MessageWithTurnNumber[]> {
    const result = await this.db.execute<{
      id: string;
      role: DbMessage['role'];
      content: string;
      // node-postgres does not apply Drizzle's column-type mapping to raw
      // `db.execute` results — timestamptz comes back as Postgres's text
      // representation, not a Date. Parse explicitly below.
      created_at: string;
      turn_number: string | number | null;
    }>(sql`
      WITH turns AS (
        SELECT created_at,
               sequence_number,
               ROW_NUMBER() OVER (ORDER BY sequence_number) AS turn_number
        FROM game_event
        WHERE adventure_id = ${adventureId}
          AND event_type   = 'gm_response'
      )
      SELECT m.id,
             m.role,
             m.content,
             m.created_at,
             (SELECT t.turn_number
                FROM turns t
               WHERE t.created_at >= m.created_at
               ORDER BY t.sequence_number ASC
               LIMIT 1) AS turn_number
      FROM message m
      WHERE m.adventure_id = ${adventureId}
      ORDER BY m.created_at ASC
    `);
    return result.rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: new Date(r.created_at),
      turnNumber: r.turn_number === null ? null : Number(r.turn_number),
    }));
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
   * Player-submitted `dice_roll` events (`actor_type = 'player'`) for the
   * adventure, ordered by sequence. Excludes GM/NPC rolls from Claude's
   * inner tool loop (`actor_type = 'gm'`, written by `writeTurnEvents`) —
   * those are mechanical/narrative-support rolls, not something the player
   * submitted, and showing them in the chat log was a UI quirk rather than
   * intended behavior.
   *
   * Joins `dice_request` (left, since a system-generated "Roll for me"
   * roll still resolves a request but a future row shape shouldn't hard-
   * require it) so the FE can render target/success-or-failure.
   *
   * Feeds the play-view message log — dice events are merged with the
   * plain-message stream by `createdAt` client-side.
   */
  async listDiceRollEvents(adventureId: string): Promise<
    Array<{
      id: string;
      sequenceNumber: number;
      createdAt: Date;
      source: 'system_generated' | 'player_entered';
      notation: string;
      purpose: string;
      results: number[];
      modifier: number;
      total: number;
      target: number | null;
      requestId: string | null;
    }>
  > {
    const result = await this.db.execute<{
      id: string;
      sequence_number: number;
      // node-postgres does not apply Drizzle's column-type mapping to raw
      // `db.execute` results — timestamptz comes back as Postgres's text
      // representation, not a Date. Parse explicitly below.
      created_at: string;
      roll_source: 'system_generated' | 'player_entered';
      notation: string;
      purpose: string;
      results: number[];
      modifier: number;
      total: number;
      target: number | null;
      request_id: string | null;
    }>(sql`
      SELECT ev.id,
             ev.sequence_number,
             ev.created_at,
             ev.roll_source,
             (ev.payload->>'notation')          AS notation,
             (ev.payload->>'purpose')           AS purpose,
             (ev.payload->'results')::jsonb     AS results,
             COALESCE((ev.payload->>'modifier')::int, 0) AS modifier,
             (ev.payload->>'total')::int        AS total,
             dq.target                          AS target,
             (ev.payload->>'requestId')         AS request_id
      FROM game_event ev
      LEFT JOIN dice_request dq
        ON dq.id::text = ev.payload->>'requestId'
      WHERE ev.adventure_id = ${adventureId}
        AND ev.event_type   = 'dice_roll'
        AND ev.actor_type   = 'player'
      ORDER BY ev.sequence_number ASC
    `);
    return result.rows.map((r) => ({
      id: r.id,
      sequenceNumber: Number(r.sequence_number),
      createdAt: new Date(r.created_at),
      source: r.roll_source,
      notation: r.notation,
      purpose: r.purpose,
      results: Array.isArray(r.results) ? r.results : [],
      modifier: Number(r.modifier),
      total: Number(r.total),
      target: r.target === null ? null : Number(r.target),
      requestId: r.request_id,
    }));
  }

  /**
   * Player-submitted dice_roll events (`actor_type = 'player'`) that landed
   * after the most recent `gm_response` for this adventure — whether typed
   * in (`player_entered`) or generated via the "Roll for me" button
   * (`system_generated`). The prompt builder renders them as a synthetic
   * `[Dice results]` block immediately before the next narrative input so
   * Claude knows what the dice said before narrating the outcome.
   *
   * Filtered on `actor_type = 'player'` rather than `roll_source`: GM/NPC
   * rolls from the inner tool loop are always written with
   * `actor_type = 'gm'` (see `writeTurnEvents`), while both
   * `applyDiceResultAtomic` write paths — typed-in and "Roll for me" —
   * always write `actor_type = 'player'` regardless of `roll_source`. A
   * prior `roll_source = 'player_entered'` filter excluded legitimate
   * "Roll for me" submissions (`system_generated`) and caused a stuck-turn
   * bug.
   *
   * Joins `game_event` (for results/total) back to `dice_request` (for the
   * purpose/target metadata Claude needs to interpret success/failure).
   * Ordered by sequence_number so the render is chronological.
   */
  async playerDiceRollsSinceLastGmResponse(adventureId: string): Promise<
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
        AND ev.actor_type   = 'player'
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
   * writes, pending_canon insertion (+ auto-promote in Solo Blind), gm_context
   * blob write, final GM message insert, and telemetry insert into a single
   * transaction. On any failure the whole turn rolls back — the player
   * message (persisted by the service before this call) is preserved so
   * a retry can reproduce the action.
   *
   * `campaignStateData` and `gmContextBlob` are already fully merged by the
   * caller (via `applyValidatedTurn`) — this method only persists them, it
   * does not compute deltas.
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
        sequenceNumber: events.gmResponseSeq,
      });

      if (args.autoPromoteCanon) {
        await this.canonRepo.autoPromoteCanon(args.adventureId, tx);
      }

      // The version moves with the blob. `getGmContextBlob` migrated this
      // adventure's context on the way in, so what is being written back is
      // v2 regardless of what the row held before — an old adventure's first
      // turn after `ADR-0118` is what actually migrates its row, and leaving
      // the column at 1 would label a v2 blob as v1.
      await tx
        .update(schema.gmContexts)
        .set({
          schemaVersion: GM_CONTEXT_SCHEMA_VERSION,
          blob: args.gmContextBlob,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.gmContexts.adventureId, args.adventureId));

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
      // Read before the insert, inside the same transaction: the row this
      // turn is about to write must not be the one it compares against.
      const previousGmContextHash = await latestGmContextHash({
        tx,
        adventureId: args.adventureId,
      });
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
        wardenPrompt: args.telemetry.wardenPrompt,
        previousGmContextHash,
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

      // Turn ordinal for the play-view label. Counted inside the transaction,
      // where the gm_response just written by `writeTurnEvents` is by
      // definition the latest — so the total count *is* this turn's ordinal,
      // and it cannot race a concurrent turn. Matches the definition in
      // `listMessagesWithTurnNumber`: superseded rows count, corrections do
      // not add one (they are `correction` events, not `gm_response`).
      const turnCount = await tx.execute<{ count: string | number }>(sql`
        SELECT count(*) AS count
        FROM game_event
        WHERE adventure_id = ${args.adventureId}
          AND event_type   = 'gm_response'
      `);

      return {
        persistedMessage,
        gmResponseSequence: events.gmResponseSeq,
        turnNumber: Number(turnCount.rows[0]?.count ?? 0),
        diceRollSequences: events.diceRollSequences,
        persistedDiceRequests,
      };
    });
  }
}
