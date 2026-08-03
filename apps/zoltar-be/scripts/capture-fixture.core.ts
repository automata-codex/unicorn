import { and, asc, eq, gte, isNull, lt, or } from 'drizzle-orm';

import {
  FIXTURE_SCHEMA_VERSION,
  type EvalFixture,
  type FailureModeTag,
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
 * Wraps M7.3's `reconstructStateAsOfTurn` plus file-shape assembly — no
 * other logic of its own, same spirit as `save-synthesis`'s old role, just
 * producing a richer artifact (spec §"Seeded state is captured once").
 *
 * `reconstructStateAsOfTurn` throws `ReplayError` for a bad
 * `targetSequenceNumber` or a missing turn-0 snapshot; that propagates
 * unchanged — the CLI wrapper's `main()` already knows how to report a
 * plain `Error`'s message to stderr, no need to re-wrap it here.
 *
 * `playerInput`, `assertion`, and `applicability` are filled with
 * placeholder values the fixture author is expected to replace by hand —
 * this tool only knows enough to produce a *validly-shaped* fixture, not a
 * *correct* one. The placeholder `assertion.mode` matches what `tag`
 * actually requires (per `evalFixtureSchema`'s tag/mode refinement) so the
 * written file passes `loadFixtures` validation as-is, ready to be
 * hand-edited rather than hand-restructured. `applicability`'s placeholder
 * defaults to `applies: false` — fail-closed, since a check that reads it
 * (`requiresFixtureSchema: 2`) treats an unedited stub as "not yet
 * confirmed" rather than silently assuming the situation applies.
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
      gmContextBlob: reconstructed.gmContextBlob as unknown as Record<
        string,
        unknown
      >,
      pendingCanon: reconstructed.pendingCanon as unknown as Record<
        string,
        unknown
      >[],
      messages: reconstructed.messages as unknown as Record<string, unknown>[],
      pendingDiceRequests,
      capturedAt: new Date().toISOString(),
    },
    playerInput: {
      type: 'message',
      content:
        'TODO: fill in the player message that actually triggered this turn ' +
        `(source adventure ${args.adventureId}, sequence ${args.targetSequenceNumber})`,
    },
    /** Keyed by check id (`toCheckId` in `eval/checks/registry.ts` — lower-
     * cased `tag`) so a checker can look itself up by its own id without
     * this tool needing to import that registry. */
    applicability: {
      [args.tag.toLowerCase()]: {
        applies: false,
        situation:
          `TODO: does this fixture's scenario call for the "${args.tag}" check? State why ` +
          'or why not — see the doc comment on applicabilitySchema in eval/fixture.schema.ts.',
      },
    },
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
