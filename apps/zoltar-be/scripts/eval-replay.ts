/**
 * eval:replay — evaluates one already-captured turn against a fixture's
 * checks, without re-running the turn itself. Two independent modes:
 *
 * **Artifact mode** (`--run-dir --rep`) — re-evaluates a frozen
 * `warden-output.json` written by `eval:run`, with **no database at all**.
 * This is the primary checker-iteration surface: "I just changed a
 * checker/rubric — does it now correctly judge this exact, already-known
 * turn?" needs no scratch campaign, no `--keep-scratch` bookkeeping, and
 * works even after the run directory's scratch rows were torn down (the
 * default).
 *
 * **Database mode** (`--adventure-id`) — re-evaluates a scratch adventure
 * still sitting in the database, left behind by `eval:run --keep-scratch`.
 * Still useful when you want to inspect the live rows directly (`psql`,
 * `eval:replay` output, whatever) rather than just the frozen artifact.
 *
 * *** For a `judged`-mode fixture, either mode still makes one real,
 * token-costing Anthropic call — the judge grading itself. Only the
 * turn-generation call is skipped, not the whole pipeline. Structural
 * fixtures make no API call at all. ***
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/eval-replay.ts \
 *     --fixture turn24-scene-jump --run-dir <run-dir> --rep 1
 *
 *   npx tsx --env-file=.env scripts/eval-replay.ts \
 *     --fixture turn03-unsurfaced-check \
 *     --adventure-id 87d8487e-75c2-4e8b-bf01-2c3a58b5ae17
 *
 * --fixture accepts either a bare fixture id (resolved against
 * `apps/zoltar-be/eval/fixtures/<id>.json`) or an explicit path to a
 * fixture JSON file — needed in both modes for `assertion.facts` (judged
 * checks) and to select the right check via the Part 3 registry.
 *
 * --run-dir is a bare run directory name (resolved against
 * `$ZOLTAR_EVAL_ROOT/eval-runs/`) or an absolute path; --rep is the rep
 * index whose artifact to read. --adventure-id is the scratch adventure's
 * row id; its campaign_id is looked up from the `adventure` row itself.
 * --adventure-id and --run-dir/--rep are mutually exclusive.
 *
 * Exit code is 1 if any check's verdict is `fail` or `error`, 0 otherwise
 * (`pass`/`not_applicable`).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { selectChecksForFixture } from '../eval/checks/registry';
import { runCheck } from '../eval/checks/run-check';
import { evalFixtureSchema } from '../eval/fixture.schema';
import { readTurnResultArtifact } from '../eval/runs/artifacts';
import { envOnlyConfigService } from '../eval/runs/env-config-service';
import { resolveEvalRoot, resolveRunDirArg } from '../eval/runs/paths';
import { AnthropicService } from '../src/anthropic/anthropic.service';
import * as schema from '../src/db/schema';

import type { CheckObservation } from '../eval/checks/run-check';
import type { EvalFixture } from '../eval/fixture.schema';
import type { TurnExecutionResult } from '../eval/turn-result';

interface CheckReplayResult extends CheckObservation {
  checkId: string;
  tag: string;
  checkMode: 'structural' | 'judged';
}

const FIXTURES_DIR = join(__dirname, '../eval/fixtures');

const USAGE =
  'Usage: eval-replay --fixture <id|path> ' +
  '(--run-dir <dir> --rep <n> | --adventure-id <uuid>)';

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

interface CliArgs {
  fixture: string;
  adventureId?: string;
  runDir?: string;
  rep?: number;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      fixture: { type: 'string' },
      'adventure-id': { type: 'string' },
      'run-dir': { type: 'string' },
      rep: { type: 'string' },
    },
  });

  if (typeof values.fixture !== 'string' || values.fixture.length === 0) {
    throw new UsageError(`missing --fixture <id|path>. ${USAGE}`);
  }

  const hasAdventureId =
    typeof values['adventure-id'] === 'string' &&
    values['adventure-id'].length > 0;
  const hasRunDir =
    typeof values['run-dir'] === 'string' && values['run-dir'].length > 0;
  const hasRep = typeof values.rep === 'string' && values.rep.length > 0;

  if (hasAdventureId && (hasRunDir || hasRep)) {
    throw new UsageError(
      `--adventure-id and --run-dir/--rep are mutually exclusive. ${USAGE}`,
    );
  }
  if (hasRunDir !== hasRep) {
    throw new UsageError(
      `--run-dir and --rep must be given together. ${USAGE}`,
    );
  }
  if (!hasAdventureId && !hasRunDir) {
    throw new UsageError(
      `give either --adventure-id <uuid> or --run-dir <dir> --rep <n>. ${USAGE}`,
    );
  }

  let rep: number | undefined;
  if (hasRep) {
    rep = Number(values.rep);
    if (!Number.isInteger(rep) || rep <= 0) {
      throw new UsageError(
        `--rep must be a positive integer, got "${values.rep}"`,
      );
    }
  }

  return {
    fixture: values.fixture,
    adventureId: hasAdventureId
      ? (values['adventure-id'] as string)
      : undefined,
    runDir: hasRunDir ? (values['run-dir'] as string) : undefined,
    rep,
  };
}

function resolveFixturePath(fixtureArg: string): string {
  if (existsSync(fixtureArg)) return fixtureArg;
  const byId = join(FIXTURES_DIR, `${fixtureArg}.json`);
  if (existsSync(byId)) return byId;
  throw new UsageError(
    `no fixture file found for "${fixtureArg}" — tried it as a literal ` +
      `path and as ${byId}`,
  );
}

/** Runs every check the Part 3 registry selects for this fixture (today,
 * always exactly one) and prints the results. Shared by both modes so
 * neither duplicates the dispatch/exit-code logic. */
