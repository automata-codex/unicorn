import { findToolCallSyntax } from '../../../src/session/session.tool-syntax';
import { getWinningResponseEvent } from '../../turn-result';

import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

interface GmResponsePayload {
  playerText?: string;
}

/**
 * TOOL-SYNTAX-LEAK: the narration the player was shown must not contain raw
 * tool-call markup.
 *
 * The failure this catches is not cosmetic. A `submit_gm_response` whose
 * remaining parameters were serialized as text inside `playerText` is
 * schema-valid — `playerText` is the only required field — so before the
 * turn-path guard (`ADR-0097`) it committed silently, showed the markup to
 * the player, and discarded every state change the Warden had computed. The
 * 2026-08-16 playtest lost 39 of 58 turns that way, and the four occurrences
 * in the `ccac7d1c` re-baseline were all scored `pass` or `not_applicable`,
 * because no check could see the failure mode at all.
 *
 * **This grades the same detector the turn path enforces**
 * (`src/session/session.tool-syntax.ts`), not a second implementation of the
 * rule. A checker with its own copy of the token set would drift from the
 * guard, and the direction of drift that matters is the harness reporting
 * clean while production rejects — or the reverse, which reads as a Warden
 * regression when it is a harness disagreement.
 *
 * **Universal, not tag-independent.** It is attached to every fixture with
 * no `applicability` entry — see `universalCheckIds` in
 * `eval/checks/registry.ts` for why a fail-closed authored entry is the
 * wrong shape for a check whose subject exists on every turn.
 */
export function checkToolSyntaxLeak(
  result: TurnExecutionResult,
): StructuralVerdict {
  const winning = getWinningResponseEvent(result);
  if (!winning) {
    // A `diceResult` submission without auto-advance resolves a roll and
    // writes no gm_response, so there is no narration to inspect. This is
    // the check's only artifact-dependent branch and the reason it declares
    // `applicabilitySource: 'artifact'` rather than `'ungated'`.
    return {
      outcome: 'NOT_APPLICABLE',
      actual: 'the turn produced no gm_response or correction event',
    };
  }

  // The winning event on purpose: the question is what the player was
  // shown. A superseded original is not player-visible, and since the
  // turn-path guard rejects a leaked payload before it can commit, a leak
  // surviving into the winning event is the case worth grading.
  const playerText = (winning.payload as GmResponsePayload).playerText ?? '';
  const found = findToolCallSyntax(playerText);

  if (!found) {
    return {
      outcome: 'PASSED',
      actual: 'playerText contains no tool-call markup',
    };
  }

  return {
    outcome: 'FAILED',
    actual:
      `playerText contains raw tool-call syntax at offset ${found.index} ` +
      `(${found.matchCount} match(es): ${found.tokens.join(' ')}) — the ` +
      'remaining parameters were serialized into the narration, so any ' +
      'stateChanges / gmUpdates / diceRequests this turn computed were lost',
  };
}
