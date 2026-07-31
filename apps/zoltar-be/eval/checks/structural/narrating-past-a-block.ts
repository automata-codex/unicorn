import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

type DiceRequestRow = TurnExecutionResult['diceRequests'][number];

/**
 * Identity for a `dice_request` across the seed/result boundary. `id` is
 * regenerated when a fixture seeds a scratch adventure, so it can't be used;
 * `issuedAtSequence` plus `purpose` is stable, because a seeded request's
 * purpose is fixture data rather than something this turn's Warden wrote.
 */
function requestKey(request: {
  issuedAtSequence?: unknown;
  purpose?: unknown;
}): string {
  return `${String(request.issuedAtSequence)}::${String(request.purpose)}`;
}

/**
 * NARRATING-PAST-A-BLOCK's structural pre-filter — everything about this
 * failure mode that can be settled without reading prose. Registered as the
 * check's `judgeGate` (`eval/checks/registry.ts`); returning `null` sends
 * the turn to the rubric.
 *
 * **What stays here.** A `dice_request` this turn both issued and resolved,
 * with `target` still `null`, is a hard non-lexical fact: `target` is
 * written once at insert and never updated (confirmed against
 * `session.repository.ts`), so the threshold this roll's success depended on
 * was never established, yet the roll was resolved anyway. That is a Warden
 * self-ruling past a missing-data block rather than waiting for it — the
 * case no amount of narration analysis can see, because a Warden doing it
 * cleanly narrates a perfectly ordinary outcome.
 *
 * **What does not stay here, and why.** The two prose matchers this check
 * used to carry are gone. `RESOLUTION_LANGUAGE_PATTERN` read the Warden's
 * standard, correct way of stating a pending roll's stakes as evidence the
 * roll had resolved; a sentence-scoped `if` guard fixed that instance and
 * the pattern then failed identically on commitment language. Both are
 * questions about what narration *means*, which is the judge's job.
 *
 * **Deliberately not gated on "is anything blocked."** The obvious
 * structural applicability test — is a `dice_request` pending at end of turn
 * — is wrong for this check. Half the corpus blocks on data that has no
 * mechanical representation at all: `turn16` is blocked on a stat value the
 * player never supplied, and there is no "pending stat request" concept
 * anywhere in this system. Measured across both frozen runs, gating on a
 * pending request would report `not_applicable` for 19 of `turn16`'s 20 reps
 * — the fixture would stop grading the failure mode it exists for. So the
 * judge decides both whether a block existed and whether narration ran past
 * it, and this check's `applicabilitySource` is `'ungated'`.
 */
export function narratingPastABlockGate(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): StructuralVerdict | null {
  // Requests the fixture seeded are excluded: they were issued by an earlier
  // turn, and their `target` was decided before the Warden under test ran.
  //
  // This is not hypothetical. Every `turn16` rep in both frozen runs — 20 of
  // 20 — resolves a seeded Instinct request that carries `target: null`
  // because the fixture captured it that way. The uncorrected rule read that
  // as a self-ruling violation on every rep of both models, which is most of
  // why the fixture sat at 0/10 and read as "confidently zero" in
  // `docs/eval-methodology.md`. It was measuring the fixture, not the Warden.
  const seededKeys = new Set(
    (fixture.seededState.pendingDiceRequests ?? []).map(requestKey),
  );

  const selfRuled = result.diceRequests.filter(
    (r: DiceRequestRow) =>
      r.status === 'resolved' &&
      r.target === null &&
      !seededKeys.has(requestKey(r)),
  );

  if (selfRuled.length > 0) {
    return {
      outcome: 'FAILED',
      actual: selfRuled
        .map(
          (r) =>
            `dice_request "${r.purpose}" (${r.notation}) was issued and resolved within this ` +
            'turn with no target ever set — the threshold its success depended on was never ' +
            'established, yet the turn narrated a resolved outcome',
        )
        .join('; '),
    };
  }

  return null;
}
