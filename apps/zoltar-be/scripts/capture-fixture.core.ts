import {
  type EvalFixture,
  type FailureModeTag,
  judgedFailureModeTags,
} from '../eval/fixture.schema';
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
 * Wraps M7.3's `reconstructStateAsOfTurn` plus file-shape assembly — no
 * other logic of its own, same spirit as `save-synthesis`'s old role, just
 * producing a richer artifact (spec §"Seeded state is captured once").
 *
 * `reconstructStateAsOfTurn` throws `ReplayError` for a bad
 * `targetSequenceNumber` or a missing turn-0 snapshot; that propagates
 * unchanged — the CLI wrapper's `main()` already knows how to report a
 * plain `Error`'s message to stderr, no need to re-wrap it here.
 *
 * `playerInput` and `assertion` are filled with placeholder values the
 * fixture author is expected to replace by hand — this tool only knows
 * enough to produce a *validly-shaped* fixture, not a *correct* one. The
 * placeholder `assertion.mode` matches what `tag` actually requires (per
 * `evalFixtureSchema`'s tag/mode refinement) so the written file passes
 * `loadFixtures` validation as-is, ready to be hand-edited rather than
 * hand-restructured.
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

  return {
    id: args.id,
    tag: args.tag,
    sourceAdventureId: args.adventureId,
    sourceSequenceNumber: args.targetSequenceNumber,
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
      capturedAt: new Date().toISOString(),
    },
    playerInput: {
      type: 'message',
      content:
        'TODO: fill in the player message that actually triggered this turn ' +
        `(source adventure ${args.adventureId}, sequence ${args.targetSequenceNumber})`,
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
