import { and, asc, eq, gte, isNull, lt, or } from 'drizzle-orm';

import { tagIndependentCheckIds } from '../eval/checks/registry';
import {
  type Applicability,
  type EvalFixture,
  type FailureModeTag,
  FIXTURE_SCHEMA_VERSION,
  judgedFailureModeTags,
} from '../eval/fixture.schema';
import * as schema from '../src/db/schema';
import { reconstructStateAsOfTurn } from '../src/replay/reconstruct-state';

import type { Db } from '../src/db/db.provider';

export interface CaptureFixtureArgs {
  adventureId: string;
  targetSequenceNumber: number;
  tag: FailureModeTag;
  id: string;
}

function isJudgedTag(tag: FailureModeTag): boolean {
  return judgedFailureModeTags.includes(
    tag as (typeof judgedFailureModeTags)[number],
  );
}

/**
 * `dice_request` rows still pending "as of" the target turn — issued
 * before it, and not yet resolved before it. Not part of
 * `reconstructStateAsOfTurn`'s own output (M7.3 is out of scope for this
 * milestone to revisit), so this is a separate, direct read against the
 * same precondition `reconstructStateAsOfTurn` already checked (a valid
 * `player_action` sequence number for this adventure).
 */
async function pendingDiceRequestsAsOfTurn(
  db: Db,
  adventureId: string,
  targetSequenceNumber: number,
): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(schema.diceRequests)
    .where(
      and(
        eq(schema.diceRequests.adventureId, adventureId),
        lt(schema.diceRequests.issuedAtSequence, targetSequenceNumber),
        or(
          isNull(schema.diceRequests.resolvedAtSequence),
          gte(schema.diceRequests.resolvedAtSequence, targetSequenceNumber),
        ),
      ),
    )
    .orderBy(asc(schema.diceRequests.issuedAtSequence));
  return rows as unknown as Record<string, unknown>[];
}

/**
 * What the last committed turn before the target turn wrote — the winning
 * `gm_response`/`correction` payload's `stateChanges`, paired with the
 * `applied` block of the `state_update` that committed it.
 *
 * **Paired by walking, not by two independent "last row" queries.** The two
 * halves have to come from the same turn or they describe different writes,
 * and `writeTurnEvents` guarantees only the *ordering* — gm_response, then an
 * optional correction, then the state_update. Walking forward and committing
 * a candidate when the `state_update` arrives reproduces that ordering
 * exactly, and inherits `reconstructStateAsOfTurn`'s handling of corrections
 * for free: a correction overwrites the pending candidate, so the winning row
 * is the one paired, not the superseded original.
 *
 * "Committed", not "preceding", is what this returns. A `gm_response` with no
 * `state_update` after it is a turn that did not commit — the fold ignores it
 * and so does this, which means the answer can skip back more than one turn.
 * That is the intended reading for a check about state a turn *committed*.
 *
 * `null` when nothing before the target turn committed, which is the ordinary
 * answer for a fixture capturing turn 1.
 */
async function precedingCommittedTurnFor(
  db: Db,
  adventureId: string,
  targetSequenceNumber: number,
): Promise<EvalFixture['seededState']['precedingCommittedTurn']> {
  const events = await db
    .select({
      sequenceNumber: schema.gameEvents.sequenceNumber,
      eventType: schema.gameEvents.eventType,
      payload: schema.gameEvents.payload,
    })
    .from(schema.gameEvents)
    .where(
      and(
        eq(schema.gameEvents.adventureId, adventureId),
        lt(schema.gameEvents.sequenceNumber, targetSequenceNumber),
      ),
    )
    .orderBy(asc(schema.gameEvents.sequenceNumber));

  let pending: { sequenceNumber: number; stateChanges: unknown } | null = null;
  let committed: EvalFixture['seededState']['precedingCommittedTurn'] = null;

  for (const event of events) {
    if (event.eventType === 'gm_response' || event.eventType === 'correction') {
      // jsonb boundary — `gmPayloadFor`'s output at write time, which always
      // carries the key, as `null` when the turn changed nothing.
      const payload = event.payload as { stateChanges?: unknown };
      pending = {
        sequenceNumber: event.sequenceNumber,
        stateChanges: payload.stateChanges ?? null,
      };
    } else if (event.eventType === 'state_update' && pending) {
      const payload = event.payload as { applied?: unknown };
      committed = {
        sequenceNumber: pending.sequenceNumber,
        stateChanges: pending.stateChanges as Record<string, unknown> | null,
        applied: (payload.applied ?? {}) as Record<string, unknown>,
      };
      pending = null;
    }
  }

  return committed;
}

