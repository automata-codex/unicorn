/**
 * `eval:rescore` — re-grades a run's frozen `warden-output.json` artifacts
 * under the *current* checker registry, without re-running the Warden.
 *
 * This is the tool for a scoring-only corpus bump or a checker change (see
 * `docs/eval-methodology.md`, "Two kinds of corpus bump"): the artifacts on
 * disk remain exactly as valid as they were, so re-scoring them in place is
 * a real measurement, not an approximation of one. It is NOT valid after an
 * input-affecting bump — if the edit changed what reached the Warden, every
 * artifact was produced under different conditions and the only honest
 * response is a fresh `eval:run`.
 *
 * *** Makes real, token-costing Anthropic calls — one judge call per judged
 * fixture-rep. Structural checks are free. No Warden calls, no database. ***
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/eval-rescore.ts <run-dir> \
 *     [--fixtures <id1,id2>] [--fixtures-dir <dir>] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:rescore -- <run-dir> [--fixtures <id1,id2>] [--output <path>]
 *
 * <run-dir> is a bare run directory name (resolved against
 * `$ZOLTAR_EVAL_ROOT/eval-runs/`) or an absolute path.
 *
 * Raw per-row data always lands at `<run-dir>/rescore/<timestamp>.jsonl` —
 * never negotiable, and never under `reps/` (a re-grade under changed
 * checker code is a different measurement than a `scores.jsonl` row and
 * would corrupt every pass-rate denominator if appended there). `--output`
 * controls only where the printed markdown report goes — stdout if omitted.
 *
 * Needs `ANTHROPIC_API_KEY` and `ZOLTAR_EVAL_ROOT` from the environment —
 * never `DATABASE_URL`. No Nest DI container, so plain `tsx` is fine.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { resolveEvalRoot, resolveRunDirArg } from '../eval/runs/paths';

import { defaultRescoreDeps, runRescore } from './eval-rescore.core';
import { renderRescoreReport } from './eval-rescore.report';

import type { RescoreProgressEvent } from './eval-rescore.core';

const DEFAULT_FIXTURES_DIR = join(__dirname, '../eval/fixtures');

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const USAGE =
  'Usage: eval-rescore <run-dir> [--fixtures <id1,id2>] ' +
  '[--fixtures-dir <dir>] [--output <path>]';

interface CliArgs {
  runDir: string;
  fixtureIds?: string[];
  fixturesDir: string;
  output?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
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

  const fixtureIds =
    typeof values.fixtures === 'string'
      ? values.fixtures
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined;

  return {
    runDir: positionals[0],
    fixtureIds,
    fixturesDir:
      typeof values['fixtures-dir'] === 'string'
        ? values['fixtures-dir']
        : DEFAULT_FIXTURES_DIR,
    output: typeof values.output === 'string' ? values.output : undefined,
  };
}

/** Prints to stderr so stdout stays just the report. A full-corpus re-score
 * is a judge call per judged fixture-rep and takes minutes; a changed
 * verdict is called out inline because it's the thing being looked for. */
function printProgress(event: RescoreProgressEvent): void {
  switch (event.type) {
    case 'target-start':
      process.stderr.write(
        `[${event.targetIndex}/${event.totalTargets}] rep ${event.repIndex} / ${event.fixtureId}\n`,
      );
      break;
    case 'check-done': {
      const marker = event.changed
        ? `  ${event.checkId}: ${event.sourceVerdict} → ${event.verdict}  <-- CHANGED`
        : `  ${event.checkId}: ${event.verdict}`;
      process.stderr.write(
        `${marker} (${(event.durationMs / 1000).toFixed(1)}s)\n`,
      );
      break;
    }
    case 'carried-forward':
      process.stderr.write(`  carried forward: ${event.reason}\n`);
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

  const summary = await runRescore(
    {
      runDir,
      fixturesDir: cli.fixturesDir,
      fixtureIds: cli.fixtureIds,
      onProgress: printProgress,
    },
    defaultRescoreDeps(),
  );

  const rendered = renderRescoreReport(summary);
  if (cli.output) {
    await mkdir(dirname(cli.output), { recursive: true });
    await writeFile(cli.output, rendered);
    process.stdout.write(`report written to ${cli.output}\n`);
  } else {
    process.stdout.write(rendered);
    if (!rendered.endsWith('\n')) process.stdout.write('\n');
  }
  process.stderr.write(`\nraw rows: ${summary.outputPath}\n`);

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
