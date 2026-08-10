import {
  attributionContext,
  rollActsFor,
  unbindableVerdict,
} from './attribution';
import { requireApplicability } from './types';

import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

const CHECK_ID = 'system-rolled-player-action';

/**
 * SYSTEM-ROLLED-PLAYER-ACTION: a roll representing the player's own
 * declared action should never appear as an already-resolved `dice_roll`
 * event straight from the Warden's tool loop — a well-behaved turn defers
 * it via a `dice_request` instead, resolved in a later turn. Its presence
 * *at all* is the violation, not just its damage sub-roll: an earlier
 * version of this checker only flagged rolls matching a
 * damage-conditional-on-an-unconfirmed-hit pattern, which missed a
 * system-rolled *to-hit* roll entirely (confirmed against real replayed
 * output — a Sonnet 5 run's "Alvarez Combat roll to shoot contractor...
 * (target: under 30)" resolved system-side read as a false PASS).
 *
 * Applicability and the acting player entity are both fixture-authored
 * (`fixture.applicability[checkId]`, `eval/fixture.schema.ts`) rather than
 * inferred from this turn's own output — gating on "did a dice_roll event
 * appear" selects on the model's own choice, not the scenario, and
 * guessing the player entity from `campaignState.resourcePools` naming
 * conventions is exactly the kind of inference this check no longer needs
 * once the fixture states it directly.
 *
 * ---
 *
 * **Audit: what this check reads.** It was flagged for re-verification on
 * the grounds that it hadn't been examined since the re-gating, and that the
 * one check previously described as structure-only turned out not to be.
 * The result, field by field:
 *
 * - `fixture.applicability[...]` — fixture-authored, not model output.
 * - `rollSource` — a column the backend writes.
 * - `dice_request.status` — a column the backend writes. Binding a request
 *   to the player needs no prose at all; a request is player-facing by
 *   construction. This was the audit's first real finding: the check had
 *   been requiring a leading-name match here too, and rejecting correct
 *   turns whose request simply didn't name the player.
 * - `payload.purpose` via `isAttributedTo` — **prose**, and the one
 *   remaining prose dependency in the structural checks. It is not
 *   removable: nothing in `game_events` records who acted, and `actorType`
 *   is `'gm'` for every Warden-side roll whether it represents an NPC or the
 *   player, which is precisely the distinction being drawn. See
 *   `attribution.ts` for the full argument and the `actingEntityId` fix it
 *   waits on.
 *
 * So the answer to "does it read only structure" is no, and the honest
 * response was not to claim otherwise but to stop the prose dependency
 * failing silently — `unbindableVerdict` turns "the name didn't match" into
 * an undecided verdict rather than a pass. Measured on the frozen runs, that
 * costs 2 of 40 reps and leaves the model that behaves correctly untouched.
 *
 * ---
 *
 * **Resolved in M7.5, on the second attempt.** `actingEntityId` now lands on
 * the `roll_dice` payload, and attribution goes through `rollActsFor`: the
 * field when it is present, the prose convention only when it is not. On
 * output produced after M7.5 this check reads structure end to end, and the
 * audit's "the answer is no" becomes "the answer is no for pre-M7.5
 * artifacts only."
 *
 * The prose path is kept rather than deleted because `eval:rescore`
 * re-grades frozen `88fa84bd8329` artifacts that predate the field. Branching
 * on field *presence* — never on `fixtureSchemaVersion`, which records what
 * was captured and captures no game events at all — is what makes those
 * historical verdicts come out unchanged.
 *
 * **The first attempt made this check worse, and the tests did not notice.**
 * It compared `actingEntityId` against `applicability.playerEntity` — an id
 * against a display name — so no player roll ever matched and this check
 * reported 20/20 on a Sonnet 5 run containing the violation verbatim. The
 * lesson worth keeping: a structural check that silently stops matching does
 * not report less, it reports *wrong*, and the only defence is that every
 * "not the player" answer must be traceable to a declared id set rather than
 * to a comparison that happened to fail. See `attribution.ts` and
 * `docs/rules-extraction-findings.md § S30`.
 */
export function checkSystemRolledPlayerAction(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): StructuralVerdict {
  const applicability = requireApplicability(fixture, CHECK_ID);
  if (!applicability.applies) {
    return { outcome: 'NOT_APPLICABLE', actual: applicability.situation };
  }
  const { playerEntity } = applicability;

  const diceRolls = result.gameEvents.filter(
    (e) => e.eventType === 'dice_roll',
  );

  const ctx = attributionContext(fixture, playerEntity);

  // `'player'` only. An `'unknown'` roll is *not* treated as a violation here
  // — it is handled by `unbindableVerdict` below, which turns it into an
  // undecided rep rather than a FAIL, because "the id resolves to nothing"
  // is not evidence that the system rolled the player's action.
  const violatingRolls = diceRolls.filter(
    (roll) =>
      rollActsFor(roll, ctx) === 'player' &&
      roll.rollSource !== 'player_entered',
  );

  if (violatingRolls.length > 0) {
    return {
      outcome: 'FAILED',
      actual: violatingRolls
        .map(
          (r) =>
            `sequence ${r.sequenceNumber}: purpose "${(r.payload as DiceRollEventPayload).purpose}" ` +
            `(rollSource: ${r.rollSource ?? 'unknown'}) — ${playerEntity}'s own action was resolved ` +
            'by the system instead of deferred to a dice_request',
        )
        .join('; '),
    };
  }

  // No `isAttributedTo` here, deliberately. A `dice_request` is player-facing
  // by construction — `roll_dice` is documented as "for system-generated
  // rolls (NPC actions, GM saves...)" while `diceRequests` is "for
  // player-facing rolls where the player interacts with the dice"
  // (`session.tools.ts`), and the backend surfaces every pending request to
  // the player. So a pending request *is* a deferred player roll as a matter
  // of structure, whatever its purpose text happens to say.
  //
  // Requiring a leading-name match here was a real false negative: a
  // manually-verified clean turn deferred Alvarez's roll as "Combat roll to
  // shoot the contractor at the equipment bay door" — correct behaviour,
  // phrased without her name, because a request addressed *to* the player
  // has no reason to name them. See this check's spec for that turn.
  const deferredRequests = result.diceRequests.filter(
    (r) => r.status === 'pending',
  );
  if (deferredRequests.length > 0) {
    return {
      outcome: 'PASSED',
      actual: deferredRequests
        .map(
          (r) =>
            `pending dice_request "${r.purpose}" (${r.notation}) correctly defers ` +
            `a player-facing roll rather than resolving it system-side`,
        )
        .join('; '),
    };
  }

  // Nothing bound to the player. That reads as a pass only when it rests on
  // structure rather than on a prose match having failed — see
  // `unbindableVerdict`, which returns a verdict here when the turn contains
  // rolls or requests that couldn't be attributed to anyone.
  const undecided = unbindableVerdict(result, ctx);
  if (undecided) return undecided;

  return {
    outcome: 'PASSED',
    actual:
      `this turn produced no dice_roll and no dice_request at all, so ${playerEntity}'s ` +
      'action was not resolved system-side (whether it was surfaced at all is a ' +
      "different check's concern)",
  };
}
