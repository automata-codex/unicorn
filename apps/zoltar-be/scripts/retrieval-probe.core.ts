import { harvestQueries } from './query-vocab.core';

import type { HarvestedQuery } from './query-vocab.core';

/**
 * Tier 2 of the query-side instrument stack: pushes the `rules_lookup`
 * queries a Warden actually emitted back through the **real** retrieval path
 * and reports what came back.
 *
 * **Where it sits between the two things that already exist.**
 * `eval:query-vocab` scores query *vocabulary* mechanically — does the query
 * use words the book prints — and needs no API call. Hand-scoring judges
 * *sufficiency* — did the retrieved text let the Warden adjudicate — and needs
 * a human evening. This answers the question in between: did the query
 * retrieve anything at all. That is a strictly better proxy than term overlap,
 * because `docs/rules-extraction-findings.md § S5.3` measured embeddings
 * bridging a vocabulary gap *partially* — swapping `perception` -> `intellect`
 * moved a target from 9th to 4th, not to a miss — so an out-of-corpus term is
 * not automatically a failed lookup. Some queries `eval:query-vocab` flags
 * will land here as fine, and reclassifying those is the point.
 *
 * **Through `RulesLookupService`, never around it.** The same constraint
 * `retrieval-eval.core.ts` states, for the same reason and with the same
 * history: a probe in this milestone called `RulesRepository` directly and
 * reported raw retrieval as though it were the runtime path. What matters is
 * what the Warden actually receives — real query preprocessing, real
 * `input_type: 'query'` embedding, real pgvector SQL, real `limit` semantics.
 * So this module never embeds, never builds SQL, and takes its retrieval as an
 * injected `ProbeLookup` that the runner wires straight to `lookup()` at the
 * shipped defaults.
 *
 * **What this deliberately does not contain.** No chunk text, anywhere. The
 * per-query table carries `source` citations (`"<label> p.21"`), which are page
 * references rather than book text, so the report can be written into this repo
 * — the reason `eval:retrieval` writes its own runs to the artifacts repo does
 * not apply.
 */

/** A completed `eval:run` to harvest, and the model that produced it. */
export interface ProbeRun {
  runDir: string;
  model: string;
}

/** One `rules_lookup` call, attributed to the model that emitted it. */
export interface HarvestedProbeQuery extends HarvestedQuery {
  model: string;
}

/**
 * Harvest every `rules_lookup` query from each run, tagging it with its model.
 *
 * `harvestQueries` is reused rather than reimplemented: the walk over
 * `reps/<rep>/<fixture>/warden-output.json`, the `telemetry: null` case, and
 * the skip-malformed-artifacts rule are all already decided there, and a
 * second copy would drift from it silently.
 */
export async function harvestProbeQueries(
  runs: ProbeRun[],
): Promise<HarvestedProbeQuery[]> {
  const harvested: HarvestedProbeQuery[] = [];
  for (const run of runs) {
    for (const item of await harvestQueries(run.runDir)) {
      harvested.push({ ...item, model: run.model });
    }
  }
  return harvested;
}

/** One returned chunk, as `RulesLookupOutput.results` carries it. */
export interface ProbeChunk {
  source: string;
  similarity: number;
}

/**
 * The retrieval path, injected.
 *
 * Injected for the same reason `query-vocab.core.ts` injects `TermLookup`:
 * everything in this file except the call itself is pure, and the Voyage
 * embedding plus the pgvector query are exercised by the service's own tests
 * rather than re-mocked here. The runner supplies the real
 * `RulesLookupService.lookup()`; the unit tests supply a table of canned
 * similarities.
 */
export type ProbeLookup = (query: string) => Promise<{
  results: ProbeChunk[];
  preprocessedQuery?: string;
}>;

