import { eq, sql } from 'drizzle-orm';

import * as schema from '../db/schema';

import type { DbOrTx } from '../db/db.provider';
import type { SubmitGmResponse } from './session.schema';
import type { ThresholdCrossing, ValidationResult } from './session.validator';

export interface WriteTurnEventsArgs {
  tx: DbOrTx;
  adventureId: string;
  campaignId: string;
  playerUserId: string;
  playerAction: { content: string };
  gmResponse: SubmitGmResponse;
  correction?: SubmitGmResponse;
  applied: ValidationResult['applied'];
  thresholds: ThresholdCrossing[];
}

export interface WriteTurnEventsResult {
  gmResponseEventId: string;
  gmResponseSeq: number;
  correctionEventId?: string;
  stateUpdateSeq: number;
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
  };
}

function gmPayloadFor(r: SubmitGmResponse): Record<string, unknown> {
  return {
    playerText: r.playerText,
    stateChanges: r.stateChanges ?? null,
    gmUpdates: r.gmUpdates ?? null,
    playerRolls: r.playerRolls ?? null,
    adventureMode: r.adventureMode ?? null,
  };
}
