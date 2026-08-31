import { and, asc, eq, lt, sql } from 'drizzle-orm';

import * as schema from '../db/schema';
import { migrateGmContextBlob } from '../session/gm-context.migration';
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
  gmUpdates:
    | (Pick<NonNullable<SubmitGmResponse['gmUpdates']>, 'npcAgendas'> & {
        /**
         * Pre-`ADR-0101` rows carry the agenda map under this name. Replay
         * reads persisted history, so the legacy key stays readable forever —
         * including for the 2026-08-16 playtest, whose `npcStates` writes are
         * what the split exists to prevent and which a replay must still
         * reproduce faithfully rather than silently repair.
         */
        npcStates?: Record<string, string>;
      })
    | null;
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
  // `ADR-0118`. The snapshot is the turn-0 baseline captured at synthesis, so
  // every adventure created before the rename carries `narrative.location`
  // here. Migrating at the read keeps replay working on both playtest
  // campaigns — which is the reason the rename migrates rather than rejecting.
  let gmContextBlob = migrateGmContextBlob(
    snapshot.gmContextBlob as Record<string, unknown>,
  );

  // Steps 2-3: fold every prior turn's validated deltas forward. Only two
  // event types carry data the applier needs — `state_update.payload.applied`
  // (the campaign-state half) and the *winning* `gm_response`/`correction`
  // row's agenda map (the gm_context half). A correction,
  // when present, is always written immediately after its gm_response and
  // before the turn's state_update (`session.events.ts`), so simply
  // overwriting `pendingNpcAgendas` on each gm_response/correction row and
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

  let pendingNpcAgendas: Record<string, string> = {};
  for (const event of events) {
    if (event.eventType === 'gm_response' || event.eventType === 'correction') {
      // jsonb boundary — payload is `gmPayloadFor`'s output at write time.
      const payload = event.payload as GmResponseEventPayload;
      pendingNpcAgendas =
        payload.gmUpdates?.npcAgendas ?? payload.gmUpdates?.npcStates ?? {};
    } else if (event.eventType === 'state_update') {
      const payload = event.payload as StateUpdateEventPayload;
      const { newCampaignState, newGmContextBlob } = applyValidatedTurn({
        priorCampaignState: campaignState,
        priorGmContextBlob: gmContextBlob,
        applied: payload.applied,
        npcAgendas: pendingNpcAgendas,
      });
      campaignState = newCampaignState;
      gmContextBlob = newGmContextBlob;
      pendingNpcAgendas = {};
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
  //
  // The bound is compared **in SQL, and strictly**, and both halves are
  // load-bearing:
  //
  // - *Strictly*, because `message.created_at` and `game_event.created_at`
  //   both default to `now()`, which is transaction *start* time and therefore
  //   identical for every row a single transaction writes. Turn N's own GM
  //   message is written inside `applyTurnAtomic`'s transaction alongside the
  //   `player_action` event (`session.repository.ts`), so the two carry the
  //   same microsecond timestamp and only `<` excludes it. `<=` would fold the
  //   GM response this function exists to withhold.
  // - *In SQL*, because the bound must not round-trip through JavaScript.
  //   `pg` parses `timestamptz` into a `Date`, which is millisecond-precision,
  //   so reading the anchor into JS and binding it back silently floors it by
  //   up to 999µs. Any message written in the same millisecond as the turn
  //   transaction then falls outside the bound — including, intermittently,
  //   the player message that opens the turn, whenever it lands close enough
  //   to the transaction that opened after it. That is a real flake, not a
  //   theoretical one; it reproduced roughly one run in four.
  const messages = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.adventureId, adventureId),
        sql`${schema.messages.createdAt} < (
          select created_at from ${schema.gameEvents}
          where adventure_id = ${adventureId}
            and sequence_number = ${targetSequenceNumber}
            and event_type = 'player_action'
        )`,
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