/**
 * `§ S20.1`'s measured top-1 similarity distributions on the 61-chunk index:
 * answerable-with-a-correct-hit spans 0.342-0.600 (n=35) and unanswerable
 * spans 0.270-0.416 (n=12).
 *
 * These two numbers are the **edges of the overlap**, not a threshold. See
 * `bucketTopSimilarity` for why the distinction is load-bearing, and `§ S20.2`
 * for the free-looking floor that was measured and rejected.
 *
 * **They already drifted, which is the argument rather than an objection to
 * it.** `§ S20` reads them off retrieval run `mothership__2026-08-07T14-22-15Z`;
 * a re-ingest at the *same* configuration later the same day
 * (`…T15-33-39Z`) reports the unanswerable max as **0.417** and the
 * answerable median as 0.502. A tenth of a percent of movement is nothing
 * for a triage band and would be everything for a runtime floor, since it
 * puts a real unanswerable fixture on the wrong side of a constant fitted to
 * be exactly at its edge. The values below stay pinned to what `§ S20`
 * recorded; do not chase them, and do not promote them.
 */
export const UNANSWERABLE_MAX = 0.416;
export const ANSWERABLE_CORRECT_MIN = 0.342;

export type ProbeBucket = 'above' | 'overlap' | 'below' | 'none';

export const PROBE_BUCKETS: ProbeBucket[] = [
  'above',
  'overlap',
  'below',
  'none',
];

/**
 * Place a query's top-1 similarity relative to `§ S20.1`'s two distributions.
 *
 * - `above` — higher than **every** unanswerable fixture scored. Likely
 *   retrieved something real.
 * - `overlap` — inside 0.342-0.416, where the two sets are interleaved rather
 *   than merely touching (5 of 35 correct answers and 6 of 12 unanswerable
 *   queries live in there). Genuinely ambiguous; reading it either way is
 *   reading it wrong.
 * - `below` — lower than **every** correct hit scored. Likely retrieved
 *   nothing useful.
 * - `none` — the lookup returned no chunks at all. Only reachable against an
 *   empty or near-empty index, and kept distinct from `below` because "no
 *   similarity" and "a low similarity" are different states and collapsing
 *   them would make an unpopulated index look like bad retrieval.
 *
 * **This is triage, not a verdict, and it must not become a floor.** `§ S20.2`
 * measured the tempting version of exactly this — a threshold placed just
 * under the answerable minimum, discarding 0 of 35 correct answers while
 * suppressing 5 of 12 unanswerable queries — and rejected it, because a floor
 * fitted to an order statistic on n=35 has a measured cost of zero *by
 * construction* and an unmeasured cost on every query the fixture set does not
 * contain. Nothing here changes what `rules_lookup` returns; these bands only
 * sort a report so a human reads the interesting rows first.
 *
 * The boundaries are inclusive on the overlap side because the endpoints are
 * observed values, not gaps: 0.416 is the top-1 similarity of two real
 * unanswerable fixtures, so a query at 0.416 is not above every unanswerable
 * one; 0.342 is a real correct hit, so a query at 0.342 is not below every
 * correct one.
 */
export function bucketTopSimilarity(topSimilarity: number | null): ProbeBucket {
  if (topSimilarity === null) return 'none';
  if (topSimilarity > UNANSWERABLE_MAX) return 'above';
  if (topSimilarity >= ANSWERABLE_CORRECT_MIN) return 'overlap';
  return 'below';
}

/** One distinct query, and what the real retrieval path gave back for it. */
export interface ProbedQuery {
  query: string;
  /** Total `rules_lookup` calls with this exact text, across every run. */
  occurrences: number;
  /** The same count split by model, so a shared query counts for both. */
  occurrencesByModel: Array<{ model: string; occurrences: number }>;
  /** Returned chunks' citations, best match first. */
  sources: string[];
  /** Returned chunks' cosine similarities, aligned with `sources`. */
  similarities: number[];
  /** `null` when the lookup returned nothing. */
  topSimilarity: number | null;
  bucket: ProbeBucket;
  /** Present only when preprocessing changed the string that got embedded. */
  preprocessedQuery?: string;
}

export type BucketCounts = Record<ProbeBucket, number>;

export interface ProbeGroupMetrics {
  label: string;
  distinctQueries: number;
  totalLookups: number;
  /** Distinct queries per bucket. */
  buckets: BucketCounts;
  /** The same counts weighted by how often each query was actually issued. */
  weightedBuckets: BucketCounts;
}

export interface ProbeMetrics {
  overall: ProbeGroupMetrics;
  /** One row per model, in run order. A query issued by both appears in both. */
  byModel: ProbeGroupMetrics[];
  /** Top-1 similarity across every probed query, for comparison with § S20.1. */
  topSimilarity: { n: number; min: number; median: number; max: number } | null;
}

