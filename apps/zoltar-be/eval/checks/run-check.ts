import { runJudgeCall } from './judged/judge';
import { structuralCheckers } from './structural/registry';

import type { AnthropicService } from '../../src/anthropic/anthropic.service';
import type { EvalFixture } from '../fixture.schema';
import type { TurnExecutionResult } from '../turn-result';
import type { EvalCheck } from './registry';
import type { StructuralOutcome } from './structural/types';

export interface CheckObservation {
  verdict: 'pass' | 'fail' | 'not_applicable' | 'error';
  /** Short marker for a report's "Actual: ..." line — a structural
   * checker's `actual` text, a judge's rationale, or an error marker. */
  detail: string;
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
      const verdict = checker(turnResult, fixture);
      return {
        verdict: mapStructuralOutcome(verdict.outcome),
        detail: verdict.actual,
        notApplicableReason:
          verdict.outcome === 'NOT_APPLICABLE' ? verdict.actual : undefined,
        notApplicableReasonCode:
          verdict.outcome === 'NOT_APPLICABLE' ? verdict.actualCode : undefined,
        durationMs: Date.now() - start,
      };
    }

    const judged = await runJudgeCall(anthropic, fixture, turnResult);
    return {
      verdict: judged.passed ? 'pass' : 'fail',
      detail: judged.rationale,
      rubricHash: check.rubricHash?.(),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      verdict: 'error',
      detail: `check "${check.id}" threw`,
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
