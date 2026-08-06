import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadFixtures } from '../eval/retrieval/loader';
import {
  type IndexProvenance,
  type RunConfig,
  renderRetrievalReport,
} from '../eval/retrieval/report';
import { type ScoredFixture, scoreFixture } from '../eval/retrieval/score';

import type { RulesLookupService } from '../src/rules/rules-lookup.service';

export class RetrievalEvalError extends Error {}

/** Written by `ingest.py` on a successful run; gitignored, per-machine. */
export const INGEST_MANIFEST_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'ingestion',
  '.ingest-manifest.json',
);

export async function readIndexProvenance(
  path: string = INGEST_MANIFEST_PATH,
): Promise<IndexProvenance | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as IndexProvenance;
  } catch {
    // Absent is a legitimate state — someone else's machine, or an index
    // seeded before the manifest existed. The report says so explicitly
    // rather than rendering scores as though they were comparable.
    return null;
  }
}

export interface RunRetrievalEvalArgs {
  lookup: RulesLookupService;
  systemId: string;
  system: string;
  fixturePath: string;
  limit: number;
  preprocess: boolean;
  dfThreshold?: number;
  startedAt: Date;
  provenance: IndexProvenance | null;
  onProgress?: (done: number, total: number) => void;
}

export interface RetrievalEvalResult {
  config: RunConfig;
  scored: ScoredFixture[];
  rows: Array<ScoredFixture & { query: string; preprocessedQuery?: string }>;
  report: string;
}

/**
 * Run every fixture through `RulesLookupService` and score the results.
 *
 * **Through the service, not around it.** What matters is what the Warden
 * actually receives: the real `input_type: 'query'` embedding, the real
 * query preprocessing, the real pgvector SQL, the real `limit` semantics. A
 * reimplementation of the query path here would let a divergence between
 * ingestion and runtime hide — the precise failure `docs/decisions.md §
 * Embedding model` already got bitten by once, and one this milestone hit
 * again when a probe that called the repository directly reported raw
 * retrieval as though it were the runtime path.
 *
 * Fixtures run sequentially. Each is one Voyage call; the corpus is small
 * enough that concurrency would buy little and would make rate-limit
 * behaviour harder to reason about.
 */
export async function runRetrievalEval(
  args: RunRetrievalEvalArgs,
): Promise<RetrievalEvalResult> {
  const fixtures = await loadFixtures(args.fixturePath, {
    system: args.system,
  });
  if (fixtures.length === 0) {
    throw new RetrievalEvalError(
      `no fixtures for system "${args.system}" in ${args.fixturePath}`,
    );
  }

  const scored: ScoredFixture[] = [];
  const rows: RetrievalEvalResult['rows'] = [];

  for (const [index, fixture] of fixtures.entries()) {
    const { output, preprocessedQuery } = await args.lookup.lookup(
      args.systemId,
      { query: fixture.query, limit: args.limit },
      {
        skipPreprocess: !args.preprocess,
        ...(args.dfThreshold === undefined
          ? {}
          : { dfThreshold: args.dfThreshold }),
      },
    );

    const row = scoreFixture(fixture, output.results);
    scored.push(row);
    rows.push({
      ...row,
      query: fixture.query,
      ...(preprocessedQuery === undefined ? {} : { preprocessedQuery }),
    });
    args.onProgress?.(index + 1, fixtures.length);
  }

  const config: RunConfig = {
    system: args.system,
    fixturePath: args.fixturePath,
    fixtureCount: fixtures.length,
    limit: args.limit,
    preprocess: args.preprocess,
    ...(args.dfThreshold === undefined
      ? {}
      : { dfThreshold: args.dfThreshold }),
    startedAt: args.startedAt.toISOString(),
  };

  return {
    config,
    scored,
    rows,
    report: renderRetrievalReport({
      config,
      provenance: args.provenance,
      scored,
    }),
  };
}