/**
 * A capture that cannot produce a usable fixture. Distinct from `ReplayError`
 * (which reports a bad target turn) — the fold succeeded, but the adventure
 * lacks something the harness will need.
 */
export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}

/**
 * The player-character entity ids for the adventure's campaign, read from
 * `character_sheet.data.entityId` — the same source
 * `SessionRepository.getPlayerEntityIds` reads at run time, so a captured
 * fixture declares exactly who production would have said the player was.
 *
 * **This is not decoration on the blob; the harness cannot work without it.**
 * `seedScratchAdventure` seeds a `character_sheet` row from the *first*
 * declared id, and `SessionService.sendMessage` then *overwrites*
 * `gmContextBlob.playerEntityIds` with the repository's answer — so the blob
 * survives the round trip only if a sheet was seeded. A fixture that declares
 * none seeds no sheet,
 * resolves `[]`, and silently disables `actingEntityId` validation in the tool
 * loop — the run grades a code path production does not take. That is the
 * mechanism behind the voided 2026-08-20 re-baseline (`ADR-0103` open item 3),
 * and it reproduced on every capture because this tool never emitted the field.
 *
 * Ordered by `user_id` rather than left to the planner: the result is frozen
 * into a JSON file, and the first entry is canonical — the only id the running
 * Warden is allowed to use (`harness-runner.ts`). An unordered read would make
 * two captures of the same adventure disagree about who that is.
 *
 * **Aliases stay a hand-edit.** A few fixtures declare a second id
 * (`['alvarez', 'lt_alvarez']`) so the checker can grade older artifacts that
 * used the alias. That leniency is a grading concern with no counterpart in
 * `character_sheet`, so derivation cannot and should not reproduce it.
 */
async function playerEntityIdsForAdventure(
  db: Db,
  adventureId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      userId: schema.characterSheets.userId,
      data: schema.characterSheets.data,
    })
    .from(schema.characterSheets)
    .innerJoin(
      schema.adventures,
      eq(schema.adventures.campaignId, schema.characterSheets.campaignId),
    )
    .where(eq(schema.adventures.id, adventureId))
    .orderBy(asc(schema.characterSheets.userId));

  const ids: string[] = [];
  for (const row of rows) {
    const entityId = (row.data as { entityId?: unknown } | null)?.entityId;
    if (typeof entityId === 'string' && entityId.length > 0) {
      ids.push(entityId);
    }
  }
  return ids;
}

/**
 * The fail-closed `applicability` stub every newly captured fixture carries.
 *
 * Two kinds of entry, and the second is the one that is easy to forget:
 *
 * - **The fixture's own `tag`** — the check it was captured to exercise.
 * - **Every tag-independent check** (`EvalCheck.tagIndependent`), which
 *   attaches to a fixture through `applicability` rather than through `tag`
 *   and so has no other route onto one. Omitting these is exactly how the
 *   corpus acquired the hole `ADR-0096` closed: `system-rolled-player-action`
 *   was measured only on fixtures named after it, and read 1.00 (20/20) on a
 *   run whose artifacts contain six violations of it. A stub does not answer
 *   the question — it makes the question unavoidable at authoring time, which
 *   is the only point at which anyone knows the scenario.
 *
 * Every entry is `applies: false`, matching the `playerInput`/`assertion`
 * placeholder convention: an unedited stub must read as "not yet confirmed"
 * rather than silently asserting the situation applies. **Prefer editing a
 * stub to `applies: false` with a real reason over deleting it** — a recorded
 * non-applicability surfaces in the report's `fixture-gated-never-applies`
 * finding, while a deleted entry surfaces nowhere and is indistinguishable
 * from never having considered the check.
 *
 * Pure, and exported separately from `captureFixture` so it is unit-testable
 * without a database.
 */
export function placeholderApplicability(tag: FailureModeTag): Applicability {
  const tagCheckId = tag.toLowerCase();
  const applicability: Applicability = {
    [tagCheckId]: {
      applies: false,
      situation:
        `TODO: does this fixture's scenario call for the "${tag}" check? State why ` +
        'or why not — see the doc comment on applicabilitySchema in eval/fixture.schema.ts.',
    },
  };

  for (const checkId of tagIndependentCheckIds) {
    if (checkId === tagCheckId) continue;
    applicability[checkId] = {
      applies: false,
      situation:
        `TODO: does this fixture's scenario call for the "${checkId}" check? It attaches ` +
        'by applicability rather than by tag, so every capture is asked regardless of its ' +
        'own tag. If it does, set applies: true and name the playerEntity; if not, replace ' +
        'this with the reason the scenario does not call for it.',
    };
  }

  return applicability;
}

