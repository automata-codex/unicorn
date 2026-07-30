import type { CheckMode, ScoredRow } from './scores';

export interface RateEntry {
  fixtureId: string;
  checkId: string;
  tag: string;
  checkMode: CheckMode;
  pass: number;
  fail: number;
  notApplicable: number;
  error: number;
  /** `pass + fail` — `not_applicable` and `error` are excluded from the
   * denominator entirely (spec Part 3's verdict semantics). */
  n: number;
  /** `pass / n`. `null` when `n === 0` — an undefined rate is a real state
   * and must not render as `0.00`. */
  rate: number | null;
}

/** Per `(fixtureId, checkId)`, sorted by `fixtureId` then `checkId` so two
 * reports diff cleanly. */
export function computeRates(rows: ScoredRow[]): RateEntry[] {
  const groups = new Map<string, RateEntry>();

  for (const row of rows) {
    const key = `${row.fixtureId}::${row.checkId}`;
    let entry = groups.get(key);
    if (!entry) {
      entry = {
        fixtureId: row.fixtureId,
        checkId: row.checkId,
        tag: row.tag,
        checkMode: row.checkMode,
        pass: 0,
        fail: 0,
        notApplicable: 0,
        error: 0,
        n: 0,
        rate: null,
      };
      groups.set(key, entry);
    }
    if (row.verdict === 'pass') entry.pass += 1;
    else if (row.verdict === 'fail') entry.fail += 1;
    else if (row.verdict === 'not_applicable') entry.notApplicable += 1;
    else entry.error += 1;
  }

  const entries = [...groups.values()];
  for (const entry of entries) {
    entry.n = entry.pass + entry.fail;
    entry.rate = entry.n === 0 ? null : entry.pass / entry.n;
  }

  return entries.sort(
    (a, b) =>
      a.fixtureId.localeCompare(b.fixtureId) ||
      a.checkId.localeCompare(b.checkId),
  );
}

export interface TagRollup {
  tag: string;
  pass: number;
  fail: number;
  n: number;
  rate: number | null;
  /** Count of `(fixtureId, checkId)` entries in this tag whose `n === 0` —
   * fixtures providing zero regression coverage for this tag right now. */
  fixturesWithNoDenominator: number;
}

/** Per-tag aggregate over `computeRates`'s output, sorted by tag. */
export function rollupByTag(rates: RateEntry[]): TagRollup[] {
  const byTag = new Map<string, RateEntry[]>();
  for (const entry of rates) {
    const list = byTag.get(entry.tag);
    if (list) list.push(entry);
    else byTag.set(entry.tag, [entry]);
  }

  const rollups: TagRollup[] = [];
  for (const [tag, entries] of byTag) {
    const pass = entries.reduce((sum, e) => sum + e.pass, 0);
    const fail = entries.reduce((sum, e) => sum + e.fail, 0);
    const n = pass + fail;
    rollups.push({
      tag,
      pass,
      fail,
      n,
      rate: n === 0 ? null : pass / n,
      fixturesWithNoDenominator: entries.filter((e) => e.n === 0).length,
    });
  }

  return rollups.sort((a, b) => a.tag.localeCompare(b.tag));
}

function byCountThenText<T>(
  entries: [string, number][],
  build: (text: string, count: number) => T,
): T[] {
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([text, count]) => build(text, count));
}

export interface ExclusionsSummary {
  /** Rep directories on disk with no vouching record at all — the
   * independent cross-check `listRepDirsOnDisk` exists for. */
  unvouchedReps: number[];
  /** `readVouchedRows`'s own exclusion strings, passed through verbatim —
   * covers both unvouched reps and individually dropped rows, so nothing
   * it already named is silently re-derived or dropped here. */
  rawExclusions: string[];
  /** Global aggregate across every fixture and check — what first made the
   * roll-suppression pattern visible. Grouped by `notApplicableReasonCode`
   * (falling back to `notApplicableReason` when a reason has no per-rep-
   * variable content, which is the common case), so a reason that's
   * identical for every rep of every fixture rolls up here exactly as
   * before. Kept alongside `notApplicableByFixture`, not replaced by it —
   * the two are independent cross-checks on the same underlying rows. */
  notApplicableByReason: Array<{ reason: string; count: number }>;
  /** Same grouping, broken out per `(fixtureId, checkId)` — the trace-level
   * view the aggregate alone can't provide. */
  notApplicableByFixture: Array<{
    fixtureId: string;
    checkId: string;
    reason: string;
    count: number;
  }>;
  errorsByMessage: Array<{ message: string; count: number }>;
}

interface NotApplicableGroup {
  fixtureId: string;
  checkId: string;
  /** First-seen full reason text for this group — the representative
   * example shown alongside the count, since `code` itself may omit
   * per-rep-variable detail that was in the original text. */
  reason: string;
  count: number;
}

/**
 * Everything excluded from (or absent from) the rate denominator, named —
 * never silently dropped. `rows` is the already-vouched set
 * `readVouchedRows` returns; `exclusions` and `repDirsOnDisk` are that same
 * call's other two outputs (the latter via `listRepDirsOnDisk`).
 */
export function summarizeExclusions(
  rows: ScoredRow[],
  exclusions: string[],
  repDirsOnDisk: number[],
): ExclusionsSummary {
  const vouchedIndices = new Set(rows.map((row) => row.repIndex));
  const unvouchedReps = repDirsOnDisk
    .filter((index) => !vouchedIndices.has(index))
    .sort((a, b) => a - b);

  const byFixture = new Map<string, NotApplicableGroup>();
  const byReasonOnly = new Map<string, NotApplicableGroup>();
  const errorCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.verdict === 'not_applicable') {
      const reason = row.notApplicableReason ?? '(no reason given)';
      const code = row.notApplicableReasonCode ?? reason;

      const fixtureKey = `${row.fixtureId}::${row.checkId}::${code}`;
      const fixtureGroup = byFixture.get(fixtureKey);
      if (fixtureGroup) fixtureGroup.count += 1;
      else {
        byFixture.set(fixtureKey, {
          fixtureId: row.fixtureId,
          checkId: row.checkId,
          reason,
          count: 1,
        });
      }

      const reasonGroup = byReasonOnly.get(code);
      if (reasonGroup) reasonGroup.count += 1;
      else byReasonOnly.set(code, { fixtureId: '', checkId: '', reason, count: 1 });
    } else if (row.verdict === 'error') {
      const message = row.errorMessage ?? '(no message given)';
      errorCounts.set(message, (errorCounts.get(message) ?? 0) + 1);
    }
  }

  return {
    unvouchedReps,
    rawExclusions: exclusions,
    notApplicableByReason: byCountThenText(
      [...byReasonOnly.values()].map((g) => [g.reason, g.count]),
      (reason, count) => ({ reason, count }),
    ),
    notApplicableByFixture: [...byFixture.values()].sort(
      (a, b) =>
        a.fixtureId.localeCompare(b.fixtureId) ||
        a.checkId.localeCompare(b.checkId) ||
        b.count - a.count ||
        a.reason.localeCompare(b.reason),
    ),
    errorsByMessage: byCountThenText(
      [...errorCounts.entries()],
      (message, count) => ({ message, count }),
    ),
  };
}
