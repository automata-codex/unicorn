import type { QueryStyle, RetrievalFixture } from './fixture.schema';

/**
 * Deterministic scoring — no judge, no Anthropic call, anywhere in this file.
 * That is what makes the harness cheap enough to run on every chunking change
 * during M7.5's iteration, and it is the sharpest difference from the M7.4
 * Warden harness.
 */

/**
 * Pulls printed page numbers out of a chunk's `source` citation.
 *
 * This parses a **contract**, not a guess: `ingestion/pipeline/chunk.py`
 * builds `source` as `"<label> p.21"` or `"<label> pp.20-21"`, ASCII, hyphen
 * rather than en-dash, printed rather than physical page numbers. `source`
 * and `content` are the only columns `findByCosineSimilarity` returns, so
 * this string is the sole channel through which a chunk's provenance reaches
 * a scorer.
 *
 * Returns every page in an inclusive range, so a chunk citing `pp.20-21`
 * matches a fixture labeled with either page.
 */
export function parseCitedPages(source: string): number[] {
  const match = /\bpp?\.\s*(\d+)(?:\s*-\s*(\d+))?/.exec(source);
  if (!match) return [];

  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  if (last < first) return [first];

  const pages: number[] = [];
  for (let page = first; page <= last; page += 1) pages.push(page);
  return pages;
}

export interface RetrievalHit {
  source: string;
  similarity: number;
}

export interface ScoredFixture {
  id: string;
  queryStyle: QueryStyle;
  sourceTag?: string;
  answerable: boolean;
  expectedPages: number[];
  /** Pages cited by each returned chunk, in rank order. */
  returnedPages: number[][];
  /** 1-based rank of the first chunk citing an expected page; null if none did. */
  hitRank: number | null;
  topSimilarity: number | null;
}

export function scoreFixture(
  fixture: RetrievalFixture,
  hits: RetrievalHit[],
): ScoredFixture {
  const returnedPages = hits.map((hit) => parseCitedPages(hit.source));
  const expected = new Set(fixture.expectedPages);

  let hitRank: number | null = null;
  if (fixture.answerable) {
    const index = returnedPages.findIndex((pages) =>
      pages.some((page) => expected.has(page)),
    );
    hitRank = index === -1 ? null : index + 1;
  }

  return {
    id: fixture.id,
    queryStyle: fixture.queryStyle,
    ...(fixture.sourceTag === undefined
      ? {}
      : { sourceTag: fixture.sourceTag }),
    answerable: fixture.answerable,
    expectedPages: fixture.expectedPages,
    returnedPages,
    hitRank,
    topSimilarity: hits[0]?.similarity ?? null,
  };
}

export interface SimilarityDistribution {
  n: number;
  min: number | null;
  median: number | null;
  max: number | null;
}

export interface RetrievalMetrics {
  /** Answerable fixtures — the recall/MRR denominator. */
  answerable: number;
  /** Unanswerable fixtures — excluded from recall/MRR entirely. */
  unanswerable: number;
  /** `answerable / (answerable + unanswerable)`, null when there are no fixtures. */
  applicability: number | null;
  recallAt3: number | null;
  recallAt5: number | null;
  mrr: number | null;
  /** Top-1 similarity over answerable fixtures whose expected page came back. */
  answerableCorrectSimilarity: SimilarityDistribution;
  /** Top-1 similarity over unanswerable fixtures. The floor lives in the gap between these two. */
  unanswerableSimilarity: SimilarityDistribution;
}

function distribution(values: number[]): SimilarityDistribution {
  if (values.length === 0) return { n: 0, min: null, median: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    min: sorted[0],
    median:
      sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2,
    max: sorted[sorted.length - 1],
  };
}

function recallAt(scored: ScoredFixture[], k: number): number | null {
  if (scored.length === 0) return null;
  const hits = scored.filter(
    (row) => row.hitRank !== null && row.hitRank <= k,
  ).length;
  return hits / scored.length;
}

/**
 * Rates over a group of scored fixtures.
 *
 * **Every rate is reported with its denominator, and unanswerable fixtures
 * are excluded from it** — the same applicability discipline
 * `docs/decisions.md § Applicability is reported alongside every rate`
 * established for the Warden harness, not a new convention. A rate computed
 * over a denominator that silently shrank is the failure mode that discipline
 * exists to prevent.
 *
 * `null` rather than `0` when a group has no answerable fixtures: an
 * undefined rate is a real state and must not render as a bad score.
 */
export function computeMetrics(scored: ScoredFixture[]): RetrievalMetrics {
  const answerable = scored.filter((row) => row.answerable);
  const unanswerable = scored.filter((row) => !row.answerable);

  const reciprocalRanks = answerable.map((row) =>
    row.hitRank === null ? 0 : 1 / row.hitRank,
  );

  return {
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    applicability:
      scored.length === 0 ? null : answerable.length / scored.length,
    recallAt3: recallAt(answerable, 3),
    recallAt5: recallAt(answerable, 5),
    mrr:
      reciprocalRanks.length === 0
        ? null
        : reciprocalRanks.reduce((sum, value) => sum + value, 0) /
          reciprocalRanks.length,
    answerableCorrectSimilarity: distribution(
      answerable
        .filter((row) => row.hitRank !== null && row.topSimilarity !== null)
        .map((row) => row.topSimilarity as number),
    ),
    unanswerableSimilarity: distribution(
      unanswerable
        .filter((row) => row.topSimilarity !== null)
        .map((row) => row.topSimilarity as number),
    ),
  };
}

export function groupBy<K extends string>(
  scored: ScoredFixture[],
  key: (row: ScoredFixture) => K | undefined,
): Map<K, ScoredFixture[]> {
  const groups = new Map<K, ScoredFixture[]>();
  for (const row of scored) {
    const value = key(row);
    if (value === undefined) continue;
    const bucket = groups.get(value);
    if (bucket) bucket.push(row);
    else groups.set(value, [row]);
  }
  return groups;
}
