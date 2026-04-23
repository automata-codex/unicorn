import { Inject, Injectable } from '@nestjs/common';
import { type MothershipCampaignState } from '@uv/game-systems';
import { and, asc, eq, sql } from 'drizzle-orm';

import { CanonRepository } from '../canon/canon.repository';
import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import {
  writeTurnEvents,
  type PendingSystemRoll,
  type WrittenDiceRollRecord,
} from './session.events';
import { writeAdventureTelemetry } from './session.telemetry';

import type { Db, DbOrTx } from '../db/db.provider';
import type { SubmitGmResponse } from './session.schema';
import type { AdventureTelemetryPayload } from './session.telemetry';
import type { ThresholdCrossing, ValidationResult } from './session.validator';
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
  telemetryPayload: AdventureTelemetryPayload;
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

      await writeAdventureTelemetry({
        tx,
        adventureId: args.adventureId,
        sequenceNumber: events.gmResponseSeq,
        payload: args.telemetryPayload,
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
