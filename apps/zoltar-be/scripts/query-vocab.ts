#!/usr/bin/env tsx
/**
 * `eval:query-vocab` — scores the `rules_lookup` queries a Warden emitted
 * against the vocabulary the rules corpus contains.
 *
 * The instrument for M7.5 Part 4.6. `task eval:retrieval` scores frozen
 * fixture queries and so measures the index; this reads the queries out of a
 * completed `eval:run`'s own artifacts and measures the Warden. A prompt
 * change aimed at query phrasing moves this number and cannot move that one.
 *
 * Costs nothing but local Postgres. **No Anthropic call, no Voyage call** —
 * the queries are already on disk in `warden-output.json`
 * (`telemetry.payload.rulesLookups`), so the before-number for a prompt
 * change is available from runs that completed months ago.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/query-vocab.ts <run-dir> \
 *     [--system mothership] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:query-vocab -- <run-dir>
 *
 * `<run-dir>` is relative to `$ZOLTAR_EVAL_ROOT/eval-runs/` unless absolute.
 * Needs `DATABASE_URL` and a populated index. Plain `tsx` — no Nest DI.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { resolveEvalRoot } from '../eval/runs/paths';
import { RulesRepository } from '../src/rules/rules.repository';

import {
  harvestQueries,
  renderQueryVocabReport,
  scoreQueries,
} from './query-vocab.core';

import type { Db } from '../src/db/db.provider';

const DEFAULT_SYSTEM = 'mothership';

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      system: { type: 'string' },
      output: { type: 'string' },
    },
  });

  const runDirArg = positionals[0];
  if (!runDirArg) {
    process.stderr.write(
      'usage: query-vocab.ts <run-dir> [--system mothership] [--output <path>]\n',
    );
    return 2;
  }

  const system = values.system ?? DEFAULT_SYSTEM;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  let runDir: string;
  if (isAbsolute(runDirArg)) {
    runDir = runDirArg;
  } else {
    try {
      runDir = join(resolveEvalRoot(), 'eval-runs', runDirArg);
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      return 2;
    }
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool) as unknown as Db;

  try {
    const systems = await db.execute<{ id: string }>(
      sql`SELECT id FROM game_system WHERE slug = ${system}`,
    );
    const systemId = systems.rows[0]?.id;
    if (!systemId) {
      process.stderr.write(`no game_system with slug "${system}"\n`);
      return 2;
    }

    const counts = await db.execute<{ total: string }>(
      sql`SELECT count(*) AS total FROM rules_chunk WHERE system_id = ${systemId}`,
    );
    const chunkCount = Number(counts.rows[0]?.total ?? 0);
    if (chunkCount === 0) {
      // Against an empty index every term is absent and the rate reads
      // 100% — a catastrophic-looking result produced entirely by the
      // corpus being missing. Refuse rather than report it.
      process.stderr.write(
        `the rules index is empty for "${system}", so every term would score as ` +
          'absent. Ingest first (task ingest -- --system ' +
          system +
          ' --pdf <path>).\n',
      );
      return 1;
    }

    const harvested = await harvestQueries(runDir);
    if (harvested.length === 0) {
      process.stderr.write(
        `no rules_lookup queries found in ${runDir}. Either the run made none, or its ` +
          'artifacts predate telemetry.payload.rulesLookups.\n',
      );
      return 1;
    }
    process.stderr.write(
      `harvested ${harvested.length} lookups from ${runDir}\n`,
    );

    const repo = new RulesRepository(db);
    const { scored, metrics } = await scoreQueries(harvested, (query) =>
      repo.queryTermFrequencies({ systemId, query }),
    );

    const report = renderQueryVocabReport({
      runDir,
      system,
      chunkCount,
      scored,
      metrics,
    });

    if (values.output) {
      await mkdir(dirname(values.output), { recursive: true });
      await writeFile(values.output, report, 'utf8');
      process.stderr.write(`\nreport written to ${values.output}\n`);
    } else {
      process.stdout.write(report);
    }
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
