import { getWinningResponseEvent } from '../../harness-runner';

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
  /\b(succeeds?|fails?|you (hit|deal|take|put)|damage is dealt|the (attack|shot|blow) (lands|connects))\b/i;

/**
 * The spec names two distinct blocking mechanisms for this tag: "blocked on
 * missing data OR an unresolved player dice_request." The dice_request half
 * is mechanically observable (a pending row); the missing-data half isn't —
 * there's no "pending stat request" concept anywhere in this system, so the
 * only signal available is the Warden's own language admitting it's
 * narrating ahead of an unresolved decision or roll. That phrasing is close
 * to self-incriminating on its own — a Warden that says "here's what
 * happens regardless" is explicitly telling the reader it's narrating past
 * an unresolved gap — so a match here is treated as a violation directly,
 * independent of whether a dice_request happens to be pending.
 *
 * Broadened after checking against real replayed output (Part 8): the
 * original pattern required the word "while" paired with "decide"/"resolve"
 * nearby, or "regardless OF the number/score/result" specifically. Real
 * phrasing varies more than that — "The world's side of this exchange has
 * already resolved — here's what happens regardless:" uses neither "while"
 * nor "regardless of X," just bare "regardless" as a continuation marker.
 * The `regardless` alternative below requires it be followed by
 * "happens"/a colon/dash (signaling "and here's the continuation"), not
 * just any use of the word — a bare "regardless of the noise outside,
 * nothing has moved" (an unrelated, non-violating sentence) doesn't have
 * that shape and correctly does not match.
 */
const BLOCK_ACKNOWLEDGING_CONTINUATION_PATTERN =
  /\bwhile\b[^.]{0,25}\b(decid\w*|resolv\w*)\b|\bregardless of\b[^.]{0,20}\b(number|score|result)\b|\bhappens?\s+regardless\b|\bregardless\s*[:—-]|\bno matter (what|how)\b/i;

/**
 * NARRATING-PAST-A-BLOCK: the response's narration should stop at the block
 * point rather than continue narrating the blocked action's outcome or
 * escalating the scene regardless of it — whether the block is a pending
 * `dice_request` (mechanically checkable) or missing player-supplied data
 * (only checkable via the Warden's own block-acknowledging language).
 */
export function checkNarratingPastABlock(
  result: TurnExecutionResult,
): StructuralVerdict {
  const winningResponse = getWinningResponseEvent(result);
  const playerText = winningResponse
    ? ((winningResponse.payload as GmResponsePayload).playerText ?? '')
    : '';

  if (BLOCK_ACKNOWLEDGING_CONTINUATION_PATTERN.test(playerText)) {
    return {
      passed: false,
      actual:
        'playerText explicitly acknowledges an unresolved decision/roll and ' +
        `narrates onward anyway: "${playerText}"`,
    };
  }

  const isBlocked = result.diceRequests.some((r) => r.status === 'pending');
  if (!isBlocked) {
    return {
      passed: true,
      actual:
        'no pending dice_request after this turn and no block-acknowledging ' +
        'language in playerText — nothing blocked',
    };
  }

  if (!winningResponse) {
    return {
      passed: true,
      actual:
        'a dice_request is pending, but no gm_response/correction event exists to check',
    };
  }

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
