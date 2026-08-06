#!/usr/bin/env tsx
/**
 * `eval:retrieval` — scores the rules index against page-labeled fixtures.
 *
 * Deterministic: recall@3, recall@5, MRR, and the answerable-vs-unanswerable
 * top-1 similarity distributions. **No judge, no Anthropic call anywhere in
 * the scoring loop** — that is what makes it cheap enough to run on every
 * chunking change during M7.5's iteration, and the sharpest difference from
 * the M7.4 Warden harness. It costs one Voyage call per fixture.
 *
 * This is the ruler M7.2 hands to M7.5. It does not set a quality bar and it
 * does not derive the similarity floor; it produces the numbers those
 * decisions consume.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/retrieval-eval.ts \
 *     [--system mothership] [--fixtures <path>] [--limit 3] \
 *     [--no-preprocess] [--df-threshold 0.6] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:retrieval -- [--no-preprocess]
 *
 * `--no-preprocess` exists specifically so this harness can measure query
 * preprocessing's own effect: run the fixture set with and without, and diff
 * the recall numbers. `--df-threshold` sweeps the document-frequency ceiling
 * without editing a constant or restarting anything.
 *
 * Needs `DATABASE_URL`, `VOYAGE_API_KEY`, `VOYAGE_EMBED_MODEL`, and
 * `ZOLTAR_EVAL_ROOT`. Plain `tsx` — no Nest DI container.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { FixtureLoadError } from '../eval/retrieval/loader';
import { envOnlyConfigService } from '../eval/runs/env-config-service';
import { filenameSafeTimestamp, resolveEvalRoot } from '../eval/runs/paths';
import { RulesRepository } from '../src/rules/rules.repository';
import { RulesLookupService } from '../src/rules/rules-lookup.service';
import { VoyageService } from '../src/voyage/voyage.service';

import {
  RetrievalEvalError,
  readIndexProvenance,
  runRetrievalEval,
} from './retrieval-eval.core';

import type { Db } from '../src/db/db.provider';

const DEFAULT_SYSTEM = 'mothership';

function fixturePathFor(system: string): string {
  return join(__dirname, '..', 'eval', 'retrieval-fixtures', `${system}.jsonl`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      system: { type: 'string' },
      fixtures: { type: 'string' },
      limit: { type: 'string' },
      'no-preprocess': { type: 'boolean' },
      'df-threshold': { type: 'string' },
      output: { type: 'string' },
    },
  });

  const system = values.system ?? DEFAULT_SYSTEM;
  const fixturePath = values.fixtures ?? fixturePathFor(system);
  const limit = values.limit === undefined ? 3 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    process.stderr.write(
      `--limit must be an integer 1-5 (rules_lookup's own range), got "${values.limit}"\n`,
    );
    return 2;
  }
  const dfThreshold =
    values['df-threshold'] === undefined
      ? undefined
      : Number(values['df-threshold']);
  if (dfThreshold !== undefined && !(dfThreshold >= 0 && dfThreshold <= 1)) {
    process.stderr.write('--df-threshold must be between 0 and 1\n');
    return 2;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  let evalRoot: string;
  try {
    evalRoot = resolveEvalRoot();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const startedAt = new Date();
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
    const chunks = Number(counts.rows[0]?.total ?? 0);
    if (chunks === 0) {
      // Scoring an empty index produces a report full of zeros that looks
      // exactly like a catastrophically bad index. Refuse instead.
      process.stderr.write(
        `the rules index is empty for "${system}". Run the ingestion pipeline first ` +
          '(task ingest -- --system ' +
          system +
          ' --pdf <path>).\n',
      );
      return 1;
    }
    process.stderr.write(`index: ${chunks} chunks for "${system}"\n`);

    const lookup = new RulesLookupService(
      new RulesRepository(db),
      new VoyageService(envOnlyConfigService()),
    );

    const result = await runRetrievalEval({
      lookup,
      systemId,
      system,
      fixturePath,
      limit,
      preprocess: values['no-preprocess'] !== true,
      ...(dfThreshold === undefined ? {} : { dfThreshold }),
      startedAt,
      provenance: await readIndexProvenance(),
      onProgress: (done, total) => {
        if (done === total || done % 10 === 0) {
          process.stderr.write(`  scored ${done}/${total}\n`);
        }
      },
    });

    // Run artifacts go to the artifacts repo, not this one: a useful failure
    // report wants the returned chunks' pages and text to show what came back
    // instead of the right answer, and chunk text is rules text that must not
    // land here. Fixtures stay in-repo because they contain none.
    const runDir = join(
      evalRoot,
      'retrieval-runs',
      `${system}__${filenameSafeTimestamp(startedAt)}`,
    );
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, 'manifest.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          config: result.config,
          indexProvenance: await readIndexProvenance(),
          embedModel: process.env.VOYAGE_EMBED_MODEL ?? null,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(
      join(runDir, 'results.jsonl'),
      `${result.rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      'utf8',
    );
    await writeFile(join(runDir, 'report.md'), result.report, 'utf8');

    if (values.output) {
      await mkdir(dirname(values.output), { recursive: true });
      await writeFile(values.output, result.report, 'utf8');
    }

    process.stdout.write(`${result.report}\n`);
    process.stderr.write(`\nrun written to ${runDir}\n`);
    return 0;
  } catch (err) {
    if (err instanceof FixtureLoadError || err instanceof RetrievalEvalError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