/**
 * Wraps M7.3's `reconstructStateAsOfTurn` plus file-shape assembly — no
 * other logic of its own, same spirit as `save-synthesis`'s old role, just
 * producing a richer artifact (spec §"Seeded state is captured once").
 *
 * `reconstructStateAsOfTurn` throws `ReplayError` for a bad
 * `targetSequenceNumber` or a missing turn-0 snapshot; that propagates
 * unchanged — the CLI wrapper's `main()` already knows how to report a
 * plain `Error`'s message to stderr, no need to re-wrap it here.
 *
 * `seededState.gmContextBlob.playerEntityIds` is the one field this tool
 * derives rather than folds, and it is not optional: see
 * `playerEntityIdsForAdventure` for why an empty answer is a `CaptureError`
 * instead of an empty array.
 *
 * `playerInput`, `assertion`, and `applicability` are filled with
 * placeholder values the fixture author is expected to replace by hand —
 * this tool only knows enough to produce a *validly-shaped* fixture, not a
 * *correct* one. The placeholder `assertion.mode` matches what `tag`
 * actually requires (per `evalFixtureSchema`'s tag/mode refinement) so the
 * written file passes `loadFixtures` validation as-is, ready to be
 * hand-edited rather than hand-restructured. `applicability` gets one
 * fail-closed stub per check the fixture could carry — its own tag plus every
 * tag-independent check — see `placeholderApplicability`.
 */
export async function captureFixture(
  db: Db,
  args: CaptureFixtureArgs,
): Promise<EvalFixture> {
  const reconstructed = await reconstructStateAsOfTurn(
    db,
    args.adventureId,
    args.targetSequenceNumber,
  );
  const pendingDiceRequests = await pendingDiceRequestsAsOfTurn(
    db,
    args.adventureId,
    args.targetSequenceNumber,
  );

  const precedingCommittedTurn = await precedingCommittedTurnFor(
    db,
    args.adventureId,
    args.targetSequenceNumber,
  );

  const playerEntityIds = await playerEntityIdsForAdventure(
    db,
    args.adventureId,
  );
  if (playerEntityIds.length === 0) {
    throw new CaptureError(
      `no character_sheet with a data.entityId for adventure ${args.adventureId}'s ` +
        'campaign, so the fixture cannot declare playerEntityIds. Capturing anyway ' +
        'would write a fixture that seeds no character sheet, resolves ' +
        'playerEntityIds to [] at run time, and silently grades a code path ' +
        'production does not take (ADR-0103 open item 3). Fix the source ' +
        'adventure rather than the fixture.',
    );
  }

  return {
    id: args.id,
    tag: args.tag,
    sourceAdventureId: args.adventureId,
    sourceSequenceNumber: args.targetSequenceNumber,
    fixtureSchemaVersion: FIXTURE_SCHEMA_VERSION,
    seededState: {
      campaignState: reconstructed.campaignState as unknown as Record<
        string,
        unknown
      >,
      /** Derived, not folded: `reconstructStateAsOfTurn` returns the blob as
       * synthesis wrote it, and synthesis never persists `playerEntityIds`
       * — it is a per-request addition `SessionService` makes from a
       * character-sheet lookup. See `playerEntityIdsForAdventure`. */
      gmContextBlob: {
        ...(reconstructed.gmContextBlob as unknown as Record<string, unknown>),
        playerEntityIds,
      },
      pendingCanon: reconstructed.pendingCanon as unknown as Record<
        string,
        unknown
      >[],
      messages: reconstructed.messages as unknown as Record<string, unknown>[],
      pendingDiceRequests,
      /** Read directly from `game_event` rather than folded: the fold is what
       * destroys the delta this records. See the field's doc comment in
       * `eval/fixture.schema.ts`. */
      precedingCommittedTurn,
      capturedAt: new Date().toISOString(),
    },
    playerInput: {
      type: 'message',
      content:
        'TODO: fill in the player message that actually triggered this turn ' +
        `(source adventure ${args.adventureId}, sequence ${args.targetSequenceNumber})`,
    },
    /** Keyed by check id (`toCheckId` in `eval/checks/registry.ts` — lower-
     * cased `tag`), one fail-closed stub per check this fixture could carry.
     * See `placeholderApplicability`. */
    applicability: placeholderApplicability(args.tag),
    assertion: isJudgedTag(args.tag)
      ? {
          mode: 'judged',
          rubric: args.tag,
          facts: {
            'TODO-fact-name': 'TODO: fill in the fact this rubric asks for',
          },
        }
      : {
          mode: 'structural',
          check: `TODO: describe the expected structural assertion for ${args.tag}`,
        },
  };
}
