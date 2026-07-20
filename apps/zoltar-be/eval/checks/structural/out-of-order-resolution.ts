import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { TurnExecutionResult } from '../../harness-runner';
import type { StructuralVerdict } from './types';

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
  /\b(damage|dmg)\b[^.]{0,40}\bif\b[^.]{0,30}\b(hit|succeeds?|lands?|connects?)\b/i;

/**
 * OUT-OF-ORDER-RESOLUTION: a damage roll must not fire before the to-hit
 * roll it depends on has resolved, and no dice_roll may precede the turn's
 * own player_action.
 */
export function checkOutOfOrderResolution(
  result: TurnExecutionResult,
): StructuralVerdict {
  const diceRolls = result.gameEvents
    .filter((e) => e.eventType === 'dice_roll')
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const playerAction = result.gameEvents.find(
    (e) => e.eventType === 'player_action',
  );
  if (playerAction) {
    const precedingRolls = diceRolls.filter(
      (r) => r.sequenceNumber < playerAction.sequenceNumber,
    );
    if (precedingRolls.length > 0) {
      return {
        passed: false,
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
    return { passed: false, actual: violations.join('; ') };
  }

  return {
    passed: true,
    actual: `${diceRolls.length} dice_roll event(s) this turn, no damage-before-to-hit ordering violation found`,
  };
}
