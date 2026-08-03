/**
 * `eval:report` — renders a markdown report from a run directory's vouched
 * score rows. Pure rendering: no DB, no network, no Anthropic. Replaces the
 * rendering half of M7.4's `eval:harness` — execution now lives in
 * `eval:run`, and nothing downstream parses markdown.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/eval-report.ts <run-dir> \
 *     [--scoring run|rescore|rescore=<timestamp>] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:report -- <run-dir> [--scoring <sel>] [--output <path>]
 *
 * <run-dir> is a bare run directory name (resolved against
 * `$ZOLTAR_EVAL_ROOT/eval-runs/`) or an absolute path.
 *
 * `--scoring` picks which grading of the run to render. A run directory can
 * hold several: its own `reps/<nnn>/scores.jsonl`, plus one file per
 * `eval:rescore` pass. With no flag the most recent re-score wins, falling
 * back to the run's own scores when there is none — and the choice is named
 * in the report title, in a `- Scoring:` header bullet, and on stderr, so it
 * is a default rather than an assumption.
 *
 * Needs only `ZOLTAR_EVAL_ROOT` from the environment — never `DATABASE_URL`,
 * `ANTHROPIC_API_KEY`, or anything else `.env` carries for the server. Plain
 * `tsx` is fine here, unlike `eval:run`/`eval:harness` — this never
 * bootstraps Nest's DI container.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { readManifest } from '../eval/runs/manifest';
import {
  listRepDirsOnDisk,
  resolveEvalRoot,
  resolveRunDirArg,
} from '../eval/runs/paths';
import { computeRates, summarizeExclusions } from '../eval/runs/rates';
import { renderRunReport } from '../eval/runs/report-multi';
import {
  parseScoringArg,
  resolveScoring,
  ScoringSourceError,
} from '../eval/runs/scoring-source';

import type { ScoringSelector } from '../eval/runs/scoring-source';

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const USAGE =
  'Usage: eval-report <run-dir> [--scoring run|rescore|rescore=<timestamp>] ' +
  '[--output <path>]';

interface CliArgs {
  runDir: string;
  scoring: ScoringSelector;
  output?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      scoring: { type: 'string' },
      output: { type: 'string' },
    },
  });

  if (positionals.length !== 1) {
    throw new UsageError(
      `expected exactly one positional argument, <run-dir>. ${USAGE}`,
    );
  }

  let scoring: ScoringSelector;
  try {
    scoring = parseScoringArg(
      typeof values.scoring === 'string' ? values.scoring : undefined,
    );
  } catch (err) {
    throw new UsageError(
      `${err instanceof Error ? err.message : String(err)}. ${USAGE}`,
    );
  }

  return {
    runDir: positionals[0],
    scoring,
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
  const runDir = resolveRunDirArg(root, cli.runDir);

  const manifest = readManifest(runDir);

  let scoring: ReturnType<typeof resolveScoring>;
  try {
    scoring = resolveScoring(runDir, cli.scoring);
  } catch (err) {
    if (err instanceof ScoringSourceError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }

  if (scoring.defaultedToRescore) {
    process.stderr.write(
      `no --scoring given; rendering the most recent re-score (${scoring.label}) ` +
        `rather than the run's own scores. Pass --scoring run for those.\n`,
    );
  }

  const rates = computeRates(scoring.rows);
  const exclusionsSummary = summarizeExclusions(
    scoring.rows,
    scoring.exclusions,
    listRepDirsOnDisk(runDir),
  );

  const report = renderRunReport(manifest, rates, exclusionsSummary, scoring);

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
