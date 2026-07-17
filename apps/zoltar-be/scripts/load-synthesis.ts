#!/usr/bin/env tsx
/**
 * M7.1 load-synthesis CLI — materializes the automatically-captured
 * synthesis snapshot for a source adventure (see
 * `SynthesisRepository.writeGmContextAtomic`, M7.3) into a new campaign +
 * adventure, ready to play. The loaded adventure uses fresh UUIDs; loading
 * from the same source adventure twice produces two distinct campaigns so N
 * candidate Warden prompts can run against the same starting conditions.
 *
 * Usage:
 *   npx tsx scripts/load-synthesis.ts <source-adventure-id>
 *   npx tsx scripts/load-synthesis.ts <source-adventure-id> --name "Prompt A run"
 *
 * Or via the task wrapper:
 *   task playtest:load-synthesis -- <source-adventure-id>
 *
 * Environment:
 *   PLAYTEST_LOAD_USER_ID — user id to own the new campaign. Unset →
 *   falls back to the first user row with a printed warning. No users →
 *   the script exits non-zero.
 */

import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';

import {
  buildAndRunLoad,
  LoadSynthesisError,
  loadSynthesisSnapshot,
} from './load-synthesis.core';

interface CliArgs {
  sourceAdventureId: string;
  nameOverride: string | null;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
    },
  });
  if (positionals.length === 0) {
    throw new UsageError(
      'missing <source-adventure-id>. Usage: load-synthesis <source-adventure-id> [--name <string>]',
    );
  }
  if (positionals.length > 1) {
    throw new UsageError(
      `unexpected extra arguments: ${positionals.slice(1).join(', ')}`,
    );
  }
  return {
    sourceAdventureId: positionals[0],
    nameOverride: typeof values.name === 'string' ? values.name : null,
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

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  try {
    const exportPayload = await loadSynthesisSnapshot(
      db,
      cli.sourceAdventureId,
    );

    const result = await buildAndRunLoad(db, {
      exportPayload,
      nameOverride: cli.nameOverride ?? undefined,
      userId: process.env.PLAYTEST_LOAD_USER_ID,
    });

    for (const w of result.warnings) {
      process.stderr.write(`warning: ${w}\n`);
    }
    process.stdout.write(
      `loaded from adventure ${cli.sourceAdventureId}\n` +
        `  campaign: ${result.campaignId} — ${result.campaignName}\n` +
        `  adventure: ${result.adventureId}\n` +
        `  owner:    ${result.resolvedUserId}\n\n` +
        `Play URL: ${result.playUrl}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof LoadSynthesisError) {
      process.stderr.write(`${err.message}\n`);
      return err.exitCode;
    }
    throw err;
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
