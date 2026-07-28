import type { RateEntry } from './rates';
import type { ScoreRow } from './scores';

export type CompareStatus =
  | 'paired'
  | 'a-only'
  | 'b-only'
  | 'not-applicable-one-side';

export interface ComparePair {
  fixtureId: string;
  checkId: string;
  tag: string;
  rateA: number | null;
  rateB: number | null;
  /** `rateB - rateA`. Only set when `status === 'paired'` — never computed
   * against a partial or missing denominator. */
  delta: number | null;
  nA: number;
  nB: number;
  status: CompareStatus;
}

function key(fixtureId: string, checkId: string): string {
  return `${fixtureId}::${checkId}`;
}

/**
 * Pairs on `(fixtureId, checkId)` — never compares aggregate rates alone.
 * Each fixture is its own control; aggregate-only comparison mixes prompt
 * effect with fixture-difficulty variance.
 *
 * `not-applicable-one-side` covers both "one side has no usable denominator"
 * and the rarer "neither side does" — either way a delta can't honestly be
 * computed, and the caller's job is the same: report the pair as-is, never
 * against a partial denominator.
 */
export function comparePairs(
  ratesA: RateEntry[],
  ratesB: RateEntry[],
): ComparePair[] {
  const byKeyA = new Map(ratesA.map((r) => [key(r.fixtureId, r.checkId), r]));
  const byKeyB = new Map(ratesB.map((r) => [key(r.fixtureId, r.checkId), r]));
  const allKeys = new Set([...byKeyA.keys(), ...byKeyB.keys()]);

  const pairs: ComparePair[] = [];
  for (const k of allKeys) {
    const a = byKeyA.get(k);
    const b = byKeyB.get(k);

    if (a && !b) {
      pairs.push({
        fixtureId: a.fixtureId,
        checkId: a.checkId,
        tag: a.tag,
        rateA: a.rate,
        rateB: null,
        delta: null,
        nA: a.n,
        nB: 0,
        status: 'a-only',
      });
      continue;
    }
    if (b && !a) {
      pairs.push({
        fixtureId: b.fixtureId,
        checkId: b.checkId,
        tag: b.tag,
        rateA: null,
        rateB: b.rate,
        delta: null,
        nA: 0,
        nB: b.n,
        status: 'b-only',
      });
      continue;
    }

    const entryA = a!;
    const entryB = b!;
    if (entryA.rate === null || entryB.rate === null) {
      pairs.push({
        fixtureId: entryA.fixtureId,
        checkId: entryA.checkId,
        tag: entryA.tag,
        rateA: entryA.rate,
        rateB: entryB.rate,
        delta: null,
        nA: entryA.n,
        nB: entryB.n,
        status: 'not-applicable-one-side',
      });
      continue;
    }

    pairs.push({
      fixtureId: entryA.fixtureId,
      checkId: entryA.checkId,
      tag: entryA.tag,
      rateA: entryA.rate,
      rateB: entryB.rate,
      delta: entryB.rate - entryA.rate,
      nA: entryA.n,
      nB: entryB.n,
      status: 'paired',
    });
  }

  return pairs;
}

function byFixtureThenCheck(a: ComparePair, b: ComparePair): number {
  return (
    a.fixtureId.localeCompare(b.fixtureId) || a.checkId.localeCompare(b.checkId)
  );
}

/**
 * The regression/improvement/unchanged/unpaired classification, shared
 * between `orderForDisplay` (which sections the flat output) and
 * `compare-report.ts` (which sections the rendered tables) — one
 * definition, so the two can't silently classify a pair differently.
 */
export const isRegression = (p: ComparePair): boolean =>
  p.status === 'paired' && p.delta! < 0;
export const isImprovement = (p: ComparePair): boolean =>
  p.status === 'paired' && p.delta! > 0;
export const isUnchanged = (p: ComparePair): boolean =>
  p.status === 'paired' && p.delta === 0;
export const isUnpaired = (p: ComparePair): boolean => p.status !== 'paired';

/**
 * Regressions first — sorted by delta ascending, worst first. A change
 * that lifts the median while tanking two fixtures is usually a bad trade;
 * putting the damage at the top of the output is what makes that visible
 * instead of buried under the aggregate. Then improvements (delta
 * descending, biggest first), then unchanged, then everything unpaired or
 * lacking a denominator on either side.
 */
export function orderForDisplay(pairs: ComparePair[]): ComparePair[] {
  const regressions = pairs
    .filter(isRegression)
    .sort((a, b) => a.delta! - b.delta!);
  const improvements = pairs
    .filter(isImprovement)
    .sort((a, b) => b.delta! - a.delta!);
  const unchanged = pairs.filter(isUnchanged).sort(byFixtureThenCheck);
  const unpaired = pairs.filter(isUnpaired).sort(byFixtureThenCheck);

  return [...regressions, ...improvements, ...unchanged, ...unpaired];
}

export interface HeterogeneityInfo {
  rubricHashes: string[];
  harnessVersions: string[];
  /** One entry per heterogeneous dimension, each naming the exact
   * `--filter-rubric`/`--filter-harness` invocation that would reduce this
   * side to a consistent subset. Empty when the side is already
   * consistent — never discards the directory on its own. */
  warnings: string[];
}

/**
 * Distinct `rubricHash`/`harnessVersion` values present in one side's rows.
 * `label` names the side in the warning text (e.g. the run directory) so a
 * two-sided caller's combined output says which side is heterogeneous.
 */
export function detectHeterogeneity(
  rows: ScoreRow[],
  label: string,
): HeterogeneityInfo {
  const rubricHashes = [
    ...new Set(
      rows
        .map((r) => r.rubricHash)
        .filter((h): h is string => h !== undefined),
    ),
  ].sort();
  const harnessVersions = [...new Set(rows.map((r) => r.harnessVersion))].sort();

  const warnings: string[] = [];
  if (rubricHashes.length > 1) {
    warnings.push(
      `${label} spans multiple rubric hashes (${rubricHashes.join(', ')}) — ` +
        `filter to one with --filter-rubric ${rubricHashes[0]}`,
    );
  }
  if (harnessVersions.length > 1) {
    warnings.push(
      `${label} spans multiple harness versions (${harnessVersions.join(', ')}) — ` +
        `filter to one with --filter-harness ${harnessVersions[0]}`,
    );
  }

  return { rubricHashes, harnessVersions, warnings };
}

export interface ApplyFiltersOptions {
  rubricHash?: string;
  harnessVersion?: string;
}

/**
 * A row lacking `rubricHash` entirely (every structural row) is never
 * excluded by `--filter-rubric` — that filter narrows *judged* rows to one
 * rubric, it isn't a claim that every row must carry a matching hash.
 * `--filter-harness` has no such asymmetry: every row always carries one.
 */
export function applyFilters(
  rows: ScoreRow[],
  filters: ApplyFiltersOptions,
): ScoreRow[] {
  return rows.filter((row) => {
    if (
      filters.rubricHash !== undefined &&
      row.rubricHash !== undefined &&
      row.rubricHash !== filters.rubricHash
    ) {
      return false;
    }
    if (
      filters.harnessVersion !== undefined &&
      row.harnessVersion !== filters.harnessVersion
    ) {
      return false;
    }
    return true;
  });
}
