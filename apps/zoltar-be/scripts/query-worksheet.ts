#!/usr/bin/env tsx
/**
 * `eval:query-worksheet` — generate a hand-scoring worksheet for the
 * `rules_lookup` queries a Warden emitted, grouped by the turn that produced
 * them.
 *
 * M7.5 open-work Task 2. `task eval:query-vocab` measures query *vocabulary*
 * mechanically and the tier-2 probe measures what a query *retrieved*; this
 * produces the input for the judgment neither can reach — was the lookup
 * warranted, and does it express what the Warden actually needed. Those
 * require the situation, which `eval:query-vocab`'s flat query list does not
 * carry.
 *
 * Run it once per model per prompt revision. The before/after pairing is only
 * valid if both worksheets came out of this script rather than one of them
 * being assembled by hand.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/query-worksheet.ts <run-dir> \
 *     [--system mothership] [--fixtures-dir <dir>] [--output <path>] [--force]
 *
 * **Refuses to overwrite an existing `--output`.** Unlike every other report
 * in `scripts/`, this file is meant to be filled in by hand, so clobbering it
 * destroys labels that cannot be regenerated. `--force` overrides.
 *
 * Or via the task wrapper:
 *   task eval:query-worksheet -- <run-dir> --output <path>
 *
 * `<run-dir>` is relative to `$ZOLTAR_EVAL_ROOT/eval-runs/` unless absolute.
 * Needs `DATABASE_URL` and a populated index (to resolve corpus-absent
 * terms). No Anthropic calls, no Voyage calls. Plain `tsx` — no Nest DI.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { loadFixtures } from '../eval/fixture-loader';
import { resolveEvalRoot } from '../eval/runs/paths';
import { RulesRepository } from '../src/rules/rules.repository';

import { harvestQueries, scoreQueries } from './query-vocab.core';
import {
  buildWorksheet,
  overwriteRefusal,
  renderWorksheet,
} from './query-worksheet.core';

import type { Db } from '../src/db/db.provider';

const DEFAULT_SYSTEM = 'mothership';
const DEFAULT_FIXTURES_DIR = join(__dirname, '..', 'eval', 'fixtures');

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      system: { type: 'string' },
      'fixtures-dir': { type: 'string' },
      output: { type: 'string' },
      force: { type: 'boolean' },
    },
  });

  const runDirArg = positionals[0];
  if (!runDirArg) {
    process.stderr.write(
      'usage: query-worksheet.ts <run-dir> [--system mothership] ' +
        '[--fixtures-dir <dir>] [--output <path>] [--force]\n',
    );
    return 2;
  }

  const system = values.system ?? DEFAULT_SYSTEM;
  const fixturesDir = values['fixtures-dir'] ?? DEFAULT_FIXTURES_DIR;

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

  // Model and prompt hash come from the run's own manifest rather than from
  // parsing the directory name. The name happens to encode both today, and a
  // worksheet mislabelled with the wrong prompt hash would pair a before-set
  // against itself without anything looking wrong.
  let model = 'unknown';
  let promptHash = 'unknown';
  try {
    const manifest = JSON.parse(
      await readFile(join(runDir, 'manifest.json'), 'utf8'),
    ) as { model?: string; promptHash?: string };
    model = manifest.model ?? model;
    promptHash = manifest.promptHash ?? promptHash;
  } catch {
    process.stderr.write(
      `warning: no readable manifest.json in ${runDir}; model and prompt hash ` +
        'will read "unknown" in the worksheet header\n',
    );
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
    if (Number(counts.rows[0]?.total ?? 0) === 0) {
      // Against an empty index every term resolves as absent, so the hint
      // column would read as though the Warden's whole vocabulary were
      // off-book. Refuse rather than emit a misleading worksheet.
      process.stderr.write(
        `the rules index is empty for "${system}", so every term would score as ` +
          'absent and the absent-terms hint would be meaningless.\n',
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

    const repo = new RulesRepository(db);
    const { scored } = await scoreQueries(harvested, (query) =>
      repo.queryTermFrequencies({ systemId, query }),
    );

    const { fixtures, errors } = await loadFixtures(fixturesDir);
    for (const error of errors) {
      // Never silently dropped: a fixture that failed to load becomes a turn
      // with no situation, which the worksheet renders as such. Saying so
      // here is what distinguishes "the corpus moved on" from "this file is
      // broken right now."
      process.stderr.write(`fixture load error: ${error.message}\n`);
    }

    const turns = buildWorksheet({ harvested, scored, fixtures });
    const report = renderWorksheet({
      turns,
      model,
      promptHash,
      runDir,
      generatedAt: new Date().toISOString(),
    });

    process.stderr.write(
      `${harvested.length} lookups → ${turns.reduce((n, t) => n + t.rows.length, 0)} rows ` +
        `across ${turns.length} turns\n`,
    );

    if (values.output) {
      const exists = await stat(values.output).then(
        () => true,
        () => false,
      );
      const refusal = overwriteRefusal({
        path: values.output,
        exists,
        force: values.force ?? false,
      });
      if (refusal) {
        process.stderr.write(refusal);
        return 2;
      }
      await mkdir(dirname(values.output), { recursive: true });
      await writeFile(values.output, report, 'utf8');
      process.stderr.write(`worksheet written to ${values.output}\n`);
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
