import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { TurnExecutionResult } from '../../harness-runner';
import type { StructuralVerdict } from './types';

/**
 * Heuristic: rolls whose purpose implies the outcome gates what the player
 * perceives/discovers — perception, stealth, and search checks are the
 * clearest examples of "rolls that gate player-visible content." Same
 * caveat class as this file's siblings: a substring classifier over free
 * text, not a guaranteed-general parser.
 */
const PLAYER_VISIBLE_STAKES_PATTERN =
  /\b(notice|spot|perceive|detect|discover|overhear|sneak|stealth|search|hidden)\w*\b/i;

/**
 * UNSURFACED-CHECK: a roll that gates player-visible content should produce
 * a `dice_request` to the player rather than the system silently resolving
 * it. `dice_roll.payload.requestId` is set only when a roll resolves a
 * previously-issued `dice_request` (see `applyDiceResultAtomic`) — its
 * absence on a system-generated, stakes-gating roll is the signal this
 * checker looks for.
 */
export function checkUnsurfacedCheck(
  result: TurnExecutionResult,
): StructuralVerdict {
  const diceRolls = result.gameEvents.filter(
    (e) => e.eventType === 'dice_roll',
  );

  const stakesGatingRolls = diceRolls.filter((roll) => {
    const purpose = (roll.payload as DiceRollEventPayload).purpose ?? '';
    return PLAYER_VISIBLE_STAKES_PATTERN.test(purpose);
  });

  if (stakesGatingRolls.length === 0) {
    return {
      passed: true,
      actual:
        'no dice_roll events with player-visible-stakes-flavored purpose this turn',
    };
  }

  const violations = stakesGatingRolls
    .filter((roll) => {
      const payload = roll.payload as DiceRollEventPayload;
      return roll.rollSource === 'system_generated' && !payload.requestId;
    })
    .map(
      (roll) =>
        `sequence ${roll.sequenceNumber}: purpose "${(roll.payload as DiceRollEventPayload).purpose}" ` +
        'resolved system-side with no dice_request surfaced to the player',
    );

  if (violations.length > 0) {
    return { passed: false, actual: violations.join('; ') };
  }

  return {
    passed: true,
    actual: `${stakesGatingRolls.length} player-visible-stakes dice_roll event(s), all either player-entered or resolving a surfaced dice_request`,
  };
}