export interface ProbeQueriesResult {
  probed: ProbedQuery[];
  metrics: ProbeMetrics;
  /**
   * Distinct queries present in the harvest, before `limitQueries` truncated
   * them. Carried separately so the report can say it is partial rather than
   * presenting a smoke test as a full reading.
   */
  distinctHarvested: number;
}

export interface ProbeQueriesOptions {
  /** Probe only the first N distinct queries. Smoke-test lever. */
  limitQueries?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Push each **distinct** query through the injected retrieval path.
 *
 * Distinct, because the cost is one Voyage call per query and the same text
 * embeds to the same vector every time — probing a repeat would spend real
 * money to re-derive a value already in hand, and would let whichever query a
 * model happened to repeat dominate the bucket counts. Occurrences are kept so
 * the weighted view is still available.
 *
 * Sequential, matching `runRetrievalEval`: one Voyage call each, a corpus this
 * size buys little from concurrency, and rate-limit behaviour stays easy to
 * reason about.
 */
export async function probeQueries(
  harvested: HarvestedProbeQuery[],
  lookup: ProbeLookup,
  options: ProbeQueriesOptions = {},
): Promise<ProbeQueriesResult> {
  const byQuery = new Map<string, Map<string, number>>();
  const models: string[] = [];
  for (const item of harvested) {
    if (!models.includes(item.model)) models.push(item.model);
    const perModel = byQuery.get(item.query) ?? new Map<string, number>();
    perModel.set(item.model, (perModel.get(item.model) ?? 0) + 1);
    byQuery.set(item.query, perModel);
  }

  // Sorted so `--limit-queries` takes the same subset on every run. A smoke
  // test that probed a different 10 queries each time would prove nothing
  // about the wiring it exists to prove.
  const distinct = [...byQuery.keys()].sort();
  const selected =
    options.limitQueries === undefined
      ? distinct
      : distinct.slice(0, options.limitQueries);

  const probed: ProbedQuery[] = [];
  for (const [index, query] of selected.entries()) {
    const { results, preprocessedQuery } = await lookup(query);
    const perModel = byQuery.get(query) ?? new Map<string, number>();
    const similarities = results.map((chunk) => chunk.similarity);
    const topSimilarity = similarities.length === 0 ? null : similarities[0];

    probed.push({
      query,
      occurrences: [...perModel.values()].reduce((sum, n) => sum + n, 0),
      occurrencesByModel: models
        .filter((model) => perModel.has(model))
        .map((model) => ({ model, occurrences: perModel.get(model) ?? 0 })),
      sources: results.map((chunk) => chunk.source),
      similarities,
      topSimilarity,
      bucket: bucketTopSimilarity(topSimilarity),
      ...(preprocessedQuery === undefined ? {} : { preprocessedQuery }),
    });
    options.onProgress?.(index + 1, selected.length);
  }

  return {
    probed,
    metrics: computeProbeMetrics(probed, models),
    distinctHarvested: distinct.length,
  };
}

function emptyBuckets(): BucketCounts {
  return { above: 0, overlap: 0, below: 0, none: 0 };
}

function groupMetrics(
  label: string,
  rows: Array<{ bucket: ProbeBucket; occurrences: number }>,
): ProbeGroupMetrics {
  const buckets = emptyBuckets();
  const weightedBuckets = emptyBuckets();
  for (const row of rows) {
    buckets[row.bucket] += 1;
    weightedBuckets[row.bucket] += row.occurrences;
  }
  return {
    label,
    distinctQueries: rows.length,
    totalLookups: rows.reduce((sum, row) => sum + row.occurrences, 0),
    buckets,
    weightedBuckets,
  };
}

export function computeProbeMetrics(
  probed: ProbedQuery[],
  models?: string[],
): ProbeMetrics {
  const modelOrder =
    models ??
    probed
      .flatMap((row) => row.occurrencesByModel.map((entry) => entry.model))
      .filter((model, index, all) => all.indexOf(model) === index);

  const similarities = probed
    .map((row) => row.topSimilarity)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  return {
    overall: groupMetrics('all', probed),
    byModel: modelOrder.map((model) =>
      groupMetrics(
        model,
        probed.flatMap((row) => {
          const entry = row.occurrencesByModel.find((e) => e.model === model);
          return entry === undefined
            ? []
            : [{ bucket: row.bucket, occurrences: entry.occurrences }];
        }),
      ),
    ),
    topSimilarity:
      similarities.length === 0
        ? null
        : {
            n: similarities.length,
            min: similarities[0],
            median: median(similarities),
            max: similarities[similarities.length - 1],
          },
  };
}

/** Ascending input assumed; even-length takes the mean of the middle pair. */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function num(value: number | null, digits = 3): string {
  return value === null ? '—' : value.toFixed(digits);
}

const BUCKET_LABELS: Record<ProbeBucket, string> = {
  above: `above ${UNANSWERABLE_MAX}`,
  overlap: `${ANSWERABLE_CORRECT_MIN} – ${UNANSWERABLE_MAX} (overlap)`,
  below: `below ${ANSWERABLE_CORRECT_MIN}`,
  none: 'no results',
};

/** Sort order for the per-query table: most-suspect rows first. */
const BUCKET_RANK: Record<ProbeBucket, number> = {
  none: 0,
  below: 1,
  overlap: 2,
  above: 3,
};

export interface RenderProbeReportArgs {
  runs: ProbeRun[];
  system: string;
  chunkCount: number;
  lookupLimit: number;
  startedAt: Date;
  probed: ProbedQuery[];
  metrics: ProbeMetrics;
  distinctHarvested: number;
  /** Ingest manifest fields, when one was found on this machine. */
  provenance?: {
    chunkCount?: number;
    ingestedAt?: string;
    embedModel?: string;
    droppedPages?: number[];
  } | null;
}

export function renderRetrievalProbeReport(
  args: RenderProbeReportArgs,
): string {
  const { metrics } = args;
  const partial = args.probed.length < args.distinctHarvested;
  const lines: string[] = [];

  lines.push('# rules_lookup retrieval probe (tier 2)');
  lines.push('');

  // The header carries the caveat, not a footnote, because a bucket table is
  // exactly the kind of output that gets pasted into a findings session
  // without its surroundings.
  lines.push('> **This is not the M7.5 before-number, and must not be cited');
  lines.push('> as one.** Trap 3 in `docs/plans/013-m7.5-open-work.md`: any');
  lines.push('> query-side metric scored against the index has to be run');
  lines.push('> against the *same* index for both readings, or it measures');
  lines.push('> two things at once. The index is **not frozen** — a possible');
  lines.push('> armor fixup and a possible round 4 are still open under Task');
  lines.push('> 4. The real reading is Task 5, after the freeze.');
  lines.push('');

  if (partial) {
    lines.push(
      `> **Partial run.** \`--limit-queries\` probed ${args.probed.length} of the`,
    );
    lines.push(
      `> ${args.distinctHarvested} distinct queries harvested. The counts below`,
    );
    lines.push('> describe that subset only.');
    lines.push('');
  }

  lines.push(`- Started: ${args.startedAt.toISOString()}`);
  for (const run of args.runs) {
    lines.push(`- Run (${run.model}): ${run.runDir}`);
  }
  lines.push(`- Corpus: ${args.chunkCount} chunks for "${args.system}"`);
  lines.push(
    `- Lookup: \`RulesLookupService.lookup()\`, limit ${args.lookupLimit}, preprocessing **on** (shipped defaults)`,
  );
  if (args.provenance) {
    lines.push(
      `- Index build: ${args.provenance.chunkCount ?? '—'} chunks, ingested ${
        args.provenance.ingestedAt ?? '—'
      }, ${args.provenance.embedModel ?? '—'}, dropped pages ${
        args.provenance.droppedPages?.length
          ? args.provenance.droppedPages.join(', ')
          : 'none'
      }`,
    );
  } else {
    lines.push(
      '- Index build: **unknown** — no `ingestion/.ingest-manifest.json` found.',
    );
  }
  lines.push('');
  lines.push(
    'Each **distinct** emitted query was pushed through the real retrieval',
  );
  lines.push(
    'path — real preprocessing, real `input_type: "query"` embedding, real',
  );
  lines.push(
    'pgvector SQL — so what is reported is what the Warden would actually',
  );
  lines.push('receive, not a reimplementation of it.');

  lines.push('');
  lines.push('## How to read the buckets');
  lines.push('');
  lines.push(
    '`docs/rules-extraction-findings.md § S20.1` measured, on this index, the',
  );
  lines.push('top-1 similarity of fixture queries whose answer was genuinely');
  lines.push('present against those the book cannot answer:');
  lines.push('');
  lines.push('| Set | n | min | max |');
  lines.push('|---|---|---|---|');
  lines.push(
    `| answerable, correct hit | 35 | ${ANSWERABLE_CORRECT_MIN} | 0.600 |`,
  );
  lines.push(`| unanswerable | 12 | 0.270 | ${UNANSWERABLE_MAX} |`);
  lines.push('');
  lines.push('**The limits of this, stated here so the table below is not');
  lines.push('over-read.** The bands come from **47 labelled fixtures** — 35');
  lines.push('and 12. The overlap zone is real and the two sets are');
  lines.push('*interleaved* inside it, not merely touching: it holds 5 of the');
  lines.push('35 correct answers and 6 of the 12 unanswerable queries. And');
  lines.push('`§ S20.2` explicitly **rejected** turning these numbers into a');
  lines.push('runtime threshold, because a floor fitted to a sample minimum');
  lines.push('has zero measured cost *by construction* and an unmeasured cost');
  lines.push('on every query the fixture set does not contain.');
  lines.push('');
  lines.push('So: this is **triage to steer a human’s attention** and');
  lines.push('**not a verdict** on any individual query. A `below` row is');
  lines.push('worth reading first; it is not a failure, and an `above` row');
  lines.push('is not a pass.');
  lines.push('Anyone who reads these counts as a score has re-created the');
  lines.push('floor `§ S20` declined to ship.');

  lines.push('');
  lines.push('## Buckets');
  lines.push('');
  lines.push(
    '| Group | distinct | lookups | ' +
      PROBE_BUCKETS.map((bucket) => BUCKET_LABELS[bucket]).join(' | ') +
      ' |',
  );
  lines.push(`|---|---|---|${PROBE_BUCKETS.map(() => '---').join('|')}|`);
  for (const group of [metrics.overall, ...metrics.byModel]) {
    lines.push(
      `| ${group.label} | ${group.distinctQueries} | ${group.totalLookups} | ` +
        `${PROBE_BUCKETS.map((bucket) => group.buckets[bucket]).join(' | ')} |`,
    );
  }
  lines.push('');
  lines.push(
    'A query emitted by both models is counted under both — the model rows',
  );
  lines.push('are views on the same probed set, not a partition of it.');

  lines.push('');
  lines.push('## Top-1 similarity across the probed queries');
  lines.push('');
  if (metrics.topSimilarity === null) {
    lines.push('No query returned a chunk.');
  } else {
    lines.push('| n | min | median | max |');
    lines.push('|---|---|---|---|');
    lines.push(
      `| ${metrics.topSimilarity.n} | ${num(metrics.topSimilarity.min)} | ${num(
        metrics.topSimilarity.median,
      )} | ${num(metrics.topSimilarity.max)} |`,
    );
    lines.push('');
    lines.push(
      'Comparable with `§ S20.1`’s two rows above only in shape. These are',
    );
    lines.push(
      'emitted queries with no answerability label, so the distribution mixes',
    );
    lines.push(
      'both populations and has no correct-hit column by construction.',
    );
  }

  lines.push('');
  lines.push('## Per query');
  lines.push('');
  lines.push('| n | bucket | top sim | sources | query |');
  lines.push('|---|---|---|---|---|');
  for (const row of [...args.probed].sort(
    (a, b) =>
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      (a.topSimilarity ?? -1) - (b.topSimilarity ?? -1) ||
      a.query.localeCompare(b.query),
  )) {
    const sources = row.sources
      .map((source, index) => `${source} (${num(row.similarities[index])})`)
      .join('; ');
    lines.push(
      `| ${row.occurrences} | ${BUCKET_LABELS[row.bucket]} | ${num(
        row.topSimilarity,
      )} | ${escapePipes(sources) || '—'} | ${escapePipes(row.query)} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}
