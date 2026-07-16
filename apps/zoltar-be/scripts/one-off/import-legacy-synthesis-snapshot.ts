#!/usr/bin/env tsx
/**
 * One-off migration script — NOT part of the regular playtest toolkit and
 * deliberately has no `Taskfile.yml` entry. Run exactly once per legacy
 * adventure whose synthesis predates automatic `adventure_synthesis_snapshots`
 * capture (M7.3 Part 2, `SynthesisRepository.writeGmContextAtomic`).
 *
 * Reads a JSON file produced by the now-removed `save-synthesis` CLI (M7.1),
 * validates it against the same `SynthesisExport` schema `load-synthesis`
 * already validates against, confirms it matches the target adventure id
 * (the file is old — verify against the DB rather than trusting the file's
 * own `source.adventureId` unchecked), confirms the adventure exists and
 * has no snapshot row yet, then inserts exactly one row.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/one-off/import-legacy-synthesis-snapshot.ts \
 *     <path-to-legacy-synthesis.json> <adventure-id>
 */

import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../../src/db/schema';

import {
  ImportLegacySnapshotError,
  importLegacySynthesisSnapshot,
} from './import-legacy-synthesis-snapshot.core';

interface CliArgs {
  filePath: string;
  adventureId: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  if (argv.length < 2) {
    throw new ImportLegacySnapshotError(
      'missing arguments. Usage: import-legacy-synthesis-snapshot.ts <path-to-legacy-synthesis.json> <adventure-id>',
      2,
    );
  }
  if (argv.length > 2) {
    throw new ImportLegacySnapshotError(
      `unexpected extra arguments: ${argv.slice(2).join(', ')}`,
      2,
    );
  }
  return { filePath: argv[0], adventureId: argv[1] };
}

async function main(): Promise<number> {
  let cli: CliArgs;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof ImportLegacySnapshotError) {
      process.stderr.write(`${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  let rawJson: string;
  try {
    rawJson = readFileSync(cli.filePath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`failed to read ${cli.filePath}: ${msg}\n`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${cli.filePath} is not valid JSON: ${msg}\n`);
    return 2;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  try {
    const result = await importLegacySynthesisSnapshot(
      db,
      parsed,
      cli.adventureId,
    );
    process.stdout.write(
      `imported synthesis snapshot for adventure ${result.adventureId} from ${cli.filePath}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof ImportLegacySnapshotError) {
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