async function evaluateAndPrint(
  fixture: EvalFixture,
  turnResult: TurnExecutionResult,
  anthropicService: AnthropicService,
  context: Record<string, unknown>,
): Promise<number> {
  const checks = selectChecksForFixture(fixture);
  const results: CheckReplayResult[] = [];
  for (const check of checks) {
    // A judged check makes a real Anthropic call that can take several
    // seconds — print before/after so this never looks stuck.
    process.stderr.write(`[${check.id}] running (${check.mode})...\n`);
    const observation = await runCheck(
      check,
      fixture,
      turnResult,
      anthropicService,
    );
    process.stderr.write(
      `[${check.id}] ${observation.verdict} (${(observation.durationMs / 1000).toFixed(1)}s)\n`,
    );
    results.push({
      checkId: check.id,
      tag: check.tag,
      checkMode: check.mode,
      ...observation,
    });
  }

  process.stdout.write(
    `${JSON.stringify({ fixtureId: fixture.id, ...context, results }, null, 2)}\n`,
  );

  return results.some((r) => r.verdict === 'fail' || r.verdict === 'error')
    ? 1
    : 0;
}

async function runArtifactMode(
  fixture: EvalFixture,
  runDirArg: string,
  rep: number,
): Promise<number> {
  const root = resolveEvalRoot();
  const runDir = resolveRunDirArg(root, runDirArg);
  const turnResult = readTurnResultArtifact(runDir, rep, fixture.id);
  const anthropicService = new AnthropicService(envOnlyConfigService());

  return evaluateAndPrint(fixture, turnResult, anthropicService, {
    runDir,
    rep,
  });
}

async function runDatabaseMode(
  fixture: EvalFixture,
  adventureId: string,
): Promise<number> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const [adventureRow] = await db
      .select({ campaignId: schema.adventures.campaignId })
      .from(schema.adventures)
      .where(eq(schema.adventures.id, adventureId))
      .limit(1);

    if (!adventureRow) {
      throw new Error(`no adventure row found for id "${adventureId}"`);
    }
    const campaignId = adventureRow.campaignId;

    const [
      gameEvents,
      telemetryRows,
      pendingCanonRows,
      campaignStateRow,
      diceRequestRows,
    ] = await Promise.all([
      db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.adventureId, adventureId))
        .orderBy(asc(schema.gameEvents.sequenceNumber)),
      db
        .select()
        .from(schema.adventureTelemetry)
        .where(eq(schema.adventureTelemetry.adventureId, adventureId))
        .orderBy(asc(schema.adventureTelemetry.sequenceNumber)),
      db
        .select()
        .from(schema.pendingCanon)
        .where(eq(schema.pendingCanon.adventureId, adventureId)),
      db
        .select({ data: schema.campaignStates.data })
        .from(schema.campaignStates)
        .where(eq(schema.campaignStates.campaignId, campaignId))
        .limit(1),
      db
        .select()
        .from(schema.diceRequests)
        .where(eq(schema.diceRequests.adventureId, adventureId)),
    ]);

    const turnResult: TurnExecutionResult = {
      gameEvents,
      telemetry: telemetryRows.at(-1) ?? null,
      pendingCanon: pendingCanonRows,
      campaignState: (campaignStateRow[0]?.data ?? {}) as Record<
        string,
        unknown
      >,
      diceRequests: diceRequestRows,
      // No turn is re-run here, so there's no live SessionService result to
      // carry — no checker or judge rubric reads this field (see
      // turn-result.ts), and this script prints raw check results, not a
      // report.
      serviceResult: { kind: 'message', result: {} as never },
    };

    const anthropicService = new AnthropicService(envOnlyConfigService());
    return await evaluateAndPrint(fixture, turnResult, anthropicService, {
      campaignId,
      adventureId,
    });
  } finally {
    await pool.end();
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

  const fixturePath = resolveFixturePath(cli.fixture);
  const fixture = evalFixtureSchema.parse(
    JSON.parse(await readFile(fixturePath, 'utf-8')),
  );

  if (cli.runDir !== undefined) {
    return runArtifactMode(fixture, cli.runDir, cli.rep!);
  }
  return runDatabaseMode(fixture, cli.adventureId!);
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
