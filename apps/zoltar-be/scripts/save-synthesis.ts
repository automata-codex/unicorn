#!/usr/bin/env tsx
/**
 * M7.1 save-synthesis CLI — freezes an adventure's starting conditions
 * to a portable JSON file so the same scenario can be loaded into a new
 * campaign via `load-synthesis` and run against a different Warden prompt.
 *
 * Preconditions: the adventure must exist, and it must have *zero*
 * `gm_response` events. Save is for zero-turn adventures only by design —
 * it captures starting conditions, not mid-session state.
 *
 * Usage:
 *   npx tsx scripts/save-synthesis.ts <adventure-id>          -> writes to
 *       apps/zoltar-be/synthesis-saves/<slug>-<yyyymmdd-hhmmss>.json
 *   npx tsx scripts/save-synthesis.ts <adventure-id> --stdout -> prints
 *   npx tsx scripts/save-synthesis.ts <adventure-id> --output <path>
 *
 * Or via the task wrapper:
 *   task playtest:save-synthesis -- <adventure-id>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';

import {
  buildSynthesisExport,
  SaveSynthesisError,
  slugifyCampaignName,
  timestampLabel,
} from './save-synthesis.core';

import type { SynthesisExport } from '../src/synthesis/synthesis-export.schema';

interface CliArgs {
  adventureId: string;
  stdout: boolean;
  outputPath: string | null;
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
      stdout: { type: 'boolean', default: false },
      output: { type: 'string' },
    },
  });
  if (positionals.length === 0) {
    throw new UsageError(
      'missing <adventure-id>. Usage: save-synthesis <adventure-id> [--stdout | --output <path>]',
    );
  }
  if (positionals.length > 1) {
    throw new UsageError(
      `unexpected extra arguments: ${positionals.slice(1).join(', ')}`,
    );
  }
  if (values.stdout && values.output !== undefined) {
    throw new UsageError('--stdout and --output are mutually exclusive');
  }
  return {
    adventureId: positionals[0],
    stdout: Boolean(values.stdout),
    outputPath: typeof values.output === 'string' ? values.output : null,
  };
}

function defaultOutputPath(campaignName: string): string {
  return resolve(
    'synthesis-saves',
    `${slugifyCampaignName(campaignName)}-${timestampLabel()}.json`,
  );
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
    let exportPayload: SynthesisExport;
    try {
      exportPayload = await buildSynthesisExport(db, cli.adventureId);
    } catch (err) {
      if (err instanceof SaveSynthesisError) {
        process.stderr.write(`${err.message}\n`);
        return err.exitCode;
      }
      throw err;
    }

    const serialized = JSON.stringify(exportPayload, null, 2) + '\n';

    if (cli.stdout) {
      process.stdout.write(serialized);
      return 0;
    }
    const outPath =
      cli.outputPath ?? defaultOutputPath(exportPayload.source.campaignName);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, serialized, 'utf8');
    process.stdout.write(`wrote ${outPath}\n`);
    return 0;
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
