#!/usr/bin/env tsx
/**
 * `eval:retrieval-probe` — tier 2 of the query-side instrument stack.
 *
 * Harvests every `rules_lookup` query a completed `eval:run` emitted and
 * pushes each **distinct** one back through the real retrieval path, then
 * reports what came back and at what similarity, bucketed against
 * `docs/rules-extraction-findings.md § S20.1`'s measured distributions.
 *
 * `eval:query-vocab` asks whether the query used words the book prints;
 * this asks whether it retrieved anything. `§ S5.3` measured embeddings
 * bridging a vocabulary gap partially, so those are genuinely different
 * questions and this reclassifies some of what that flags.
 *
 * Costs **one Voyage call per distinct query and no Anthropic call**, so it
 * is affordable but not free: ~360 queries across the two M7.5 before-runs.
 * Use `--limit-queries` when you only need to prove the wiring.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/retrieval-probe.ts <run-dir> [<run-dir>…] \
 *     [--system mothership] [--limit 3] [--limit-queries 10] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:retrieval-probe -- <run-dir> [--limit-queries 10]
 *
 * Each `<run-dir>` is relative to `$ZOLTAR_EVAL_ROOT/eval-runs/` unless
 * absolute; the model comes from its `manifest.json`. Pass both the 4.6 and
 * the Sonnet 5 run to get the per-model split in one report and pay for a
 * shared query only once.
 *
 * Needs `DATABASE_URL`, `VOYAGE_API_KEY`, `VOYAGE_EMBED_MODEL`, and
 * `ZOLTAR_EVAL_ROOT`. Plain `tsx` — no Nest DI container.
 *
 * **Read Trap 3 before quoting a number out of this.** A query-side metric
 * scored against the index must be run against the *same* index for both
 * readings. The M7.5 before-number is Task 5, after the index freezes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { envOnlyConfigService } from '../eval/runs/env-config-service';
import { resolveEvalRoot } from '../eval/runs/paths';
import { RulesRepository } from '../src/rules/rules.repository';
import { RulesLookupService } from '../src/rules/rules-lookup.service';
import { VoyageService } from '../src/voyage/voyage.service';

import { readIndexProvenance } from './retrieval-eval.core';
import {
  harvestProbeQueries,
  probeQueries,
  renderRetrievalProbeReport,
} from './retrieval-probe.core';

import type { Db } from '../src/db/db.provider';
import type { ProbeRun } from './retrieval-probe.core';

const DEFAULT_SYSTEM = 'mothership';

/**
 * The model that produced a run, from its own manifest.
 *
 * The directory name encodes it too (`<model>__<promptHash>__<timestamp>`),
 * but parsing a directory name is a guess about a convention while
 * `manifest.json` is the run stating what it was. Falling back to the
 * basename would let a renamed directory silently mislabel a whole column.
 */
async function readRunModel(runDir: string): Promise<string> {
  const raw = await readFile(join(runDir, 'manifest.json'), 'utf8');
  const model = (JSON.parse(raw) as { model?: unknown }).model;
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error(`no "model" in ${join(runDir, 'manifest.json')}`);
  }
  return model;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      system: { type: 'string' },
      limit: { type: 'string' },
      'limit-queries': { type: 'string' },
      output: { type: 'string' },
    },
  });

  if (positionals.length === 0) {
    process.stderr.write(
      'usage: retrieval-probe.ts <run-dir> [<run-dir>…] [--system mothership] ' +
        '[--limit 3] [--limit-queries 10] [--output <path>]\n',
    );
    return 2;
  }

  const system = values.system ?? DEFAULT_SYSTEM;

  // `rules_lookup`'s own range. The telemetry shows the Warden asking for 3
  // on all but three of 486 calls across the two before-runs, and top-1 is
  // limit-invariant anyway — the flag exists so the returned-chunk column can
  // be widened when someone is reading rows, not to change the buckets.
  const limit = values.limit === undefined ? 3 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    process.stderr.write(
      `--limit must be an integer 1-5 (rules_lookup's own range), got "${values.limit}"\n`,
    );
    return 2;
  }

  const limitQueries =
    values['limit-queries'] === undefined
      ? undefined
      : Number(values['limit-queries']);
  if (
    limitQueries !== undefined &&
    (!Number.isInteger(limitQueries) || limitQueries < 1)
  ) {
    process.stderr.write('--limit-queries must be a positive integer\n');
    return 2;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  const runs: ProbeRun[] = [];
  try {
    for (const arg of positionals) {
      const runDir = isAbsolute(arg)
        ? arg
        : join(resolveEvalRoot(), 'eval-runs', arg);
      runs.push({ runDir, model: await readRunModel(runDir) });
    }
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
    const chunkCount = Number(counts.rows[0]?.total ?? 0);
    if (chunkCount === 0) {
      // Every query would land in the `none` bucket and the report would read
      // as total retrieval failure, produced entirely by the corpus being
      // absent. Refuse rather than spend a Voyage call per query to say so.
      process.stderr.write(
        `the rules index is empty for "${system}", so every query would return ` +
          'nothing. Ingest first (task ingest -- --system ' +
          system +
          ' --pdf <path>).\n',
      );
      return 1;
    }
    process.stderr.write(`index: ${chunkCount} chunks for "${system}"\n`);

    const harvested = await harvestProbeQueries(runs);
    if (harvested.length === 0) {
      process.stderr.write(
        'no rules_lookup queries found. Either those runs made none, or their ' +
          'artifacts predate telemetry.payload.rulesLookups.\n',
      );
      return 1;
    }
    process.stderr.write(`harvested ${harvested.length} lookups\n`);

    // The whole point of the probe: the shipped service, at the shipped
    // defaults, so preprocessing is on and there is deliberately no flag to
    // turn it off. `eval:retrieval` owns the with/without comparison; here,
    // anything other than production configuration answers a question nobody
    // asked and quietly stops describing what the Warden receives.
    const lookup = new RulesLookupService(
      new RulesRepository(db),
      new VoyageService(envOnlyConfigService()),
    );

    const { probed, metrics, distinctHarvested } = await probeQueries(
      harvested,
      async (query) => {
        const { output, preprocessedQuery } = await lookup.lookup(systemId, {
          query,
          limit,
        });
        return {
          results: output.results.map((result) => ({
            source: result.source,
            similarity: result.similarity,
          })),
          ...(preprocessedQuery === undefined ? {} : { preprocessedQuery }),
        };
      },
      {
        ...(limitQueries === undefined ? {} : { limitQueries }),
        onProgress: (done, total) => {
          if (done === total || done % 10 === 0) {
            process.stderr.write(`  probed ${done}/${total}\n`);
          }
        },
      },
    );

    const report = renderRetrievalProbeReport({
      runs,
      system,
      chunkCount,
      lookupLimit: limit,
      startedAt,
      probed,
      metrics,
      distinctHarvested,
      provenance: await readIndexProvenance(),
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
  (err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
