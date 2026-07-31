/**
 * `eval:judge-variance` — re-runs judged checks N times against frozen
 * `warden-output.json` artifacts already on disk. No Warden calls, no
 * database — isolates grader variance from generator variance. Run this
 * once per rubric before interpreting any prompt comparison: if a rubric
 * swings against fixed input, the instability is in the rubric, and
 * nothing downstream is meaningful until it's fixed.
 *
 * *** Makes real, token-costing Anthropic calls — judged fixtures ×
 * vouched reps × --trials judge calls. Structural fixtures are skipped
 * (deterministic over fixed input; re-running one measures nothing). ***
 *
 * Note which axis `--trials` controls. Every vouched `(rep, fixture)` pair in
 * the run is one *frozen input*, and that count comes from the run — nothing
 * here subsamples it. `--trials` is how many times each of those inputs is
 * re-graded, which is what makes a flip observable at all. So a 10-rep run
 * over 5 fixtures at `--trials 3` is 50 inputs × 3 = 150 judge calls, and
 * the progress output walks rep 1..10 per fixture regardless of the value.
 * The flag was called `--reps` until it was mistaken for `eval:run --reps`,
 * which controls the opposite axis.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/eval-judge-variance.ts <run-dir> \
 *     [--trials 3] [--fixtures <id1,id2>] [--fixtures-dir <dir>] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:judge-variance -- <run-dir> [--trials 3] [--fixtures <id1,id2>] [--output <path>]
 *
 * <run-dir> is a bare run directory name (resolved against
 * `$ZOLTAR_EVAL_ROOT/eval-runs/`) or an absolute path.
 *
 * Raw per-trial data always lands at `<run-dir>/judge-variance/<timestamp>.jsonl`
 * — never negotiable, and never under `reps/` (a grader-only re-run is a
 * different measurement than a `scores.jsonl` row and would corrupt every
 * pass-rate denominator if appended there). `--output` controls only where
 * the printed summary below goes — stdout if omitted.
 *
 * Needs `ANTHROPIC_API_KEY` and `ZOLTAR_EVAL_ROOT` from the environment —
 * never `DATABASE_URL`. No Nest DI container, so plain `tsx` is fine.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { resolveEvalRoot, resolveRunDirArg } from '../eval/runs/paths';

import {
  defaultRunJudgeVarianceDeps,
  runJudgeVariance,
} from './eval-judge-variance.core';

import type {
  RunJudgeVarianceProgressEvent,
  RunJudgeVarianceSummary,
} from './eval-judge-variance.core';

const DEFAULT_FIXTURES_DIR = join(__dirname, '../eval/fixtures');
const DEFAULT_TRIALS = 3;

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const USAGE =
  'Usage: eval-judge-variance <run-dir> [--trials <n>] [--fixtures <id1,id2>] ' +
  '[--fixtures-dir <dir>] [--output <path>]';

interface CliArgs {
  runDir: string;
  /** Re-grades per frozen input — NOT a count of source reps, which the run
   * fixes and nothing here subsamples. */
  trials: number;
  fixtureIds?: string[];
  fixturesDir: string;
  output?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      trials: { type: 'string' },
      // Recognised only to give the old name a pointed error instead of
      // node's bare "Unknown option". Drop once nobody's shell history has
      // it.
      reps: { type: 'string' },
      fixtures: { type: 'string' },
      'fixtures-dir': { type: 'string' },
      output: { type: 'string' },
    },
  });

  if (positionals.length !== 1) {
    throw new UsageError(
      `expected exactly one positional argument, <run-dir>. ${USAGE}`,
    );
  }

  if (values.reps !== undefined) {
    throw new UsageError(
      '--reps was renamed to --trials, because it controls how many times ' +
        'each frozen input is re-graded, not how many source reps are used ' +
        '(the run fixes that, and nothing here subsamples it). Unlike ' +
        'eval:run --reps, raising it does not run more of the corpus.',
    );
  }

  let trials = DEFAULT_TRIALS;
  if (typeof values.trials === 'string') {
    trials = Number(values.trials);
    if (!Number.isInteger(trials) || trials <= 0) {
      throw new UsageError(
        `--trials must be a positive integer, got "${values.trials}"`,
      );
    }
  }

  const fixtureIds =
    typeof values.fixtures === 'string'
      ? values.fixtures
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined;

  return {
    runDir: positionals[0],
    trials,
    fixtureIds,
    fixturesDir:
      typeof values['fixtures-dir'] === 'string'
        ? values['fixtures-dir']
        : DEFAULT_FIXTURES_DIR,
    output: typeof values.output === 'string' ? values.output : undefined,
  };
}

