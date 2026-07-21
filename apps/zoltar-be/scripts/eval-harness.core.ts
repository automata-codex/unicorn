import { randomUUID } from 'node:crypto';

import { resolveRubricText, runJudgeCall } from '../eval/checks/judged/judge';
import { structuralCheckers } from '../eval/checks/structural/registry';
import { FixtureLoadError, loadFixtures } from '../eval/fixture-loader';
import {
  createHarnessSession,
  runFixtureTurn,
  seedScratchAdventure,
  teardownScratchAdventure,
} from '../eval/harness-runner';
import { renderReport } from '../eval/report';

import type { EvalFixture, FailureModeTag } from '../eval/fixture.schema';
import type { TurnExecutionResult } from '../eval/harness-runner';
import type { FixtureResult } from '../eval/report';
import type { AnthropicService } from '../src/anthropic/anthropic.service';

/** Emitted around each fixture's run so a long invocation (a full 14-fixture
 * run can take several minutes — most fixtures make a real, possibly-slow
 * Anthropic call) can report progress instead of appearing to hang. */
export type HarnessProgressEvent =
  | {
      type: 'fixture-start';
      index: number;
      total: number;
      fixture: EvalFixture;
    }
  | {
      type: 'fixture-done';
      index: number;
      total: number;
      fixture: EvalFixture;
      result: FixtureResult;
      durationMs: number;
    };

export interface RunHarnessArgs {
  fixturesDir: string;
  tags?: FailureModeTag[];
  /** A prompt filename already present under `src/wardens/prompts/` (see
   * pre-flight note — `WARDEN_PROMPT_OVERRIDE_MOTHERSHIP`, not the bare
   * `WARDEN_PROMPT_OVERRIDE` the spec's invocation example implies). If
   * omitted, whatever `WardenPromptsService` selects by default runs
   * (highest-versioned prompt file). */
  promptVariant?: string;
  /** Skip `teardownScratchAdventure` for every fixture this run, leaving
   * `__eval__`-tagged campaigns in place for manual inspection. */
  keepScratch?: boolean;
  /** Optional progress callback, fired before and after each fixture.
   * Omitted by tests/callers that don't care about progress. */
  onProgress?: (event: HarnessProgressEvent) => void;
}

export interface RunHarnessResult {
  report: string;
  results: FixtureResult[];
  /** Fixture files that failed to parse/validate — never silently
   * dropped. The CLI decides how loudly to surface these and folds them
   * into its exit-code policy. */
  loadErrors: FixtureLoadError[];
}

/** The fixture's own "what we expected" text — the `check` string as-is
 * for structural fixtures, the resolved (fact-interpolated) rubric text for
 * judged ones. Split out from `evaluateFixture` so the error-handling path
 * in `runHarness` can compute it independent of whether the turn itself
 * completed. */
function expectedTextFor(fixture: EvalFixture): string {
  if (fixture.assertion.mode === 'structural') return fixture.assertion.check;
  return resolveRubricText(fixture);
}

async function evaluateFixture(
  fixture: EvalFixture,
  turnResult: TurnExecutionResult,
  anthropic: AnthropicService,
): Promise<FixtureResult> {
  if (fixture.assertion.mode === 'structural') {
    const checker =
      structuralCheckers[fixture.tag as keyof typeof structuralCheckers];
    if (!checker) {
      throw new Error(
        `no structural checker registered for tag "${fixture.tag}" (fixture "${fixture.id}")`,
      );
    }
    const verdict = checker(turnResult, fixture);
    return {
      fixture,
      passed: verdict.passed,
      expected: fixture.assertion.check,
      actual: verdict.actual,
    };
  }

  const expected = resolveRubricText(fixture);
  const verdict = await runJudgeCall(anthropic, fixture, turnResult);
  return {
    fixture,
    passed: verdict.passed,
    expected,
    actual: verdict.rationale,
  };
}

/**
 * Loads fixtures, runs each through the real turn pipeline under an
 * optional prompt variant, evaluates each against its structural checker
 * or judge rubric, and renders a report. Fixtures run **sequentially** —
 * each hits a real database and, for most fixtures, a real Anthropic call;
 * there's no benefit to the concurrency complexity of parallelizing, and
 * serial execution keeps report ordering predictable.
 *
 * A single fixture's turn failing to even complete — a live model call
 * producing output that fails schema validation, the inner tool loop
 * exhausting its iteration cap, a checker rejecting a malformed fixture —
 * is recorded as a **failed** `FixtureResult` (with the error message as
 * `actual`) rather than aborting the whole run. Originally this did abort
 * the run; Part 8's real-fixture pass found that real LLM output is
 * variable enough (a correction round's own retry occasionally produces
 * further-malformed output; an off-screen combat turn can blow the tool
 * loop cap on one run and not the next) that a hard abort meant a single
 * flaky turn threw away every other fixture's result in the same
 * invocation. A turn that doesn't complete is, if anything, a *stronger*
 * failure signal than the specific bug a fixture's checker was targeting —
 * treating it as a normal failed result rather than a crash is the more
 * useful behavior for what this tool is actually for.
 */
export async function runHarness(
  args: RunHarnessArgs,
): Promise<RunHarnessResult> {
  const { fixtures, errors: loadErrors } = await loadFixtures(
    args.fixturesDir,
    { tags: args.tags },
  );

  // Must be set before `createHarnessSession` bootstraps the app —
  // `WardenPromptsService.onModuleInit` resolves the selected prompt once,
  // at that point, and caches it for the process lifetime.
  if (args.promptVariant) {
    process.env.WARDEN_PROMPT_OVERRIDE_MOTHERSHIP = args.promptVariant;
  }

  const harness = await createHarnessSession();
  const runId = randomUUID();
  const results: FixtureResult[] = [];

  try {
    const total = fixtures.length;
    for (let index = 0; index < total; index++) {
      const fixture = fixtures[index];
      args.onProgress?.({ type: 'fixture-start', index, total, fixture });
      const startedAt = Date.now();

      const seeded = await seedScratchAdventure(harness.db, fixture, {
        runId,
      });
      let result: FixtureResult;
      try {
        const turnResult = await runFixtureTurn(
          harness.db,
          harness.sessionService,
          fixture,
          seeded,
        );
        result = await evaluateFixture(
          fixture,
          turnResult,
          harness.anthropicService,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        let expected: string;
        try {
          expected = expectedTextFor(fixture);
        } catch {
          expected =
            '(unavailable — resolving the expected text itself failed)';
        }
        result = {
          fixture,
          passed: false,
          expected,
          actual: `ERRORED before an assertion could run: ${message}`,
        };
      } finally {
        if (!args.keepScratch) {
          await teardownScratchAdventure(harness.db, seeded.campaignId);
        }
      }

      results.push(result);
      args.onProgress?.({
        type: 'fixture-done',
        index,
        total,
        fixture,
        result,
        durationMs: Date.now() - startedAt,
      });
    }
  } finally {
    await harness.close();
  }

  const runLabel = args.promptVariant ?? 'baseline';
  const report = renderReport(runLabel, results);

  return { report, results, loadErrors };
}
