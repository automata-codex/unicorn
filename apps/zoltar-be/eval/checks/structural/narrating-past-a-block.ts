import type { TurnExecutionResult } from '../../harness-runner';
import type { StructuralVerdict } from './types';

interface GmResponsePayload {
  playerText: string;
}

/**
 * Language implying a blocked action already resolved — a rough proxy for
 * "narration continued past the point it should have stopped at." This is
 * the weakest of the six structural checkers: unlike roll-sequencing or
 * roll_source (mechanically observable facts), "did the narration stop at
 * the right point" is fundamentally a prose-content judgment. Kept as a
 * best-effort keyword heuristic for now; if it proves too noisy against
 * real fixtures, this tag may need a judged (LLM-graded) fallback instead —
 * flagged explicitly, not silently accepted as solved.
 */
const RESOLUTION_LANGUAGE_PATTERN =
  /\b(succeeds?|fails?|you (hit|deal|take)|damage is dealt|the (attack|shot|blow) (lands|connects))\b/i;

/**
 * NARRATING-PAST-A-BLOCK: if the turn left a pending `dice_request`
 * unresolved, the response's narration should stop at the block point
 * rather than continue narrating the blocked action's outcome.
 */
export function checkNarratingPastABlock(
  result: TurnExecutionResult,
): StructuralVerdict {
  const isBlocked = result.diceRequests.some((r) => r.status === 'pending');
  if (!isBlocked) {
    return {
      passed: true,
      actual: 'no pending dice_request after this turn — nothing blocked',
    };
  }

  const responseEvents = result.gameEvents
    .filter(
      (e) => e.eventType === 'gm_response' || e.eventType === 'correction',
    )
    .sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  const winningResponse = responseEvents[0];
  if (!winningResponse) {
    return {
      passed: true,
      actual:
        'a dice_request is pending, but no gm_response/correction event exists to check',
    };
  }

  const playerText =
    (winningResponse.payload as GmResponsePayload).playerText ?? '';
  if (RESOLUTION_LANGUAGE_PATTERN.test(playerText)) {
    return {
      passed: false,
      actual:
        'a dice_request is pending, but playerText contains resolution ' +
        `language suggesting the blocked action was narrated anyway: "${playerText}"`,
    };
  }

  return {
    passed: true,
    actual:
      'a dice_request is pending and playerText contains no resolution-implying language',
  };
}