function renderSummary(summary: RunJudgeVarianceSummary): string {
  const lines: string[] = [];

  lines.push(`Raw data written to: ${summary.outputPath}`, '');

  lines.push('Headline:');
  if (summary.headlines.length === 0) {
    lines.push('  (no judged checks ran)');
  } else {
    for (const h of summary.headlines) lines.push(`  ${h}`);
  }
  lines.push('');

  lines.push('Per (fixture, check):');
  if (summary.byFixtureCheck.length === 0) {
    lines.push('  (none)');
  } else {
    for (const fc of summary.byFixtureCheck) {
      const distribution = Object.entries(fc.verdictCounts)
        .map(([verdict, count]) => `${verdict}=${count}`)
        .join(', ');
      const flipRate =
        fc.flipRate === null ? 'n/a' : `${(fc.flipRate * 100).toFixed(0)}%`;
      lines.push(
        `  ${fc.fixtureId} / ${fc.checkId}: ${distribution} — flip rate ${flipRate} (${fc.flippedInputs}/${fc.totalInputs} inputs)`,
      );
    }
  }
  lines.push('');

  lines.push('Skipped:');
  if (summary.skipped.length === 0) {
    lines.push('  (none)');
  } else {
    for (const s of summary.skipped) {
      lines.push(`  ${s.fixtureId} / ${s.checkId}: ${s.reason}`);
    }
  }

  return lines.join('\n');
}

/** Prints to stderr, one line per candidate/trial, so a long invocation —
 * each judge call can take several seconds, multiplied by `--trials` across
 * every frozen input — never looks stuck. Stdout stays just the summary. */
function printProgress(event: RunJudgeVarianceProgressEvent): void {
  switch (event.type) {
    case 'input-start':
      process.stderr.write(
        `[${event.candidateIndex}/${event.totalCandidates}] ${event.fixtureId} / ${event.checkId} ` +
          `(rep ${event.sourceRepIndex}) — running...\n`,
      );
      break;
    case 'trial-done':
      process.stderr.write(
        `  trial ${event.trialIndex}/${event.totalTrials}: ${event.verdict} ` +
          `(${(event.durationMs / 1000).toFixed(1)}s)\n`,
      );
      break;
    case 'skipped':
      process.stderr.write(
        `[${event.candidateIndex}/${event.totalCandidates}] ${event.fixtureId} / ${event.checkId} ` +
          `— skipped: ${event.reason}\n`,
      );
      break;
  }
}

async function main(): Promise<number> {
  let cli: CliArgs;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const root = resolveEvalRoot();
  const runDir = resolveRunDirArg(root, cli.runDir);

  const summary = await runJudgeVariance(
    {
      runDir,
      fixturesDir: cli.fixturesDir,
      trials: cli.trials,
      fixtureIds: cli.fixtureIds,
      onProgress: printProgress,
    },
    defaultRunJudgeVarianceDeps(),
  );

  const rendered = renderSummary(summary);
  if (cli.output) {
    await mkdir(dirname(cli.output), { recursive: true });
    await writeFile(cli.output, rendered);
    process.stdout.write(`summary written to ${cli.output}\n`);
  } else {
    process.stdout.write(rendered);
    if (!rendered.endsWith('\n')) process.stdout.write('\n');
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
