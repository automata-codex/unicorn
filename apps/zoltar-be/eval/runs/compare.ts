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

/** One judged check whose reps were graded against more than one rubric
 * hash — a rubric template edited mid-run, not the ordinary case of a run
 * covering several checks. */
export interface MixedRubricCheck {
  checkId: string;
  tag: string;
  hashes: string[];
}

export interface HeterogeneityInfo {
  mixedRubricChecks: MixedRubricCheck[];
  harnessVersions: string[];
  /** One entry per heterogeneous dimension, each naming the exact
   * `--filter-rubric`/`--filter-harness` invocation that would reduce this
   * side to a consistent subset. Empty when the side is already
   * consistent — never discards the directory on its own. */
  warnings: string[];
}

/**
 * Detects mid-run rubric drift and harness-version spread in one side's
 * rows. `label` names the side in the warning text (e.g. the run directory)
 * so a two-sided caller's combined output says which side is affected.
 *
 * Rubric hashes are grouped **per `checkId`**, not across the whole run.
 * The harness ships one rubric template per judged check
 * (`rubricHashFor(checkId)`, `eval/checks/registry.ts`), so a run covering
 * several judged checks spans several hashes by design — that is the
 * normal case and must not warn. Only a single check spanning more than
 * one hash across its reps indicates the rubric was actually edited
 * mid-run. (The M7.4 spec describes this as "one rubric per tag"; tag and
 * checkId are 1:1 in the current corpus, so grouping by checkId agrees
 * with that language today, but checkId is what `rubricHashFor` and the
 * manifest's `rubricHashes` map are actually keyed on.)
 */
export function detectHeterogeneity(
  rows: ScoreRow[],
  label: string,
): HeterogeneityInfo {
  const hashesByCheck = new Map<string, { tag: string; hashes: Set<string> }>();
  for (const row of rows) {
    if (row.rubricHash === undefined) continue;
    let entry = hashesByCheck.get(row.checkId);
    if (!entry) {
      entry = { tag: row.tag, hashes: new Set() };
      hashesByCheck.set(row.checkId, entry);
    }
    entry.hashes.add(row.rubricHash);
  }

  const mixedRubricChecks: MixedRubricCheck[] = [...hashesByCheck.entries()]
    .filter(([, entry]) => entry.hashes.size > 1)
    .map(([checkId, entry]) => ({
      checkId,
      tag: entry.tag,
      hashes: [...entry.hashes].sort(),
    }))
    .sort((a, b) => a.checkId.localeCompare(b.checkId));

  const harnessVersions = [
    ...new Set(rows.map((r) => r.harnessVersion)),
  ].sort();

  const warnings: string[] = [];
  for (const mixed of mixedRubricChecks) {
    warnings.push(
      `${label}: check \`${mixed.checkId}\` (tag ${mixed.tag}) was graded ` +
        `against ${mixed.hashes.length} different rubric versions ` +
        `(${mixed.hashes.join(', ')}) — that check's rates are not ` +
        `comparable. Every other check in this run is unaffected. Filter ` +
        `to one with --filter-rubric ${mixed.checkId}=${mixed.hashes[0]}`,
    );
  }
  if (harnessVersions.length > 1) {
    warnings.push(
      `${label} spans multiple harness versions (${harnessVersions.join(', ')}) — ` +
        `filter to one with --filter-harness ${harnessVersions[0]}`,
    );
  }

  return { mixedRubricChecks, harnessVersions, warnings };
}

export interface ApplyFiltersOptions {
  /** checkId -> the one rubricHash to keep for that check. Rows for checks
   * absent from this map are untouched, so a filter targeting one drifting
   * check can never zero out an unrelated check's rows. */
  rubricHashByCheckId?: Record<string, string>;
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
    const wantedHash = filters.rubricHashByCheckId?.[row.checkId];
    if (
      wantedHash !== undefined &&
      row.rubricHash !== undefined &&
      row.rubricHash !== wantedHash
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

/**
 * Parses repeated `--filter-rubric CHECK=HASH` values into the map
 * `applyFilters` expects. Rejects the legacy bare-hash form (missing `=`)
 * and a check id named more than once, both loudly — a filter that fails
 * silently to parse is exactly the kind of "quietly wrong" this flag has
 * already caused once.
 */
export function parseRubricFilters(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    const eq = value.indexOf('=');
    const checkId = eq === -1 ? '' : value.slice(0, eq).trim();
    const hash = eq === -1 ? '' : value.slice(eq + 1).trim();
    if (!checkId || !hash) {
      throw new Error(
        `--filter-rubric takes CHECK=HASH (e.g. hidden-info-leak=4cf7fda1), got "${value}"`,
      );
    }
    if (checkId in result) {
      throw new Error(
        `--filter-rubric was given more than once for check "${checkId}"`,
      );
    }
    result[checkId] = hash;
  }
  return result;
}

/**
 * Names, in plain text, every `(fixtureId, checkId)` whose denominator a
 * filter reduced to zero, plus every filter key that matched no rows at
 * all — so a filter that would silently zero a fixture's rate is instead
 * reported on stderr rather than rendered as an unremarkable `a-only` /
 * `not-applicable-one-side` row.
 */
export function describeFilterImpact(
  before: ScoreRow[],
  after: ScoreRow[],
  rubricFilters: Record<string, string>,
): string[] {
  const messages: string[] = [];

  const nBefore = new Map<string, number>();
  for (const row of before) {
    if (row.verdict !== 'pass' && row.verdict !== 'fail') continue;
    const key = `${row.fixtureId}::${row.checkId}`;
    nBefore.set(key, (nBefore.get(key) ?? 0) + 1);
  }
  const nAfter = new Map<string, number>();
  for (const row of after) {
    if (row.verdict !== 'pass' && row.verdict !== 'fail') continue;
    const key = `${row.fixtureId}::${row.checkId}`;
    nAfter.set(key, (nAfter.get(key) ?? 0) + 1);
  }
  for (const [key, n] of nBefore) {
    if (n > 0 && (nAfter.get(key) ?? 0) === 0) {
      const [fixtureId, checkId] = key.split('::');
      messages.push(
        `--filter-rubric zeroed the denominator for fixture "${fixtureId}" ` +
          `check "${checkId}" (was N ${n}, now N 0)`,
      );
    }
  }

  const checksSeen = new Set(before.map((r) => r.checkId));
  for (const checkId of Object.keys(rubricFilters)) {
    if (!checksSeen.has(checkId)) {
      messages.push(
        `--filter-rubric named check "${checkId}", which has no rows in this run`,
      );
    }
  }

  return messages;
}
