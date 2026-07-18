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
}

export interface RunHarnessResult {
  report: string;
  results: FixtureResult[];
  /** Fixture files that failed to parse/validate — never silently
   * dropped. The CLI decides how loudly to surface these and folds them
   * into its exit-code policy. */
  loadErrors: FixtureLoadError[];
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
 * A single fixture throwing (a genuinely unexpected error — a live model
 * call failing, a checker rejecting a malformed fixture) aborts the whole
 * run after cleaning up that fixture's own scratch adventure; it does not
 * silently continue past an error the way a resilient batch job might.
 * This is a manually-invoked local tool an operator is watching, not an
 * unattended CI job — see spec "Out of Scope: CI integration."
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
    for (const fixture of fixtures) {
      const seeded = await seedScratchAdventure(harness.db, fixture, {
        runId,
      });
      try {
        const turnResult = await runFixtureTurn(
          harness.db,
          harness.sessionService,
          fixture,
          seeded,
        );
        results.push(
          await evaluateFixture(fixture, turnResult, harness.anthropicService),
        );
      } finally {
        if (!args.keepScratch) {
          await teardownScratchAdventure(harness.db, seeded.campaignId);
        }
      }
    }
  } finally {
    await harness.close();
  }

  const runLabel = args.promptVariant ?? 'baseline';
  const report = renderReport(runLabel, results);

  return { report, results, loadErrors };
}
