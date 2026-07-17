import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { TurnExecutionResult } from '../../harness-runner';
import type { StructuralVerdict } from './types';

/** Heuristic, substring-based — see spec's UNAUDITABLE-MAPPING row. */
const NARRATIVE_SELECTION_PATTERN =
  /\bdetermine which\b|\bselect\b|\bdecide\b|\bwhich\s+\w+\s+(?:is|will)\b/i;
const MECHANICAL_PATTERN = /\bto[- ]?hit\b|\bdamage\b|\bsave\b|\bcheck\b/i;
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
