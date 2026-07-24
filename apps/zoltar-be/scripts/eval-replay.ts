/**
 * eval:replay — evaluates one already-captured scratch adventure against
 * its fixture's checker/rubric, without re-running the fixture's turn.
 *
 * `eval:harness --keep-scratch` leaves `__eval__`-tagged campaign/adventure
 * rows behind (their ids are printed per-fixture in the rendered report,
 * see `eval/report.ts`). Point this at one of those rows to re-evaluate the
 * turn that's already sitting in the database — no new Anthropic call to
 * *generate* narration (non-deterministic, and this repo's own eval fixtures
 * exist precisely because replaying the same turn twice can produce
 * different prose), no new scratch rows, no `--keep-scratch` bookkeeping to
 * track. This is the tool for "I just changed a checker/rubric — does it
 * now correctly judge this exact, already-known-bad turn?"
 *
 * *** For a `judged`-mode fixture this still makes one real, token-costing
 * Anthropic call — the judge grading itself. Only the turn-generation call
 * is skipped, not the whole pipeline. Structural fixtures make no API call
 * at all. ***
 *
 * Usage:
 *   node -r @swc-node/register -r reflect-metadata --env-file=.env \
 *     scripts/eval-replay.ts \
 *     --fixture turn03-unsurfaced-check \
 *     --adventure-id 87d8487e-75c2-4e8b-bf01-2c3a58b5ae17
 *
 * --fixture accepts either a bare fixture id (resolved against
 * `apps/zoltar-be/eval/fixtures/<id>.json`) or an explicit path to a
 * fixture JSON file.
 *
 * --adventure-id is the scratch adventure's row id (from the report's
 * "Adventure: ..." line). Its campaign_id is looked up from the `adventure`
 * row itself, so there's no separate --campaign-id to pass.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { AnthropicService } from '../src/anthropic/anthropic.service';
import * as schema from '../src/db/schema';
import { evalFixtureSchema } from '../eval/fixture.schema';

import { evaluateFixture } from './eval-harness.core';

import type { ConfigService } from '@nestjs/config';
import type { TurnExecutionResult } from '../eval/turn-result';

const FIXTURES_DIR = join(__dirname, '../eval/fixtures');

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

interface CliArgs {
  fixture: string;
  adventureId: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      fixture: { type: 'string' },
      'adventure-id': { type: 'string' },
    },
  });

  if (typeof values.fixture !== 'string' || values.fixture.length === 0) {
    throw new UsageError(
      'missing --fixture <id|path>. Usage: eval-replay --fixture <id|path> ' +
        '--adventure-id <uuid>',
    );
  }
  if (
    typeof values['adventure-id'] !== 'string' ||
    values['adventure-id'].length === 0
  ) {
    throw new UsageError(
      'missing --adventure-id <uuid>. Usage: eval-replay --fixture ' +
        '<id|path> --adventure-id <uuid>',
    );
  }

  return { fixture: values.fixture, adventureId: values['adventure-id'] };
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

/** `AnthropicService` only calls `config.getOrThrow('ANTHROPIC_API_KEY')` —
 * a full `ConfigService`/DI container is unnecessary just to read one env
 * var, so this stubs the one method it actually uses. */
function envOnlyConfigService(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const value = process.env[key];
      if (!value) {
        throw new Error(`eval-replay requires ${key} in the environment`);
      }
      return value;
    },
  } as unknown as ConfigService;
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

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const [adventureRow] = await db
      .select({ campaignId: schema.adventures.campaignId })
      .from(schema.adventures)
      .where(eq(schema.adventures.id, cli.adventureId))
      .limit(1);

    if (!adventureRow) {
      throw new Error(`no adventure row found for id "${cli.adventureId}"`);
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
        .where(eq(schema.gameEvents.adventureId, cli.adventureId))
        .orderBy(asc(schema.gameEvents.sequenceNumber)),
      db
        .select()
        .from(schema.adventureTelemetry)
        .where(eq(schema.adventureTelemetry.adventureId, cli.adventureId))
        .orderBy(asc(schema.adventureTelemetry.sequenceNumber)),
      db
        .select()
        .from(schema.pendingCanon)
        .where(eq(schema.pendingCanon.adventureId, cli.adventureId)),
      db
        .select({ data: schema.campaignStates.data })
        .from(schema.campaignStates)
        .where(eq(schema.campaignStates.campaignId, campaignId))
        .limit(1),
      db
        .select()
        .from(schema.diceRequests)
        .where(eq(schema.diceRequests.adventureId, cli.adventureId)),
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
      // turn-result.ts), only `renderReport`'s debug detail would, and this
      // script doesn't render a report.
      serviceResult: { kind: 'message', result: {} as never },
    };

    const anthropicService = new AnthropicService(envOnlyConfigService());
    const { outcome, expected, actual } = await evaluateFixture(
      fixture,
      turnResult,
      anthropicService,
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          fixtureId: fixture.id,
          tag: fixture.tag,
          mode: fixture.assertion.mode,
          campaignId,
          adventureId: cli.adventureId,
          outcome,
          expected,
          actual,
        },
        null,
        2,
      )}\n`,
    );

    return outcome === 'FAILED' ? 1 : 0;
  } finally {
    await pool.end();
  }
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
