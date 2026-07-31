import { runJudgeCall } from './judged/judge';
import { structuralCheckers } from './structural/registry';

import type { AnthropicService } from '../../src/anthropic/anthropic.service';
import type { EvalFixture } from '../fixture.schema';
import type { TurnExecutionResult } from '../turn-result';
import type { EvalCheck } from './registry';
import type { StructuralOutcome, StructuralVerdict } from './structural/types';

export interface CheckObservation {
  verdict: 'pass' | 'fail' | 'not_applicable' | 'error';
  /** Short marker for a report's "Actual: ..." line — a structural
   * checker's `actual` text, a judge's rationale, or an error marker. */
  detail: string;
  /**
   * Whether a judge call actually happened. Always `false` for a structural
   * check; `false` for a judged check whose `judgeGate` settled the rep
   * before the judge was reached.
   *
   * Exists for `eval:judge-variance`, which measures how often a rubric
   * flips against fixed input. It selects candidates by `check.mode`, so a
   * gated judged check would contribute frozen inputs whose verdicts are
   * deterministic — re-running one N times produces N identical answers, a
   * guaranteed non-flip counted in the denominator. That deflates the
   * measured flip rate of the rubric being validated, which is precisely
   * the number the command exists to produce and the one thing that must
   * not be quietly optimistic.
   */
  judgeInvoked: boolean;
  /** Set only when `judgeInvoked` — a rep the gate settled was graded by no
   * rubric, and stamping one on it would imply otherwise. */
  rubricHash?: string;
  notApplicableReason?: string;
  /** Stable grouping key for `notApplicableReason` when the latter
   * interpolates per-rep-variable text — see `StructuralVerdict.actualCode`.
   * Absent means `notApplicableReason` is itself stable and doubles as its
   * own key. */
  notApplicableReasonCode?: string;
  errorMessage?: string;
  durationMs: number;
}

function mapStructuralOutcome(
  outcome: StructuralOutcome,
): 'pass' | 'fail' | 'not_applicable' {
  switch (outcome) {
    case 'PASSED':
      return 'pass';
    case 'FAILED':
      return 'fail';
    case 'NOT_APPLICABLE':
      return 'not_applicable';
  }
}

/**
 * Runs one check against one fixture's turn result, producing the spec's
 * four-verdict `CheckObservation`.
 *
 * Order of operations: the fixture-schema gate first — a check whose
 * `requiresFixtureSchema` the fixture doesn't satisfy never reaches the
 * checker or the judge, and is reported `not_applicable` with a reason
 * naming both versions (see `eval/checks/registry.ts` and spec Part 6) —
 * then dispatch by mode.
 *
 * Anything thrown becomes `error`, never `fail` — a `JudgeOutputError`, an
 * Anthropic API failure, or a structural checker rejecting a malformed
 * fixture. This supersedes `runHarness`'s old behavior of mapping a thrown
 * turn to a failed `FixtureResult`: there, a hard abort lost the whole run;
 * here, an `error` row is recorded and the run continues, so a transient
 * API failure is never indistinguishable from a real regression.
 */
export async function runCheck(
  check: EvalCheck,
  fixture: EvalFixture,
  turnResult: TurnExecutionResult,
  anthropic: AnthropicService,
): Promise<CheckObservation> {
  const start = Date.now();

  if (
    check.requiresFixtureSchema !== undefined &&
    fixture.fixtureSchemaVersion < check.requiresFixtureSchema
  ) {
    return {
      verdict: 'not_applicable',
      detail: 'fixture schema gate',
      judgeInvoked: false,
      notApplicableReason:
        `check "${check.id}" requires fixtureSchemaVersion >= ` +
        `${check.requiresFixtureSchema}, fixture "${fixture.id}" has ` +
        `${fixture.fixtureSchemaVersion}`,
      durationMs: Date.now() - start,
    };
  }

  try {
    if (check.mode === 'structural') {
      const checker =
        structuralCheckers[check.tag as keyof typeof structuralCheckers];
      return fromStructuralVerdict(checker(turnResult, fixture), start);
    }

    // Structural pre-filter, when the check has one: anything structure can
    // settle is settled here, free and deterministically, and only the
    // semantic residual reaches the rubric.
    const gated = check.judgeGate?.(turnResult, fixture);
    if (gated) return fromStructuralVerdict(gated, start);

    const judged = await runJudgeCall(anthropic, fixture, turnResult);
    return {
      verdict: judged.passed ? 'pass' : 'fail',
      detail: judged.rationale,
      judgeInvoked: true,
      rubricHash: check.rubricHash?.(),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      verdict: 'error',
      detail: `check "${check.id}" threw`,
      judgeInvoked: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/** Shared by the structural path and the judged path's gate — both produce
 * a `StructuralVerdict` and must map to a row identically. */
function fromStructuralVerdict(
  verdict: StructuralVerdict,
  start: number,
): CheckObservation {
  return {
    verdict: mapStructuralOutcome(verdict.outcome),
    detail: verdict.actual,
    judgeInvoked: false,
    notApplicableReason:
      verdict.outcome === 'NOT_APPLICABLE' ? verdict.actual : undefined,
    notApplicableReasonCode:
      verdict.outcome === 'NOT_APPLICABLE' ? verdict.actualCode : undefined,
    durationMs: Date.now() - start,
  };
}
