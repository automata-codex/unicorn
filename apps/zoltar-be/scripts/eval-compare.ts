/**
 * `eval:compare` — paired comparison of two `eval:run` directories. Pure
 * rendering over vouched score rows: no DB, no network, no Anthropic.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/eval-compare.ts <run-dir-a> <run-dir-b> \
 *     [--filter-rubric CHECK=HASH]... [--filter-harness <version>] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:compare -- <run-dir-a> <run-dir-b> [--filter-rubric CHECK=HASH]... [--filter-harness <version>] [--output <path>]
 *
 * Each `<run-dir>` is a bare run directory name (resolved against
 * `$ZOLTAR_EVAL_ROOT/eval-runs/`) or an absolute path.
 *
 * Pairs on `(fixtureId, checkId)` — never compares aggregate rates alone.
 * If a judged check's rows within one side span more than one rubric hash
 * (the rubric template was edited mid-run), the report warns and names the
 * exact `--filter-rubric CHECK=HASH` that would reduce that check to a
 * consistent subset — scoped to that one check, so it never touches other
 * checks' rows. A run covering several judged checks normally spans several
 * hashes (one template per check) and does not warn.
 *
 * `--filter-rubric` is repeatable, one per affected check. Passing a bare
 * hash (the old global-filter form) is a usage error. If a filter would
 * zero out a fixture's denominator, that is reported on stderr rather than
 * silently rendered as an empty row.
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
  describeFilterImpact,
  detectHeterogeneity,
  orderForDisplay,
  parseRubricFilters,
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
  'Usage: eval-compare <run-dir-a> <run-dir-b> [--filter-rubric CHECK=HASH]... ' +
  '[--filter-harness <version>] [--output <path>]';

interface CliArgs {
  runDirA: string;
  runDirB: string;
  rubricFilters: Record<string, string>;
  filterHarness?: string;
  output?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'filter-rubric': { type: 'string', multiple: true },
      'filter-harness': { type: 'string' },
      output: { type: 'string' },
    },
  });

  if (positionals.length !== 2) {
    throw new UsageError(
      `expected exactly two positional arguments, <run-dir-a> <run-dir-b>. ${USAGE}`,
    );
  }

  let rubricFilters: Record<string, string>;
  try {
    rubricFilters = parseRubricFilters(values['filter-rubric'] ?? []);
  } catch (err) {
    throw new UsageError(
      `${err instanceof Error ? err.message : String(err)}. ${USAGE}`,
    );
  }

  return {
    runDirA: positionals[0],
    runDirB: positionals[1],
    rubricFilters,
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
    rubricHashByCheckId: cli.rubricFilters,
    harnessVersion: cli.filterHarness,
  };
  const rawRowsA = readVouchedRows(runDirA).rows;
  const rawRowsB = readVouchedRows(runDirB).rows;
  const rowsA = applyFilters(rawRowsA, filters);
  const rowsB = applyFilters(rawRowsB, filters);

  for (const message of describeFilterImpact(
    rawRowsA,
    rowsA,
    cli.rubricFilters,
  )) {
    process.stderr.write(`run A (${cli.runDirA}): ${message}\n`);
  }
  for (const message of describeFilterImpact(
    rawRowsB,
    rowsB,
    cli.rubricFilters,
  )) {
    process.stderr.write(`run B (${cli.runDirB}): ${message}\n`);
  }

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
