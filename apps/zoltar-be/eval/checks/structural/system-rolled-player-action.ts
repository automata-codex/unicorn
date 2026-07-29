import { requireApplicability } from './types';

import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

const CHECK_ID = 'system-rolled-player-action';

/**
 * Purpose text attribution: the Warden's own convention is to lead a roll's
 * purpose with the acting entity's name ("Alvarez rifle damage if hit"),
 * so a `startsWith` match on the fixture-authored `playerEntity` correctly
 * excludes rolls that merely *mention* the player as a target ("Contractor
 * rifle damage to Alvarez if hit lands") — those don't start with the
 * player's name, only contain it.
 */
function isAttributedTo(purpose: string, playerEntity: string): boolean {
  return purpose.toLowerCase().startsWith(playerEntity.toLowerCase());
}

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

  const deferredRequests = result.diceRequests.filter(
    (r) => r.status === 'pending' && isAttributedTo(r.purpose, playerEntity),
  );
  if (deferredRequests.length > 0) {
    return {
      outcome: 'PASSED',
      actual: deferredRequests
        .map(
          (r) =>
            `pending dice_request "${r.purpose}" (${r.notation}) correctly defers ` +
            `${playerEntity}'s action rather than resolving it system-side`,
        )
        .join('; '),
    };
  }

  return {
    outcome: 'PASSED',
    actual:
      `no dice_roll or pending dice_request attributed to ${playerEntity} appears this turn — ` +
      `${playerEntity}'s action was not resolved system-side (whether it was surfaced at all is a ` +
      'different check\'s concern)',
  };
}
