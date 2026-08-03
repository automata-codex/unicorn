import { shortCorpusVersion } from '../corpus-version';

import { findApplicabilityIssues, rollupByTag } from './rates';

import type { Manifest } from './manifest';
import type {
  ExclusionsSummary,
  RateEntry,
  ResolvedApplicabilitySource,
  TagRollup,
} from './rates';

/** Shared with `compare-report.ts` — an undefined rate must never render as
 * `0.00`. */
export function formatRate(rate: number | null): string {
  return rate === null ? 'n/a' : rate.toFixed(2);
}

/**
 * `0.75 (3/4)` — the ratio *and* the fraction it came from. The fraction is
 * the point: a rate that moved because its denominator moved is
 * indistinguishable from one that moved because behaviour did, and the
 * denominator is the only thing that tells them apart
 * (`docs/eval-methodology.md`, "Denominators are not automatically
 * model-neutral").
 */
export function formatApplicability(entry: {
  applicability: number | null;
  n: number;
  applicabilityDenominator: number;
}): string {
  if (entry.applicability === null) return 'n/a';
  return `${entry.applicability.toFixed(2)} (${entry.n}/${entry.applicabilityDenominator})`;
}

/** `'unknown'` renders as `?` — short enough for a table column, and it
 * reads as "not recorded" rather than as a declared value. */
export function formatApplicabilitySource(
  source: ResolvedApplicabilitySource,
): string {
  return source === 'unknown' ? '?' : source;
}

/** Joined with `+` so a tag spanning two checks with different sources reads
 * as `artifact+fixture` rather than silently showing only one of them. */
function formatApplicabilitySources(
  sources: ResolvedApplicabilitySource[],
): string {
  return sources.map(formatApplicabilitySource).join('+');
}

/**
 * The per-fixture rate table, shared verbatim between `eval:report` and
 * `eval:rescore`'s own report. One definition rather than two copies: the
 * two rendered identical tables from identical `RateEntry[]` already, and
 * keeping two column lists in step by hand is exactly how a re-scored report
 * ends up describing different columns than the run report it's compared to.
 */
export function renderRatesTable(
  rates: RateEntry[],
  emptyText: string,
): string[] {
  if (rates.length === 0) return [emptyText];

  const lines = [
    '| Fixture | Check | Tag | Mode | Src | Pass | Fail | N/A | Error | N | Rate | App |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rates) {
    lines.push(
      `| ${r.fixtureId} | ${r.checkId} | ${r.tag} | ${r.checkMode} | ` +
        `${formatApplicabilitySource(r.applicabilitySource)} | ${r.pass} | ` +
        `${r.fail} | ${r.notApplicable} | ${r.error} | ${r.n} | ` +
        `${formatRate(r.rate)} | ${formatApplicability(r)} |`,
    );
  }
  return lines;
}

/** The per-tag rollup table, shared for the same reason as
 * `renderRatesTable`. */
export function renderTagRollupTable(
  rollups: TagRollup[],
  emptyText: string,
): string[] {
  if (rollups.length === 0) return [emptyText];

  const lines = [
    '| Tag | Src | Pass | Fail | N/A | Error | N | Rate | App | Fixtures w/o denominator |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const t of rollups) {
    lines.push(
      `| ${t.tag} | ${formatApplicabilitySources(t.applicabilitySources)} | ` +
        `${t.pass} | ${t.fail} | ${t.notApplicable} | ${t.error} | ${t.n} | ` +
        `${formatRate(t.rate)} | ${formatApplicability(t)} | ` +
        `${t.fixturesWithNoDenominator} |`,
    );
  }
  return lines;
}

/**
 * The `## Applicability findings` section: defects (the harness is wrong)
 * before notes (the number is right but needs reading carefully), each group
 * labelled, so a bug can't be skimmed as a finding about the model.
 */
export function renderApplicabilityFindings(rates: RateEntry[]): string[] {
  const lines = ['## Applicability findings', ''];
  const findings = findApplicabilityIssues(rates);
  const defects = findings.filter((f) => f.severity === 'defect');
  const notes = findings.filter((f) => f.severity === 'note');

  if (findings.length === 0) {
    lines.push('(none)');
    return lines;
  }

  if (defects.length > 0) {
    lines.push('**Harness defects** — these are bugs, not model findings.', '');
    for (const f of defects) lines.push(`- ${f.message}`);
    if (notes.length > 0) lines.push('');
  }
  if (notes.length > 0) {
    lines.push('**How to read these numbers**', '');
    for (const f of notes) lines.push(`- ${f.message}`);
  }
  return lines;
}

/**
 * Which grading a rendered report describes — the run's own `scores.jsonl`
 * or one re-score pass. Structurally what `resolveScoring` returns, restated
 * here as the narrow thing a renderer needs so this file stays free of any
 * filesystem dependency.
 *
 * Not optional: a run directory can hold several gradings of the same
 * generator output, and a report that doesn't name which one it used is a
 * report two people will quote at each other without noticing they aren't
 * discussing the same numbers.
 */
