import { eq, sql } from 'drizzle-orm';

import * as schema from '../db/schema';

import type { DbOrTx } from '../db/db.provider';
import type { RollType, SubmitGmResponse } from './session.schema';
import type { ThresholdCrossing, ValidationResult } from './session.validator';

/**
 * A dice roll executed by the inner tool loop, pending sequence-number
 * allocation. Only system-generated rolls arrive here — player-entered rolls
 * are written by the `diceResult` action handler in a separate transaction
 * (Part 9), not as part of the turn's atomic write.
 */
export interface PendingSystemRoll {
  /** Per-turn synthetic id (`roll_1`, `roll_2`, …), the referent for
   * `gatedByRollId`. Allocated by the tool loop in issue order; see
   * `rollDiceOutputSchema` for why it cannot be the `game_events` row id. */
  rollId: string;
  notation: string;
  purpose: string;
  results: number[];
  modifier: number;
  total: number;
  rollType: RollType;
  actingEntityId: string;
  gatedByRollId?: string;
}

export interface WriteTurnEventsArgs {
  tx: DbOrTx;
  adventureId: string;
  campaignId: string;
  playerUserId: string;
  playerAction: { content: string };
  executedRolls?: PendingSystemRoll[];
  gmResponse: SubmitGmResponse;
  correction?: SubmitGmResponse;
  applied: ValidationResult['applied'];
  thresholds: ThresholdCrossing[];
}

export interface WrittenDiceRollRecord {
  sequenceNumber: number;
  notation: string;
  purpose: string;
  results: number[];
  modifier: number;
  total: number;
}

export interface WriteTurnEventsResult {
  gmResponseEventId: string;
  gmResponseSeq: number;
  correctionEventId?: string;
  stateUpdateSeq: number;
  diceRollSequences: WrittenDiceRollRecord[];
}

/**
 * Allocate the next `sequence_number` for an adventure's `game_event` rows.
 * Serializes concurrent writers by taking a row-level lock on the parent
 * `adventure` record for the lifetime of the transaction — two overlapping
 * turns will observe disjoint sequence windows.
 *
 * Spec §"Part 4 → Sequence number allocation" illustrates this with
 * `SELECT max(...) ... FOR UPDATE` on `game_event`, but Postgres rejects
 * `FOR UPDATE` in combination with aggregate functions. Locking the adventure
 * row has the same effect (every event-log writer for this adventure must
 * acquire it first) and avoids aggregating-with-lock entirely.
 */
export async function nextSequenceNumber(
  tx: DbOrTx,
  adventureId: string,
): Promise<number> {
  await tx.execute(
    sql`SELECT 1 FROM adventure WHERE id = ${adventureId} FOR UPDATE`,
  );
  const rows = await tx
    .select({
      max: sql<number>`coalesce(max(${schema.gameEvents.sequenceNumber}), 0)`,
    })
    .from(schema.gameEvents)
    .where(eq(schema.gameEvents.adventureId, adventureId));
  return (rows[0]?.max ?? 0) + 1;
}

