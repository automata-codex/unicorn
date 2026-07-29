import { requireApplicability } from './types';

import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

const CHECK_ID = 'out-of-order-resolution';

/**
 * A damage/consequence roll phrased as conditional on an outcome that
 * hasn't been confirmed yet — "damage if hit", "rifle damage if combat
 * roll succeeds", "suppression damage if hits land" — is itself evidence
 * the roll fired before its gating check resolved, independent of the two
 * rolls' raw sequence numbers or which entity each names.
 *
 * This replaces an earlier version of this checker that grouped rolls by
 * a snake_case entity token (e.g. `corporate_spy_1`) extracted from
 * `purpose`, on the theory that entity ids would appear in roll purposes
 * the way they do in `campaignState`. Confirmed wrong against real
 * replayed turns (Part 8): the Warden's own `purpose` text uses natural
 * language ("Alvarez", "Contractor Alpha"), never snake_case ids, so the
 * old heuristic silently matched nothing and always passed — exactly the
 * false-pass failure mode flagged in advance under "Known heuristic
 * limitations." Real purpose text also often has no separate to-hit roll
 * to compare against at all: the to-hit is deferred to the player (a
 * pending `dice_request`) while the damage gets pre-rolled "just in case"
 * — which the old two-roll-comparison design couldn't catch even in
 * principle, since it required *both* flavors present in the same turn.
 * The conditional-language signal catches both shapes directly.
 */
const CONDITIONAL_DAMAGE_PATTERN =
  /\b(damage|dmg)\b[^.]{0,40}\bif\b[^.]{0,30}\b(hits?|succeeds?|lands?|connects?)\b/i;

/** Same leading-name convention `system-rolled-player-action.ts` relies on
 * — see that file's `isAttributedTo` for why `startsWith`, not `includes`. */
function isAttributedTo(purpose: string, playerEntity: string): boolean {
  return purpose.toLowerCase().startsWith(playerEntity.toLowerCase());
}

/**
 * OUT-OF-ORDER-RESOLUTION: a damage roll must not fire before the to-hit
 * roll it depends on has resolved, and no dice_roll may precede the turn's
 * own player_action.
 *
 * Situation gating (`fixture.applicability`) only partly repairs this check.
 * Under a model that compresses request and resolution into a single turn,
 * every `dice_roll` this check needs was already in `result.gameEvents`.
 * Under a model that splits them across a turn boundary — issuing a
 * `dice_request` in this turn, resolving it in the next — the ordering
 * behaviour this check exists to catch happens on a turn this fixture
 * doesn't contain. That can't be fixed by better gating; it needs the
 * fixture extended through the follow-up turn (separate task). Until then,
 * a split-turn situation reports `NOT_APPLICABLE` with a reason naming the
 * missing evidence, not the old "no dice_roll events this turn" — honest
 * about *why* nothing was checked, rather than implying the model did
 * something wrong by not rolling.
 */
export function checkOutOfOrderResolution(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): StructuralVerdict {
  const applicability = requireApplicability(fixture, CHECK_ID);
  if (!applicability.applies) {
    return { outcome: 'NOT_APPLICABLE', actual: applicability.situation };
  }
  const { playerEntity } = applicability;

  const diceRolls = result.gameEvents
    .filter((e) => e.eventType === 'dice_roll')
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  if (diceRolls.length === 0) {
    const deferredRequest = result.diceRequests.find(
      (r) => r.status === 'pending' && isAttributedTo(r.purpose, playerEntity),
    );
    if (deferredRequest) {
      return {
        outcome: 'NOT_APPLICABLE',
        actual:
          `the turn deferred ${playerEntity}'s gating roll to a pending dice_request ` +
          `("${deferredRequest.purpose}") rather than resolving it this turn — the ordering ` +
          "evidence this check needs appears on the following turn, which this fixture doesn't contain",
      };
    }
    return {
      outcome: 'NOT_APPLICABLE',
      actual: `the turn produced no dice_roll and no pending dice_request for ${playerEntity} — nothing to order`,
    };
  }

  const playerAction = result.gameEvents.find(
    (e) => e.eventType === 'player_action',
  );
  if (playerAction) {
    const precedingRolls = diceRolls.filter(
      (r) => r.sequenceNumber < playerAction.sequenceNumber,
    );
    if (precedingRolls.length > 0) {
      return {
        outcome: 'FAILED',
        actual:
          `${precedingRolls.length} dice_roll event(s) occurred before this ` +
          `turn's player_action (sequence ${playerAction.sequenceNumber}): ` +
          `sequence(s) ${precedingRolls.map((r) => r.sequenceNumber).join(', ')}`,
      };
    }
  }

  const violations = diceRolls
    .filter((roll) =>
      CONDITIONAL_DAMAGE_PATTERN.test(
        (roll.payload as DiceRollEventPayload).purpose ?? '',
      ),
    )
    .map(
      (roll) =>
        `sequence ${roll.sequenceNumber}: purpose "${(roll.payload as DiceRollEventPayload).purpose}" ` +
        'rolls damage conditioned on an outcome ("if hit/succeeds/lands") ' +
        'that has not been confirmed yet',
    );

  if (violations.length > 0) {
    return { outcome: 'FAILED', actual: violations.join('; ') };
  }

  return {
    outcome: 'PASSED',
    actual: `${diceRolls.length} dice_roll event(s) this turn, no damage-before-to-hit ordering violation found`,
  };
}
