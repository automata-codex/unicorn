/**
 * `eval:run` — runs the eval corpus N times under a named model/temperature,
 * persisting one machine-readable score row per `(fixtureId, checkId,
 * repIndex)` to `$ZOLTAR_EVAL_ROOT/eval-runs/<run-dir>/`. Replaces M7.4's
 * `eval:harness` execution half — this command never renders a report;
 * `eval:report` reads what this writes.
 *
 * *** Hits a real database and makes real, token-costing Anthropic calls —
 * and now **N times** the cost of a single-pass `eval:harness` run, since
 * every fixture runs `--reps` times. Not CI-safe. Keep `--fixtures` narrow
 * and `--reps` low (2) for anything before a deliberate, full-corpus
 * baseline run (see `docs/eval-methodology.md`). ***
 *
 * **Not run via plain `tsx`, like `eval:harness`.** This bootstraps a real
 * NestJS DI container (`eval/harness-runner.ts`'s `createHarnessSession`),
 * and `tsx` (esbuild) does not emit the `design:paramtypes` decorator
 * metadata Nest's constructor injection relies on — every `@Injectable()`
 * would silently receive `undefined` for its dependencies. `@swc-node/register`
 * does emit it correctly, so this runs via plain `node` with that register
 * hook. See `npm run eval:run` / `task eval:run` below — don't invoke this
 * file directly via `tsx`.
 *
 * Usage:
 *   node -r @swc-node/register -r reflect-metadata --env-file=.env \
 *     scripts/eval-run.ts \
 *     --prompt src/wardens/prompts/mothership-m7.txt \
 *     --model claude-sonnet-5 \
 *     --reps 10 \
 *     [--fixtures turn19-out-of-order-resolution,turn24-scene-jump] \
 *     [--fixtures-dir eval/fixtures/] \
 *     [--run-dir <existing-run-dir>] \
 *     [--temperature 1.0] \
 *     [--decision-rule "ship if no fixture drops >0.2 and median rises"] \
 *     [--keep-scratch]
 *
 * Or via the task wrapper (bakes in the flags above):
 *   task eval:run -- --prompt ... --model ... --reps ...
 *
 * --prompt must byte-match a file already present under
 * `src/wardens/prompts/` — this CLI doesn't deploy prompt files, only
 * selects among ones already there (via `WARDEN_PROMPT_OVERRIDE_MOTHERSHIP`).
 *
 * --model is required, with no default — directory identity is `(model,
 * promptHash)`, and defaulting it invites a run whose directory name says
 * one thing while the reader assumes another the day the production
 * default model changes.
 *
 * --fixtures takes fixture **ids** (comma-separated), not a directory —
 * matching the spec's signature. The corpus directory itself defaults to
 * `apps/zoltar-be/eval/fixtures/`, overridable with --fixtures-dir.
 * Deliberately no --tag filter — a second, overlapping selector is a way to
 * run something other than what you think you ran.
 *
 * --run-dir appends reps to an existing run directory instead of creating a
 * new one — a bare directory name (resolved against
 * `$ZOLTAR_EVAL_ROOT/eval-runs/`) or an absolute path. Aborts before writing
 * anything if (model, promptHash, temperature) don't match that directory.
 *
 * --temperature defaults to 1.0 — the API default, i.e. "matches
 * production" — and is recorded on every row regardless.
 */

import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { runEval } from './eval-run.core';
import { defaultRunEvalDeps } from './eval-run.default-deps';

import type { RunEvalProgressEvent } from './eval-run.core';

const DEFAULT_FIXTURES_DIR = join(__dirname, '../eval/fixtures');

const USAGE =
  'Usage: eval-run --prompt <path> --model <id> --reps <n> ' +
  '[--fixtures <id1,id2,...>] [--fixtures-dir <dir>] [--run-dir <existing>] ' +
  '[--temperature <t>] [--decision-rule <text>] [--keep-scratch]';

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

