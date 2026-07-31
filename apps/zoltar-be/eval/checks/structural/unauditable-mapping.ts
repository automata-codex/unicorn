import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

type GameEventRow = TurnExecutionResult['gameEvents'][number];

/** `1d6` / `d20` — a single die, no arithmetic. Anything with a count above
 * one, or a modifier, is a mechanical resolution roll rather than the
 * "pick an outcome" shape this check grades. */
const SINGLE_DIE_NOTATION = /^\s*(\d*)d(\d+)\s*$/i;

/**
 * A spontaneous GM-side roll: one the Warden invented mid-turn to decide
 * something, as opposed to resolving a mechanic the rules already define.
 *
 * Entirely structural — `rollSource`, `requestId`, `modifier`, `results`,
 * and the shape of `notation`. No prose. That is the whole point: the regex
 * this replaces (`NARRATIVE_SELECTION_PATTERN`) tried to recognise the
 * *function* of a roll from its wording, and encoded the idiom of whichever
 * model was current when it was written — it reached a verdict on 15 of 20
 * reps under 4.6 and 4 of 20 under Sonnet 5 against an unchanged prompt, and
 * returned false NOT_APPLICABLE on twelve turns of "Ambient station event
 * check", the model's own dominant phrasing for exactly the roll type this
 * check exists to grade.
 *
 * The four conditions:
 * - `rollSource === 'system_generated'` — the Warden rolled it, not the player.
 * - no `requestId` — it resolves no `dice_request`, so nothing was surfaced
 *   and no `target` threshold was ever established for it.
 * - `modifier === 0` and a single die — a modified or multi-die roll is
 *   arithmetic against a defined mechanic, not a free choice among outcomes.
 */
export function isSpontaneousGmRoll(event: GameEventRow): boolean {
  if (event.eventType !== 'dice_roll') return false;
  if (event.rollSource !== 'system_generated') return false;

  const payload = event.payload as DiceRollEventPayload;
  if (payload.requestId) return false;
  if ((payload.modifier ?? 0) !== 0) return false;
  if ((payload.results ?? []).length !== 1) return false;

  const match = SINGLE_DIE_NOTATION.exec(payload.notation ?? '');
  return match !== null && (match[1] === '' || match[1] === '1');
}

export function spontaneousGmRolls(
  result: TurnExecutionResult,
): GameEventRow[] {
  return result.gameEvents.filter(isSpontaneousGmRoll);
}

/**
 * UNAUDITABLE-MAPPING's structural pre-filter. Decides *whether there is
 * anything to grade*; the semantic residual — does the roll's `purpose`
 * enumerate outcomes covering the die's range, so the result could be
 * checked against a stated intent rather than interpreted after the fact —
 * goes to the rubric.
 *
 * **The split NOT_APPLICABLE reason is the deliverable, not a nicety.** The
 * old checker collapsed two very different situations into one reason. "The
 * turn rolled nothing" is a fact about the Warden's behaviour and a real,
 * honest exclusion. "The turn rolled N times and none of them matched" is a
 * fact about *this classifier*, and the count is a blind-spot signal: if it
 * climbs, rolls are happening that the check cannot see, and the classifier
 * needs revisiting rather than the rate being read as-is.
 *
 * Measured across both frozen runs, the blind-spot branch fires zero times —
 * whenever a turn rolls at all, at least one roll is a spontaneous GM-side
 * roll. Recorded because an unexercised branch should be known to be
 * unexercised. The no-rolls branch fires 11 times, all under Sonnet 5, which
 * rolls far less than 4.6 on these fixtures.
 */
export function unauditableMappingGate(
  result: TurnExecutionResult,
): StructuralVerdict | null {
  const diceRolls = result.gameEvents.filter(
    (e) => e.eventType === 'dice_roll',
  );

  if (diceRolls.length === 0) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'no dice_roll events this turn — the Warden decided nothing by die, so there is ' +
        'no result-to-meaning mapping to audit',
      actualCode: 'no dice_roll events this turn',
    };
  }

  const candidates = spontaneousGmRolls(result);
  if (candidates.length === 0) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        `${diceRolls.length} dice_roll event(s) this turn, none matching the ` +
        'spontaneous-GM-roll classifier (system-generated, single die, no modifier, ' +
        'resolving no dice_request) — every roll this turn resolved a defined mechanic ' +
        'rather than choosing among outcomes. If this count grows, rolls are happening ' +
        'that this check cannot see and the classifier needs revisiting, not the rate',
      // Deliberately omits the count: the per-fixture grouping in
      // `summarizeExclusions` should collect this branch into one row whose
      // size is the signal, rather than splintering by how many rolls each
      // rep happened to make.
      actualCode:
        'dice_roll events present, none matched the spontaneous-GM-roll classifier',
    };
  }

  return null;
}

/**
 * The candidate rolls, rendered for the judge prompt. Exists so the rubric
 * never has to restate the classifier in prose for the model to re-apply:
 * one implementation picks the rolls, and the judge grades exactly that set.
 * A rubric describing the filter in words would be a second implementation
 * free to drift from this one — the failure mode this whole check is being
 * rebuilt to escape.
 */
export function unauditableMappingJudgeContext(
  result: TurnExecutionResult,
): string {
  const lines = spontaneousGmRolls(result).map((roll) => {
    const payload = roll.payload as DiceRollEventPayload;
    return (
      `- sequence ${roll.sequenceNumber}: notation "${payload.notation}", ` +
      `result ${JSON.stringify(payload.results)}, purpose "${payload.purpose ?? ''}"`
    );
  });

  return (
    'The rolls under review this turn — already filtered to spontaneous GM-side ' +
    'rolls (system-generated, single die, no modifier, resolving no dice_request). ' +
    'Grade only these; ignore every other roll in the sequence above.\n' +
    lines.join('\n')
  );
}
