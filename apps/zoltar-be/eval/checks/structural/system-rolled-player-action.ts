import { isAttributedTo, unbindableVerdict } from './attribution';
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

  const violatingRolls = diceRolls.filter((roll) => {
    const payload = roll.payload as DiceRollEventPayload;
    return (
      isAttributedTo(payload.purpose ?? '', playerEntity) &&
      roll.rollSource !== 'player_entered'
    );
  });

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
  const undecided = unbindableVerdict(result, playerEntity);
  if (undecided) return undecided;

  return {
    outcome: 'PASSED',
    actual:
      `this turn produced no dice_roll and no dice_request at all, so ${playerEntity}'s ` +
      'action was not resolved system-side (whether it was surfaced at all is a ' +
      "different check's concern)",
  };
}
