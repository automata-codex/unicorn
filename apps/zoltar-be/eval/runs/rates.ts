import type { ApplicabilitySource, CheckMode, ScoredRow } from './scores';

/**
 * `EvalCheck.applicabilitySource` as it survives aggregation over a group of
 * rows, plus the two values a group can take that no single check declares.
 *
 * - `'unknown'`: at least one row in the group predates the field. Nothing
 *   is known to conflict, but nothing can be vouched for either, so the
 *   applicability number carries no reading.
 * - `'mixed'`: two rows declare *different* sources — a checker was migrated
 *   between them (`decisions.md`: a row keeps describing the rules it was
 *   scored under, so this is a real event rather than a data error).
 *
 * The distinction is deliberate: "can't vouch" and "definitely differs" have
 * the same consequence for a reader today, but only one of them is worth
 * chasing, and collapsing them would hide which is which.
 */
export type ResolvedApplicabilitySource =
  | ApplicabilitySource
  | 'mixed'
  | 'unknown';

export interface RateEntry {
  fixtureId: string;
  checkId: string;
  tag: string;
  checkMode: CheckMode;
  /** Resolved across the group's rows — never looked up from the check id.
   * See `ResolvedApplicabilitySource`. */
  applicabilitySource: ResolvedApplicabilitySource;
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
  /**
   * `n + notApplicable` — **errors deliberately excluded.** A rep that
   * errored never got far enough to determine whether the check applied, so
   * counting it here would report a lower applicability than the check
   * earned and would fold two different unknowns ("didn't apply" and "never
   * found out") into one ratio.
   */
  applicabilityDenominator: number;
  /** `n / applicabilityDenominator`. `null` when that denominator is `0` —
   * every rep errored, and there is no applicability to report. */
  applicability: number | null;
}

interface SourceAccumulator {
  declared: Set<ApplicabilitySource>;
  sawUndeclared: boolean;
}

function resolveSource(acc: SourceAccumulator): ResolvedApplicabilitySource {
  if (acc.declared.size > 1) return 'mixed';
  if (acc.sawUndeclared || acc.declared.size === 0) return 'unknown';
  return [...acc.declared][0];
}

/** Per `(fixtureId, checkId)`, sorted by `fixtureId` then `checkId` so two
 * reports diff cleanly. */