interface CliArgs {
  promptPath: string;
  model: string;
  reps: number;
  fixtureIds?: string[];
  fixturesDir: string;
  runDir?: string;
  temperature: number;
  decisionRule?: string;
  keepScratch: boolean;
  skipPreflight: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      prompt: { type: 'string' },
      model: { type: 'string' },
      reps: { type: 'string' },
      fixtures: { type: 'string' },
      'fixtures-dir': { type: 'string' },
      'run-dir': { type: 'string' },
      temperature: { type: 'string' },
      'decision-rule': { type: 'string' },
      'keep-scratch': { type: 'boolean', default: false },
      'skip-preflight': { type: 'boolean', default: false },
    },
  });

  if (typeof values.prompt !== 'string' || values.prompt.length === 0) {
    throw new UsageError(`missing --prompt <path>. ${USAGE}`);
  }
  if (typeof values.model !== 'string' || values.model.length === 0) {
    throw new UsageError(`missing --model <id>. ${USAGE}`);
  }
  if (typeof values.reps !== 'string' || values.reps.length === 0) {
    throw new UsageError(`missing --reps <n>. ${USAGE}`);
  }
  const reps = Number(values.reps);
  if (!Number.isInteger(reps) || reps <= 0) {
    throw new UsageError(
      `--reps must be a positive integer, got "${values.reps}"`,
    );
  }

  let temperature = 1.0;
  if (typeof values.temperature === 'string') {
    temperature = Number(values.temperature);
    if (Number.isNaN(temperature)) {
      throw new UsageError(
        `--temperature must be a number, got "${values.temperature}"`,
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
    promptPath: values.prompt,
    model: values.model,
    reps,
    fixtureIds,
    fixturesDir:
      typeof values['fixtures-dir'] === 'string'
        ? values['fixtures-dir']
        : DEFAULT_FIXTURES_DIR,
    runDir:
      typeof values['run-dir'] === 'string' ? values['run-dir'] : undefined,
    temperature,
    decisionRule:
      typeof values['decision-rule'] === 'string'
        ? values['decision-rule']
        : undefined,
    keepScratch: values['keep-scratch'] === true,
    skipPreflight: values['skip-preflight'] === true,
  };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Prints to stderr so stdout stays just the final summary — every event
 * lands the moment it happens, no buffering, so a long run never looks
 * stuck even between fixtures that take a while (a judged check's Anthropic
 * call, an off-screen-combat turn's inner tool loop). */
function printProgress(event: RunEvalProgressEvent): void {
  switch (event.type) {
    case 'rep-start':
      process.stderr.write(
        `[rep ${event.repNumber}/${event.totalReps}] starting (index ${event.repIndex})\n`,
      );
      break;
    case 'rep-done':
      process.stderr.write(
        `[rep ${event.repNumber}/${event.totalReps}] done (${seconds(event.durationMs)})\n`,
      );
      break;
    case 'fixture-start':
      process.stderr.write(
        `  [${event.fixtureIndex}/${event.totalFixtures}] ${event.fixtureId} — running...\n`,
      );
      break;
    case 'fixture-done':
      process.stderr.write(
        `  [${event.fixtureIndex}/${event.totalFixtures}] ${event.fixtureId} — ` +
          `${event.verdicts.join(', ')} (${seconds(event.durationMs)})\n`,
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

  const summary = await runEval(
    {
      promptPath: cli.promptPath,
      model: cli.model,
      reps: cli.reps,
      fixturesDir: cli.fixturesDir,
      skipPreflight: cli.skipPreflight,
      fixtureIds: cli.fixtureIds,
      runDir: cli.runDir,
      temperature: cli.temperature,
      decisionRule: cli.decisionRule,
      keepScratch: cli.keepScratch,
      onProgress: printProgress,
    },
    defaultRunEvalDeps(),
  );

  process.stdout.write(`run directory: ${summary.runDir}\n`);
  process.stdout.write(`reps run: ${summary.repsRun.join(', ')}\n`);
  process.stdout.write(
    `rows — pass: ${summary.rowCounts.pass}, fail: ${summary.rowCounts.fail}, ` +
      `not_applicable: ${summary.rowCounts.not_applicable}, error: ${summary.rowCounts.error}\n`,
  );
  for (const warning of summary.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  // Execution and judgment are deliberately separate — a fail/error row is
  // data for `eval:report` to render, not a signal that this *command*
  // failed. Only a genuine abort (caught above, or an uncaught exception
  // below) produces a nonzero exit code.
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
