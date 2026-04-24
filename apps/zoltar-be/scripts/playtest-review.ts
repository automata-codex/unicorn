#!/usr/bin/env tsx
/**
 * M7.1 playtest-review CLI — renders a markdown report for an adventure.
 *
 * Usage:
 *   npx tsx scripts/playtest-review.ts <adventure-id>           -> writes to
 *       apps/zoltar-be/playtest-reports/<id>-<yyyymmdd-hhmmss>.md
 *   npx tsx scripts/playtest-review.ts <adventure-id> --stdout  -> prints
 *   npx tsx scripts/playtest-review.ts <adventure-id> --output <path>
 *
 * Or via the task wrapper:
 *   task playtest:review -- <adventure-id>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';

import {
  queryCorrections,
  queryHeader,
  queryTurns,
} from './playtest-review.queries';
import { renderReport } from './playtest-review.render';

interface CliArgs {
  adventureId: string;
  stdout: boolean;
  outputPath: string | null;
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
      'missing <adventure-id>. Usage: playtest-review <adventure-id> [--stdout | --output <path>]',
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

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function defaultOutputPath(adventureId: string): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return resolve('playtest-reports', `${adventureId}-${stamp}.md`);
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
    const header = await queryHeader(db, cli.adventureId);
    if (!header) {
      process.stderr.write(
        `No adventure found with id ${cli.adventureId}.\n`,
      );
      return 1;
    }
    if (header.turnCount === 0) {
      process.stderr.write(
        `Adventure ${cli.adventureId} has no turns yet — nothing to review.\n`,
      );
      return 1;
    }

    const [turns, corrections] = await Promise.all([
      queryTurns(db, cli.adventureId),
      queryCorrections(db, cli.adventureId),
    ]);

    const markdown = renderReport({ header, turns, corrections });

    if (cli.stdout) {
      process.stdout.write(markdown);
      return 0;
    }
    const outPath = cli.outputPath ?? defaultOutputPath(cli.adventureId);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown, 'utf8');
    process.stdout.write(`wrote ${outPath}\n`);
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
