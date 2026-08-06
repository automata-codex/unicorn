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
 * Goes through the same `VoyageService` + `RulesRepository` path the Warden
 * uses, rather than reimplementing the query: a divergence between what
 * ingestion wrote and what the runtime reads is exactly the failure
 * `docs/decisions.md § Embedding model` already got bitten by once, and a
 * bespoke query here would hide it.
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

    const voyage = new VoyageService(envOnlyConfigService());
    const repo = new RulesRepository(db);

    const startedAt = Date.now();
    const embedding = await voyage.embed(cli.query, 'query');
    const matches = await repo.findByCosineSimilarity({
      systemId: system.id,
      embedding,
      limit: cli.limit,
    });
    const elapsedMs = Date.now() - startedAt;

    process.stdout.write(
      `\nquery: ${JSON.stringify(cli.query)}\nmodel: ${process.env.VOYAGE_EMBED_MODEL}   ${elapsedMs}ms   ${matches.length} hits\n\n`,
    );
    matches.forEach((match, index) => {
      const excerpt = match.content.replace(/\s+/g, ' ').slice(0, 220);
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
