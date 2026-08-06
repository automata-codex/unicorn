#!/usr/bin/env tsx
/**
 * One-off retrieval probe — NOT part of the regular toolkit, deliberately has
 * no `Taskfile.yml` entry, and is **deleted in Part 7** of
 * `docs/plans/012-m7.2-rules-ingestion-implementation-plan.md`.
 *
 * It exists so Part 5's review gate has a retrieval check before the real
 * retrieval harness (`task eval:retrieval`) is built two parts later. One
 * query in, ranked hits out — no fixtures, no scoring, no thresholds. Once
 * the harness lands, this and it would answer the same question at very
 * different quality, so this one goes.
 *
 * Goes through `RulesLookupService` — the same object the Warden's tool
 * handler calls — rather than reimplementing the query against the
 * repository. Query preprocessing lives in that service, so a probe that
 * called the repository directly would report raw retrieval as though it
 * were the runtime path. That is the same class of ingestion/runtime
 * divergence `docs/decisions.md § Embedding model` already got bitten by
 * once, and it is what this probe exists to catch rather than reproduce.
 *
 * Costs one Voyage call. No Anthropic call, no writes.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/one-off/rules-lookup-probe.ts \
 *     "what happens when a character panics" [--limit 5] [--system mothership]
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

import { envOnlyConfigService } from '../../eval/runs/env-config-service';
import { RulesLookupService } from '../../src/rules/rules-lookup.service';
import { RulesRepository } from '../../src/rules/rules.repository';
import { VoyageService } from '../../src/voyage/voyage.service';

import type { Db } from '../../src/db/db.provider';

interface CliArgs {
  query: string;
  limit: number;
  system: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let limit = 3;
  let system = 'mothership';

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--limit') {
      limit = Number(argv[(i += 1)]);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit must be a positive integer, got "${argv[i]}"`);
      }
    } else if (argv[i] === '--system') {
      system = argv[(i += 1)];
    } else {
      positional.push(argv[i]);
    }
  }

  if (positional.length !== 1) {
    throw new Error(
      'usage: rules-lookup-probe.ts "<query>" [--limit <n>] [--system <slug>]',
    );
  }
  return { query: positional[0], limit, system };
}

async function main(): Promise<number> {
  let cli: CliArgs;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool) as unknown as Db;

  try {
    const systems = await db.execute<{ id: string; embedding_dim: number }>(
      sql`SELECT id, embedding_dim FROM game_system WHERE slug = ${cli.system}`,
    );
    const system = systems.rows[0];
    if (!system) {
      process.stderr.write(`no game_system with slug "${cli.system}"\n`);
      return 2;
    }

    const counts = await db.execute<{ total: string }>(
      sql`SELECT count(*) AS total FROM rules_chunk WHERE system_id = ${system.id}`,
    );
    const total = Number(counts.rows[0]?.total ?? 0);
    process.stdout.write(
      `index: ${total} chunks for "${cli.system}" (embedding_dim ${system.embedding_dim})\n`,
    );
    if (total === 0) {
      process.stderr.write(
        'the index is empty for this system — run ingest.py first.\n',
      );
      return 1;
    }

    // Through `RulesLookupService`, not around it. Calling the repository
    // directly would skip query preprocessing and report raw retrieval as
    // though it were the runtime path — the exact ingestion/runtime
    // divergence this probe exists to catch.
    const service = new RulesLookupService(
      new RulesRepository(db),
      new VoyageService(envOnlyConfigService()),
    );

    const startedAt = Date.now();
    const { output, preprocessedQuery } = await service.lookup(system.id, {
      query: cli.query,
      limit: cli.limit,
    });
    const matches = output.results;
    const elapsedMs = Date.now() - startedAt;

    process.stdout.write(
      `\nquery: ${JSON.stringify(cli.query)}\n` +
        (preprocessedQuery === undefined
          ? 'preprocessing: no change\n'
          : `embedded as: ${JSON.stringify(preprocessedQuery)}\n`) +
        `model: ${process.env.VOYAGE_EMBED_MODEL}   ${elapsedMs}ms   ${matches.length} hits\n\n`,
    );
    matches.forEach((match, index) => {
      const excerpt = match.text.replace(/\s+/g, ' ').slice(0, 220);
      process.stdout.write(
        `${index + 1}. similarity ${match.similarity.toFixed(4)}  ${match.source}\n   ${excerpt}…\n\n`,
      );
    });
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