export interface ScoringProvenance {
  kind: 'run' | 'rescore';
  label: string;
  source: string;
  /** Re-graded rows only — see `ResolvedScoring`. Carried-forward provenance
   * is `carriedForwardHarnessVersion`, reported separately and never mixed
   * in here. */
  corpusVersion?: string;
  harnessVersion?: string;
  carriedForward?: number;
  carriedForwardHarnessVersion?: string;
}

/** Header bullets naming the grading, shared by `eval:report` and
 * `eval:compare`'s per-side headers. */
export function renderScoringProvenance(scoring: ScoringProvenance): string[] {
  const lines = [`- Scoring: ${scoring.label} (${scoring.source})`];
  if (scoring.kind === 'rescore') {
    if (scoring.corpusVersion) {
      lines.push(
        `- Corpus version at scoring: ${shortCorpusVersion(scoring.corpusVersion)}`,
      );
    }
    if (scoring.harnessVersion) {
      lines.push(`- Harness version at scoring: ${scoring.harnessVersion}`);
    }
    if (scoring.carriedForward !== undefined) {
      // Names the grader these rows kept, so the count reads as provenance
      // rather than as this pass having spanned two harness versions.
      const under = scoring.carriedForwardHarnessVersion
        ? ` (verdicts retained from harness ${scoring.carriedForwardHarnessVersion})`
        : '';
      lines.push(
        `- Carried forward (no artifact to re-grade): ${scoring.carriedForward}${under}`,
      );
    }
  }
  return lines;
}

/**
 * Renders a run's vouched rates as markdown. Pure function over
 * `readManifest`/`computeRates`/`summarizeExclusions`'s output — no DB, no
 * network, no Anthropic (enforced by a guard test importing nothing from
 * `src/db`). Valid markdown even for a run with zero vouched reps — that is
 * what you get after a crashed first rep, and it must say so rather than
 * throw.
 *
 * `rates` is consumed in the order `computeRates` already sorted it
 * (`fixtureId`, then `checkId`) — not re-sorted here, so two reports over
 * the same rows always diff cleanly.
 */
export function renderRunReport(
  manifest: Manifest,
  rates: RateEntry[],
  exclusions: ExclusionsSummary,
  scoring: ScoringProvenance,
): string {
  const lines: string[] = [];

  // The title carries the grading too, not only the `- Scoring:` bullet: an
  // excerpt pasted into a message usually takes the heading and drops the
  // header block.
  const titleSuffix = scoring.kind === 'rescore' ? ` (${scoring.label})` : '';
  lines.push(`# Eval Run Report${titleSuffix}: ${manifest.runId}`, '');
  lines.push(`- Model: ${manifest.model}`);
  lines.push(`- Prompt hash: ${manifest.promptHash}`);
  lines.push(`- Temperature: ${manifest.temperature}`);
  lines.push(`- Corpus version: ${shortCorpusVersion(manifest.corpusVersion)}`);
  lines.push(`- Planned reps: ${manifest.plannedReps}`);
  lines.push(`- Completed reps: ${manifest.completedReps.length}`);
  lines.push(...renderScoringProvenance(scoring));
  if (manifest.decisionRule) {
    lines.push(`- Decision rule: ${manifest.decisionRule}`);
  }
  lines.push('');

  lines.push('## Per-fixture rates', '');
  lines.push(...renderRatesTable(rates, '(no vouched rows)'));
  lines.push('');

  lines.push('## Per-tag rollup', '');
  lines.push(...renderTagRollupTable(rollupByTag(rates), '(no vouched rows)'));
  lines.push('');

  lines.push(...renderApplicabilityFindings(rates));
  lines.push('');

  lines.push('## Errors', '');
  if (exclusions.errorsByMessage.length === 0) {
    lines.push('(none)');
  } else {
    for (const e of exclusions.errorsByMessage) {
      lines.push(`- (${e.count}x) ${e.message}`);
    }
  }
  lines.push('');

  lines.push('## Exclusions', '');
  const hasExclusions =
    exclusions.unvouchedReps.length > 0 ||
    exclusions.notApplicableByReason.length > 0 ||
    exclusions.rawExclusions.length > 0;
  if (!hasExclusions) {
    lines.push('(none)');
  } else {
    if (exclusions.unvouchedReps.length > 0) {
      lines.push(
        `- Unvouched reps on disk (not in manifest.json): ${exclusions.unvouchedReps.join(', ')}`,
      );
    }
    for (const na of exclusions.notApplicableByReason) {
      lines.push(`- (${na.count}x) not_applicable: ${na.reason}`);
    }
    for (const raw of exclusions.rawExclusions) {
      lines.push(`- ${raw}`);
    }
  }
  lines.push('');

  lines.push('### Not-applicable, by fixture', '');
  if (exclusions.notApplicableByFixture.length === 0) {
    lines.push('(none)');
  } else {
    lines.push(
      '| Fixture | Check | Count | Reason |',
      '| --- | --- | --- | --- |',
    );
    for (const na of exclusions.notApplicableByFixture) {
      lines.push(
        `| ${na.fixtureId} | ${na.checkId} | ${na.count} | ${na.reason} |`,
      );
    }
  }

  return lines.join('\n');
}