export function computeRates(rows: ScoredRow[]): RateEntry[] {
  const groups = new Map<string, RateEntry>();
  const sources = new Map<string, SourceAccumulator>();

  for (const row of rows) {
    const key = `${row.fixtureId}::${row.checkId}`;
    let entry = groups.get(key);
    if (!entry) {
      entry = {
        fixtureId: row.fixtureId,
        checkId: row.checkId,
        tag: row.tag,
        checkMode: row.checkMode,
        applicabilitySource: 'unknown',
        pass: 0,
        fail: 0,
        notApplicable: 0,
        error: 0,
        n: 0,
        rate: null,
        applicabilityDenominator: 0,
        applicability: null,
      };
      groups.set(key, entry);
      sources.set(key, { declared: new Set(), sawUndeclared: false });
    }
    const acc = sources.get(key)!;
    if (row.applicabilitySource) acc.declared.add(row.applicabilitySource);
    else acc.sawUndeclared = true;

    if (row.verdict === 'pass') entry.pass += 1;
    else if (row.verdict === 'fail') entry.fail += 1;
    else if (row.verdict === 'not_applicable') entry.notApplicable += 1;
    else entry.error += 1;
  }

  const entries = [...groups.values()];
  for (const entry of entries) {
    entry.n = entry.pass + entry.fail;
    entry.rate = entry.n === 0 ? null : entry.pass / entry.n;
    entry.applicabilityDenominator = entry.n + entry.notApplicable;
    entry.applicability =
      entry.applicabilityDenominator === 0
        ? null
        : entry.n / entry.applicabilityDenominator;
    entry.applicabilitySource = resolveSource(
      sources.get(`${entry.fixtureId}::${entry.checkId}`)!,
    );
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
  notApplicable: number;
  error: number;
  n: number;
  rate: number | null;
  /** Same "errors excluded" rule as `RateEntry.applicabilityDenominator`,
   * summed across the tag's entries. */
  applicabilityDenominator: number;
  applicability: number | null;
  /**
   * The distinct `applicabilitySource` values of the entries rolled up here,
   * sorted. An array rather than a scalar because a tag may cover more than
   * one check: tag and checkId are 1:1 in today's corpus, but
   * `selectChecksForFixture` deliberately doesn't assume that stays true,
   * and a rollup mixing a fixture-gated and an artifact-gated check has an
   * applicability number with two opposite readings at once.
   */
  applicabilitySources: ResolvedApplicabilitySource[];
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
    const notApplicable = entries.reduce((sum, e) => sum + e.notApplicable, 0);
    const error = entries.reduce((sum, e) => sum + e.error, 0);
    const n = pass + fail;
    const applicabilityDenominator = n + notApplicable;
    rollups.push({
      tag,
      pass,
      fail,
      notApplicable,
      error,
      n,
      rate: n === 0 ? null : pass / n,
      applicabilityDenominator,
      applicability:
        applicabilityDenominator === 0 ? null : n / applicabilityDenominator,
      applicabilitySources: [
        ...new Set(entries.map((e) => e.applicabilitySource)),
      ].sort(),
      fixturesWithNoDenominator: entries.filter((e) => e.n === 0).length,
    });
  }

  return rollups.sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * How an applicability number should be read, given where the check's
 * `not_applicable` verdicts come from. The same ratio means opposite things
 * across sources, so a reader handed the number alone will mistake a harness
 * bug for a model finding (or the reverse) — see
 * `EvalCheck.applicabilitySource`.
 *
 * - `'ok'` — nothing to say.
 * - `'fixture-gated-split'` — **defect.** A fixture-gated check's
 *   applicability is decided by the scenario before the model runs, so every
 *   rep must agree: the honest values are exactly `0.00` and `1.00`. Anything
 *   strictly between means reps disagreed about a question the fixture had
 *   already answered — the checker is misclassifying, or the fixture was
 *   mis-authored. (Errors being out of the denominator is what makes this
 *   rule sound: an errored rep can't break unanimity.)
 * - `'fixture-gated-never-applies'` — note. Correct and self-consistent, but
 *   the pair contributes no regression coverage at all.
 * - `'ungated-gate-fired'` — **defect.** The registry declares this check
 *   never reports `not_applicable`, and it did — a `runCheck` fixture-schema
 *   gate or a thrown checker fired where the registry says no gate exists.
 * - `'artifact-gated-selection'` — note, not a defect. A real behavioural
 *   measure of the model, carrying the outcome-selection hazard: read it
 *   alongside the exclusion counts, never alone.
 * - `'indeterminate-source'` — note. Render the number, don't interpret it.
 */
export type ApplicabilityReading =
  | 'ok'
  | 'fixture-gated-split'
  | 'fixture-gated-never-applies'
  | 'ungated-gate-fired'
  | 'artifact-gated-selection'
  | 'indeterminate-source';

interface ApplicabilityFacts {
  applicability: number | null;
  applicabilitySource: ResolvedApplicabilitySource;
}

export function classifyApplicability(
  entry: ApplicabilityFacts,
): ApplicabilityReading {
  const { applicability: app, applicabilitySource: source } = entry;
  // Every rep errored: there is no applicability, and the Errors section is
  // already the right place for that. Nothing to read here.
  if (app === null) return 'ok';

  switch (source) {
    case 'fixture':
      if (app === 0) return 'fixture-gated-never-applies';
      return app === 1 ? 'ok' : 'fixture-gated-split';
    case 'ungated':
      return app === 1 ? 'ok' : 'ungated-gate-fired';
    case 'artifact':
      return app === 1 ? 'ok' : 'artifact-gated-selection';
    default:
      return app === 1 ? 'ok' : 'indeterminate-source';
  }
}

export interface ApplicabilityFinding {
  fixtureId: string;
  checkId: string;
  reading: ApplicabilityReading;
  /** `'defect'` findings are about the harness; `'note'` findings are about
   * how to read a number that is itself correct. */
  severity: 'defect' | 'note';
  message: string;
}

function formatFraction(entry: RateEntry): string {
  return `${entry.applicability!.toFixed(2)} (${entry.n}/${entry.applicabilityDenominator})`;
}

/**
 * Every entry whose applicability needs saying out loud, in `computeRates`'s
 * order. Defects first within each entry is not a concern — one entry
 * produces at most one finding.
 */
export function findApplicabilityIssues(
  rates: RateEntry[],
): ApplicabilityFinding[] {
  const findings: ApplicabilityFinding[] = [];

  for (const entry of rates) {
    const reading = classifyApplicability(entry);
    if (reading === 'ok') continue;

    const where = `fixture "${entry.fixtureId}" check "${entry.checkId}"`;
    const app = formatFraction(entry);
    let severity: ApplicabilityFinding['severity'] = 'note';
    let message: string;

    switch (reading) {
      case 'fixture-gated-split':
        severity = 'defect';
        message =
          `${where} is fixture-gated but its applicability is ${app} — the ` +
          'scenario decides before the model runs, so every rep should agree ' +
          '(0.00 or 1.00). Reps disagreeing means the checker is ' +
          'misclassifying or the fixture was mis-authored, not that ' +
          'behaviour moved.';
        break;
      case 'fixture-gated-never-applies':
        message =
          `${where} is fixture-gated and never applies (${app}) — correct, ` +
          'but this pair contributes no regression coverage.';
        break;
      case 'ungated-gate-fired':
        severity = 'defect';
        message =
          `${where} is declared ungated but reported not_applicable ` +
          `(applicability ${app}) — a gate fired where the registry says ` +
          'none exists.';
        break;
      case 'artifact-gated-selection':
        message =
          `${where} is artifact-gated with applicability ${app} — a real ` +
          'behavioural measure, but the denominator moves with the behaviour ' +
          'being measured. Read it with the exclusion counts, not alone.';
        break;
      default:
        message =
          `${where} has ${entry.applicabilitySource} applicability source ` +
          `and applicability ${app} — the number can be rendered but not read.`;
    }

    findings.push({
      fixtureId: entry.fixtureId,
      checkId: entry.checkId,
      reading,
      severity,
      message,
    });
  }

  return findings;
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
      else
        byReasonOnly.set(code, {
          fixtureId: '',
          checkId: '',
          reason,
          count: 1,
        });
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
