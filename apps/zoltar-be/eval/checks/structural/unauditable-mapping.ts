import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

/**
 * Heuristic, substring-based — see spec's UNAUDITABLE-MAPPING row.
 *
 * Broadened after checking against real replayed output (Part 8): the
 * original pattern only matched exact-tense phrases ("determine which",
 * missing "determin**ing** which") and a short keyword list that real
 * purpose text mostly doesn't use at all — actual GM-improvisation rolls
 * are phrased as "Does Alvarez encounter anything...",  "What does Alvarez
 * notice or find...", "rolling for environmental detail/discovery", not
 * "select"/"decide". These patterns instead target the underlying
 * *function* of the roll (picking what the player perceives/finds/
 * encounters, or which of several NPCs/options applies) regardless of
 * exact verb tense or phrasing.
 */
const NARRATIVE_SELECTION_PATTERN =
  /\bdetermin\w*\s+which\b|\bselect\w*\b|\bdecide\w*\b|\bwhich\s+\w+\s+(?:is|will)\b|\brolling for\b|\brandom\b[^.]{0,30}\b(detail|encounter|event|discovery)\b|\b(what|which)\s+\S+\s+(notices?|finds?|discovers?|encounters?)\b|\bdoes\s+\S+\s+(notice|encounter|find)\b/i;

/**
 * Deliberately narrower than it looks like it should be: a bare "check" is
 * NOT included here, even though it reads as "mechanical" in isolation —
 * real narrative-selection rolls get called "atmosphere check"/"ambient
 * detail... check" just as often as genuine mechanical resolution rolls
 * do, so including it excluded real UNAUDITABLE-MAPPING violations from
 * ever being classified as narrative-selection at all (confirmed against
 * real replayed output). Only terms that specifically imply resolving a
 * *known* mechanical target (to-hit, damage, a named save, armor
 * reduction) belong here.
 */
const MECHANICAL_PATTERN =
  /\bto[- ]?hit\b|\bdamage\b|\bsave\b|\barmor\b|\bcombat roll\b/i;

/** A number followed (loosely) by an interpretation marker — the "this
 * result means that" mapping the rubric requires be stated up front. */
const MAPPING_STATED_PATTERN = /\d[^.]*(?:=|:|\bmeans\b|\bindicates\b)/i;

/**
 * UNAUDITABLE-MAPPING: for rolls whose purpose indicates a narrative-
 * selection/interpretation function (not pure mechanical resolution), the
 * `purpose` string must state the result-to-meaning mapping before the roll
 * fires. Ordering relative to any dependent gm_response/state_update isn't
 * separately checked here — `writeTurnEvents` always writes dice_roll
 * events before gm_response/state_update within a turn, so that half of
 * the assertion is a structural guarantee of the write path, not something
 * a single turn's TurnExecutionResult could ever observe violated.
 */
export function checkUnauditableMapping(
  result: TurnExecutionResult,
): StructuralVerdict {
  const diceRolls = result.gameEvents.filter(
    (e) => e.eventType === 'dice_roll',
  );

  const narrativeRolls = diceRolls.filter((roll) => {
    const purpose = (roll.payload as DiceRollEventPayload).purpose ?? '';
    return (
      NARRATIVE_SELECTION_PATTERN.test(purpose) &&
      !MECHANICAL_PATTERN.test(purpose)
    );
  });

  if (narrativeRolls.length === 0) {
    return {
      passed: true,
      actual: 'no narrative-selection-flavored dice_roll events this turn',
    };
  }

  const violations = narrativeRolls
    .filter(
      (roll) =>
        !MAPPING_STATED_PATTERN.test(
          (roll.payload as DiceRollEventPayload).purpose ?? '',
        ),
    )
    .map(
      (roll) =>
        `sequence ${roll.sequenceNumber}: purpose "${(roll.payload as DiceRollEventPayload).purpose}" ` +
        'does not state a result-to-meaning mapping',
    );

  if (violations.length > 0) {
    return { passed: false, actual: violations.join('; ') };
  }

  return {
    passed: true,
    actual: `${narrativeRolls.length} narrative-selection dice_roll event(s), each states its mapping up front`,
  };
}