export async function writeTurnEvents(
  args: WriteTurnEventsArgs,
): Promise<WriteTurnEventsResult> {
  const base = await nextSequenceNumber(args.tx, args.adventureId);
  let seq = base;

  await args.tx.insert(schema.gameEvents).values({
    adventureId: args.adventureId,
    campaignId: args.campaignId,
    sequenceNumber: seq++,
    eventType: 'player_action',
    actorType: 'player',
    actorId: args.playerUserId,
    payload: { content: args.playerAction.content },
  });

  // Interleave any dice_roll events from the inner tool loop here, between
  // player_action and gm_response, in the order Claude issued them. These
  // are all `system_generated` rolls — player-entered rolls resolve via the
  // diceResult action in a separate transaction.
  const diceRollSequences: WrittenDiceRollRecord[] = [];
  for (const roll of args.executedRolls ?? []) {
    const rollSeq = seq++;
    await args.tx.insert(schema.gameEvents).values({
      adventureId: args.adventureId,
      campaignId: args.campaignId,
      sequenceNumber: rollSeq,
      eventType: 'dice_roll',
      actorType: 'gm',
      actorId: null,
      rollSource: 'system_generated',
      payload: {
        notation: roll.notation,
        purpose: roll.purpose,
        results: roll.results,
        modifier: roll.modifier,
        total: roll.total,
        rollId: roll.rollId,
        rollType: roll.rollType,
        actingEntityId: roll.actingEntityId,
        ...(roll.gatedByRollId === undefined
          ? {}
          : { gatedByRollId: roll.gatedByRollId }),
      } satisfies DiceRollEventPayload,
    });
    diceRollSequences.push({
      sequenceNumber: rollSeq,
      notation: roll.notation,
      purpose: roll.purpose,
      results: roll.results,
      modifier: roll.modifier,
      total: roll.total,
    });
  }

  const gmResponseSeq = seq++;
  const [gmResponseRow] = await args.tx
    .insert(schema.gameEvents)
    .values({
      adventureId: args.adventureId,
      campaignId: args.campaignId,
      sequenceNumber: gmResponseSeq,
      eventType: 'gm_response',
      actorType: 'gm',
      actorId: null,
      payload: gmPayloadFor(args.gmResponse),
    })
    .returning({ id: schema.gameEvents.id });

  let correctionEventId: string | undefined;

  if (args.correction) {
    const [correctionRow] = await args.tx
      .insert(schema.gameEvents)
      .values({
        adventureId: args.adventureId,
        campaignId: args.campaignId,
        sequenceNumber: seq++,
        eventType: 'correction',
        actorType: 'gm',
        actorId: null,
        payload: gmPayloadFor(args.correction),
      })
      .returning({ id: schema.gameEvents.id });
    correctionEventId = correctionRow.id;

    await args.tx
      .update(schema.gameEvents)
      .set({ supersededBy: correctionRow.id })
      .where(eq(schema.gameEvents.id, gmResponseRow.id));
  }

  const stateUpdateSeq = seq++;
  await args.tx.insert(schema.gameEvents).values({
    adventureId: args.adventureId,
    campaignId: args.campaignId,
    sequenceNumber: stateUpdateSeq,
    eventType: 'state_update',
    actorType: 'system',
    actorId: null,
    payload: { applied: args.applied, thresholds: args.thresholds },
  });

  return {
    gmResponseEventId: gmResponseRow.id,
    gmResponseSeq,
    correctionEventId,
    stateUpdateSeq,
    diceRollSequences,
  };
}

function gmPayloadFor(r: SubmitGmResponse): Record<string, unknown> {
  return {
    playerText: r.playerText,
    stateChanges: r.stateChanges ?? null,
    gmUpdates: r.gmUpdates ?? null,
    diceRequests: r.diceRequests ?? null,
    adventureMode: r.adventureMode ?? null,
  };
}

/**
 * `game_events.payload` for a `dice_roll` row.
 *
 * `rollId` / `rollType` / `actingEntityId` / `gatedByRollId` are **new keys
 * in an existing untyped `jsonb` column, not new columns** — `dice_roll`
 * events store their payload the same way every other event type in that
 * table does (`docs/schema.md § Game Events`), so this needs no migration
 * and `docs/schema.md` is unchanged.
 *
 * All four are optional *on this type* even though three are required on
 * `rollDiceInputSchema`, and the difference is load-bearing: rows written
 * before M7.5 have none of them, and `eval:rescore` re-grades frozen
 * `warden-output.json` artifacts from the `88fa84bd8329` runs that predate
 * the fields entirely. Every consumer branches on presence, never on
 * fixture version.
 */
export interface DiceRollEventPayload {
  notation: string;
  purpose: string;
  results: number[];
  modifier: number;
  total: number;
  requestId?: string;
  rollId?: string;
  rollType?: RollType;
  actingEntityId?: string;
  gatedByRollId?: string;
}

export interface InsertDiceRollEventArgs {
  tx: DbOrTx;
  adventureId: string;
  campaignId: string;
  sequenceNumber: number;
  actorType: 'gm' | 'player';
  actorId: string | null;
  rollSource: 'system_generated' | 'player_entered';
  payload: DiceRollEventPayload;
}

/**
 * Write a single `dice_roll` row to `game_events`. The caller is responsible
 * for allocating `sequenceNumber` (see `nextSequenceNumber`) and for owning
 * the surrounding transaction — in M7 this is the per-turn transaction that
 * writes player_action, any intervening dice_roll rows from the inner tool
 * loop, and the final gm_response/state_update events in contiguous order.
 *
 * `actorType: 'gm'` with `actorId: null` for system-generated rolls (the
 * Warden is not a user); `actorType: 'player'` with `actorId: <user_id>` for
 * player-entered rolls resolving a `dice_request`. `rollSource` mirrors this.
 */
export async function insertDiceRollEvent(
  args: InsertDiceRollEventArgs,
): Promise<{ id: string }> {
  const [row] = await args.tx
    .insert(schema.gameEvents)
    .values({
      adventureId: args.adventureId,
      campaignId: args.campaignId,
      sequenceNumber: args.sequenceNumber,
      eventType: 'dice_roll',
      actorType: args.actorType,
      actorId: args.actorId,
      rollSource: args.rollSource,
      payload: args.payload as unknown as Record<string, unknown>,
    })
    .returning({ id: schema.gameEvents.id });
  return { id: row.id };
}
