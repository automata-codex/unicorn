/**
 * `eval:compare` — paired comparison of two `eval:run` directories. Pure
 * rendering over vouched score rows: no DB, no network, no Anthropic.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/eval-compare.ts <run-dir-a> <run-dir-b> \
 *     [--filter-rubric <hash>] [--filter-harness <version>] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:compare -- <run-dir-a> <run-dir-b> [--filter-rubric <hash>] [--filter-harness <version>] [--output <path>]
 *
 * Each `<run-dir>` is a bare run directory name (resolved against
 * `$ZOLTAR_EVAL_ROOT/eval-runs/`) or an absolute path.
 *
 * Pairs on `(fixtureId, checkId)` — never compares aggregate rates alone.
 * If either side's rows span more than one `rubricHash`/`harnessVersion`,
 * the report warns and names the exact `--filter-rubric`/`--filter-harness`
 * value that would reduce it to a consistent subset; it never discards a
 * side on its own.
 *
 * Needs only `ZOLTAR_EVAL_ROOT` from the environment — never `DATABASE_URL`,
 * `ANTHROPIC_API_KEY`, or anything else `.env` carries for the server. Plain
 * `tsx` is fine here — no Nest DI container.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import {
  applyFilters,
  comparePairs,
  detectHeterogeneity,
  orderForDisplay,
} from '../eval/runs/compare';
import { renderCompareReport } from '../eval/runs/compare-report';
import { readManifest } from '../eval/runs/manifest';
import { resolveEvalRoot, resolveRunDirArg } from '../eval/runs/paths';
import { computeRates } from '../eval/runs/rates';
import { readVouchedRows } from '../eval/runs/scores';

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const USAGE =
  'Usage: eval-compare <run-dir-a> <run-dir-b> [--filter-rubric <hash>] ' +
  '[--filter-harness <version>] [--output <path>]';

interface CliArgs {
  runDirA: string;
  runDirB: string;
  filterRubric?: string;
  filterHarness?: string;
  output?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'filter-rubric': { type: 'string' },
      'filter-harness': { type: 'string' },
      output: { type: 'string' },
    },
  });

  if (positionals.length !== 2) {
    throw new UsageError(
      `expected exactly two positional arguments, <run-dir-a> <run-dir-b>. ${USAGE}`,
    );
  }

  return {
    runDirA: positionals[0],
    runDirB: positionals[1],
    filterRubric:
      typeof values['filter-rubric'] === 'string'
        ? values['filter-rubric']
        : undefined,
    filterHarness:
      typeof values['filter-harness'] === 'string'
        ? values['filter-harness']
        : undefined,
    output: typeof values.output === 'string' ? values.output : undefined,
  };
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
  const runDirA = resolveRunDirArg(root, cli.runDirA);
  const runDirB = resolveRunDirArg(root, cli.runDirB);

  const manifestA = readManifest(runDirA);
  const manifestB = readManifest(runDirB);

  const filters = {
    rubricHash: cli.filterRubric,
    harnessVersion: cli.filterHarness,
  };
  const rowsA = applyFilters(readVouchedRows(runDirA).rows, filters);
  const rowsB = applyFilters(readVouchedRows(runDirB).rows, filters);

  const heterogeneityA = detectHeterogeneity(rowsA, `run A (${cli.runDirA})`);
  const heterogeneityB = detectHeterogeneity(rowsB, `run B (${cli.runDirB})`);

  const pairs = orderForDisplay(
    comparePairs(computeRates(rowsA), computeRates(rowsB)),
  );

  const report = renderCompareReport(
    manifestA,
    manifestB,
    pairs,
    heterogeneityA.warnings,
    heterogeneityB.warnings,
  );

  if (cli.output) {
    await mkdir(dirname(cli.output), { recursive: true });
    await writeFile(cli.output, report);
    process.stdout.write(`report written to ${cli.output}\n`);
  } else {
    process.stdout.write(report);
    if (!report.endsWith('\n')) process.stdout.write('\n');
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
