import { and, asc, eq, lt, lte } from 'drizzle-orm';

import * as schema from '../db/schema';
import { applyValidatedTurn } from '../session/session.applier';

import type { MothershipCampaignState } from '@uv/game-systems';
import type { Db } from '../db/db.provider';
import type { SubmitGmResponse } from '../session/session.schema';
import type { GmContextBlob } from '../session/session.snapshot';
import type { DbMessage } from '../session/session.window';

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

export type PendingCanonRow = typeof schema.pendingCanon.$inferSelect;

export interface ReconstructStateResult {
  campaignState: MothershipCampaignState;
  gmContextBlob: GmContextBlob;
  pendingCanon: PendingCanonRow[];
  messages: DbMessage[];
}

/** Shape `writeTurnEvents` (`session.events.ts`) actually persists for a
 * `gm_response`/`correction` row — see `gmPayloadFor`. `gmUpdates` is `null`,
 * not just possibly absent, when Claude's turn carried none. */
interface GmResponseEventPayload {
  gmUpdates: Pick<
    NonNullable<SubmitGmResponse['gmUpdates']>,
    'npcStates'
  > | null;
}

/** Shape `writeTurnEvents` persists for a `state_update` row. */
interface StateUpdateEventPayload {
  applied: Parameters<typeof applyValidatedTurn>[0]['applied'];
}

/**
 * Reconstructs adventure state as it existed *going into* turn N — after
 * every event with `sequenceNumber < targetSequenceNumber` has been folded,
 * including the player message that triggers turn N but excluding turn N's
 * own GM response (that's what a replay run is regenerating and checking).
 * See spec §"Part 6" (`docs/specs/zoltar/010-m7.3-turn-state-replay-spec.md`)
 * for the full semantics writeup.
 *
 * This is a plain function, not a NestJS-injectable service, so it's usable
 * from both a future CLI/script and in-process Nest code without presupposing
 * which one M7.4 picks — mirrors `buildSynthesisExport`'s shape.
 *
 * Precondition: `targetSequenceNumber` must be the `sequence_number` of an
 * actual `player_action` `game_event` row for this adventure — "state as of
 * turn N" is only meaningful anchored to a turn's first event. Violating
 * this throws `ReplayError` immediately, before any fold work runs.
 */
export async function reconstructStateAsOfTurn(
  db: Db,
  adventureId: string,
  targetSequenceNumber: number,
): Promise<ReconstructStateResult> {
  const [turnStartEvent] = await db
    .select({ createdAt: schema.gameEvents.createdAt })
    .from(schema.gameEvents)
    .where(
      and(
        eq(schema.gameEvents.adventureId, adventureId),
        eq(schema.gameEvents.sequenceNumber, targetSequenceNumber),
        eq(schema.gameEvents.eventType, 'player_action'),
      ),
    )
    .limit(1);
  if (!turnStartEvent) {
    throw new ReplayError(
      `no player_action event at sequence ${targetSequenceNumber} for ` +
        `adventure ${adventureId} — targetSequenceNumber must be the ` +
        "sequence_number of a turn's player_action event.",
    );
  }

  // Step 1: turn-0 baseline.
  const [snapshot] = await db
    .select()
    .from(schema.adventureSynthesisSnapshots)
    .where(eq(schema.adventureSynthesisSnapshots.adventureId, adventureId))
    .limit(1);
  if (!snapshot) {
    throw new ReplayError(
      `no synthesis snapshot for adventure ${adventureId} — replay requires ` +
        'a captured turn-0 baseline (see adventure_synthesis_snapshots).',
    );
  }

  let campaignState = snapshot.campaignStateData as MothershipCampaignState;
  let gmContextBlob = snapshot.gmContextBlob as Record<string, unknown>;

  // Steps 2-3: fold every prior turn's validated deltas forward. Only two
  // event types carry data the applier needs — `state_update.payload.applied`
  // (the campaign-state half) and the *winning* `gm_response`/`correction`
  // row's `payload.gmUpdates.npcStates` (the gm_context half). A correction,
  // when present, is always written immediately after its gm_response and
  // before the turn's state_update (`session.events.ts`), so simply
  // overwriting `pendingNpcStates` on each gm_response/correction row and
  // consuming it at state_update naturally picks the winning value.
  // `player_action` / `dice_roll` rows contribute nothing and are skipped.
  const events = await db
    .select()
    .from(schema.gameEvents)
    .where(
      and(
        eq(schema.gameEvents.adventureId, adventureId),
        lt(schema.gameEvents.sequenceNumber, targetSequenceNumber),
      ),
    )
    .orderBy(asc(schema.gameEvents.sequenceNumber));

  let pendingNpcStates: Record<string, string> = {};
  for (const event of events) {
    if (event.eventType === 'gm_response' || event.eventType === 'correction') {
      // jsonb boundary — payload is `gmPayloadFor`'s output at write time.
      const payload = event.payload as GmResponseEventPayload;
      pendingNpcStates = payload.gmUpdates?.npcStates ?? {};
    } else if (event.eventType === 'state_update') {
      const payload = event.payload as StateUpdateEventPayload;
      const { newCampaignState, newGmContextBlob } = applyValidatedTurn({
        priorCampaignState: campaignState,
        priorGmContextBlob: gmContextBlob,
        applied: payload.applied,
        npcStates: pendingNpcStates,
      });
      campaignState = newCampaignState;
      gmContextBlob = newGmContextBlob;
      pendingNpcStates = {};
    }
  }

  // Step 4: pending_canon baseline — "canon that already existed" as of
  // turn N. Rows with `sequenceNumber IS NULL` (pre-M7.3-Part-5 legacy rows)
  // are correctly excluded by `lt(...)` against NULL, which is the desired
  // degraded behavior for adventures that predate the sequence column.
  const pendingCanon = await db
    .select()
    .from(schema.pendingCanon)
    .where(
      and(
        eq(schema.pendingCanon.adventureId, adventureId),
        lt(schema.pendingCanon.sequenceNumber, targetSequenceNumber),
      ),
    )
    .orderBy(asc(schema.pendingCanon.sequenceNumber));

  // Step 5: messages up through and including the player message that
  // triggers turn N. Relies on the player message being inserted strictly
  // before its `player_action` event within the same turn (session.service.ts
  // persists it before opening the atomic turn transaction) — an existing
  // ordering property this milestone doesn't change.
  const messages = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.adventureId, adventureId),
        lte(schema.messages.createdAt, turnStartEvent.createdAt),
      ),
    )
    .orderBy(asc(schema.messages.createdAt));

  return {
    campaignState,
    gmContextBlob: gmContextBlob as GmContextBlob,
    pendingCanon,
    messages,
  };
}
