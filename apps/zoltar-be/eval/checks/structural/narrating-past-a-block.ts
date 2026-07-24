import { getWinningResponseEvent } from '../../turn-result';

import type { TurnExecutionResult } from '../../turn-result';
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
 * `target` is set once when a dice_request is issued and never updated
 * (confirmed against `session.repository.ts` — no code path writes it after
 * insert), so a `resolved` request whose `target` is still `null` is a hard,
 * non-lexical fact: the stat value this roll's success threshold depended on
 * was never obtained from the player, yet the roll got resolved anyway. This
 * catches the case `BLOCK_ACKNOWLEDGING_CONTINUATION_PATTERN` structurally
 * can't: a Warden that resolves the missing-data block by self-ruling
 * ("you haven't given me your Instinct score, but I'm ruling on the
 * fiction...") rather than by narrating "regardless of the number" while
 * still claiming to wait — the request goes straight from pending to
 * resolved with no target ever set, and `isBlocked` below no longer sees
 * anything blocked by the time this turn's response is checked.
 *
 * Restricted to requests whose `purpose` names a stat/save this system
 * actually has (Mothership's fixed, small vocabulary — not free narration
 * text), so a legitimate narrative-selection roll with no target at all
 * (e.g. "1d6 to determine which of six things happens") isn't misread as a
 * missing-data block — that roll never had a target concept to begin with.
 */
const STAT_CHECK_PATTERN =
  /\b(strength|speed|intellect|combat|sanity|fear|body|instinct)\b[^.]{0,20}\b(roll|check|save)\b/i;

/**
 * NARRATING-PAST-A-BLOCK: the response's narration should stop at the block
 * point rather than continue narrating the blocked action's outcome or
 * escalating the scene regardless of it — whether the block is a pending
 * `dice_request` (mechanically checkable), missing player-supplied data
 * resolved by self-ruling instead of waiting (mechanically checkable via
 * `target`), or missing player-supplied data narrated past outright (only
 * checkable via the Warden's own block-acknowledging language).
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
      outcome: 'FAILED',
      actual:
        'playerText explicitly acknowledges an unresolved decision/roll and ' +
        `narrates onward anyway: "${playerText}"`,
    };
  }

  const unresolvedTargetRolls = result.diceRequests.filter(
    (r) =>
      r.status === 'resolved' &&
      r.target === null &&
      STAT_CHECK_PATTERN.test(r.purpose),
  );
  if (unresolvedTargetRolls.length > 0) {
    return {
      outcome: 'FAILED',
      actual: unresolvedTargetRolls
        .map(
          (r) =>
            `dice_request "${r.purpose}" (${r.notation}) resolved this turn with no target ever ` +
            'set — the stat value it depended on was never obtained from the player before the ' +
            'turn narrated a resolved outcome',
        )
        .join('; '),
    };
  }

  const isBlocked = result.diceRequests.some((r) => r.status === 'pending');
  if (!isBlocked) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'no pending dice_request after this turn, no resolved dice_request with a missing ' +
        'target, and no block-acknowledging language in playerText — nothing blocked',
    };
  }

  if (!winningResponse) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'a dice_request is pending, but no gm_response/correction event exists to check',
    };
  }

  if (RESOLUTION_LANGUAGE_PATTERN.test(playerText)) {
    return {
      outcome: 'FAILED',
      actual:
        'a dice_request is pending, but playerText contains resolution ' +
        `language suggesting the blocked action was narrated anyway: "${playerText}"`,
    };
  }

  return {
    outcome: 'PASSED',
    actual:
      'a dice_request is pending and playerText contains no resolution-implying language',
  };
}
