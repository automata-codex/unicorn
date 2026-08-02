import { shortCorpusVersion } from '../corpus-version';

import {
  findApplicabilitySourceMismatches,
  findIndeterminateApplicabilitySources,
  isImprovement,
  isRegression,
  isUnchanged,
  isUnpaired,
  orderApplicabilityShifts,
} from './compare';
import {
  formatApplicability,
  formatApplicabilitySource,
  formatRate,
  renderScoringProvenance,
} from './report-multi';

import type { ComparePair } from './compare';
import type { Manifest } from './manifest';
import type { ScoringProvenance } from './report-multi';

function formatDelta(delta: number | null): string {
  if (delta === null) return 'n/a';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}`;
}

/** Bare ratio, no fraction: the paired tables already carry `N A`/`N B`, so
 * the denominator is on the row and a second copy of it in every cell would
 * cost width without adding anything. The applicability-shift section shows
 * the fractions, because there the denominator is the subject. */
function formatApplicabilityRatio(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function sourceCell(source: ComparePair['applicabilitySourceA']): string {
  return source === null ? '—' : formatApplicabilitySource(source);
}

function renderPairedTable(title: string, pairs: ComparePair[]): string[] {
  const lines = [`## ${title} (${pairs.length})`, ''];
  if (pairs.length === 0) {
    lines.push('(none)');
  } else {
    lines.push(
      '| Fixture | Check | Tag | Rate A | Rate B | Δ | N A | N B | App A | App B | ΔApp |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const p of pairs) {
      lines.push(
        `| ${p.fixtureId} | ${p.checkId} | ${p.tag} | ${formatRate(p.rateA)} | ` +
          `${formatRate(p.rateB)} | ${formatDelta(p.delta)} | ${p.nA} | ${p.nB} | ` +
          `${formatApplicabilityRatio(p.applicabilityA)} | ` +
          `${formatApplicabilityRatio(p.applicabilityB)} | ` +
          `${formatDelta(p.deltaApplicability)} |`,
      );
    }
  }
  lines.push('');
  return lines;
}

function renderUnpairedTable(pairs: ComparePair[]): string[] {
  const lines = [`## Unpaired / No Denominator (${pairs.length})`, ''];
  if (pairs.length === 0) {
    lines.push('(none)');
  } else {
    lines.push(
      '| Fixture | Check | Tag | Status | Rate A | Rate B | N A | N B | App A | App B | ΔApp |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const p of pairs) {
      lines.push(
        `| ${p.fixtureId} | ${p.checkId} | ${p.tag} | ${p.status} | ` +
          `${formatRate(p.rateA)} | ${formatRate(p.rateB)} | ${p.nA} | ${p.nB} | ` +
          `${formatApplicabilityRatio(p.applicabilityA)} | ` +
          `${formatApplicabilityRatio(p.applicabilityB)} | ` +
          `${formatDelta(p.deltaApplicability)} |`,
      );
    }
  }
  lines.push('');
  return lines;
}

/**
 * A peer section to Regressions/Improvements, and explicitly not disjoint
 * from them: a check that raised its rate by shrinking its denominator
 * belongs in both, and the header says so rather than letting the section
 * counts imply a partition.
 *
 * Shows fractions rather than bare ratios, and both sides' applicability
 * source — 0.90 → 0.00 on a fixture-gated check is a harness defect, the
 * same numbers on an artifact-gated one are a real behavioural finding, and
 * nothing else on the row distinguishes them.
 */
function renderApplicabilityShiftTable(pairs: ComparePair[]): string[] {
  const shifts = orderApplicabilityShifts(pairs);
  const lines = [`## Applicability shifts (${shifts.length})`, ''];
  if (shifts.length === 0) {
    lines.push('(none)');
    lines.push('');
    return lines;
  }

  lines.push(
    'Not disjoint from the sections above — a check that raised its rate by ' +
      'shrinking its denominator appears in both, which is the point.',
    '',
    '| Fixture | Check | Tag | Src A | Src B | App A | App B | ΔApp | Rate A | Rate B | Δ | Status |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const p of shifts) {
    const appA = formatApplicability({
      applicability: p.applicabilityA,
      n: p.nA,
      applicabilityDenominator: p.applicabilityDenominatorA,
    });
    const appB = formatApplicability({
      applicability: p.applicabilityB,
      n: p.nB,
      applicabilityDenominator: p.applicabilityDenominatorB,
    });
    lines.push(
      `| ${p.fixtureId} | ${p.checkId} | ${p.tag} | ` +
        `${sourceCell(p.applicabilitySourceA)} | ${sourceCell(p.applicabilitySourceB)} | ` +
        `${appA} | ${appB} | ${formatDelta(p.deltaApplicability)} | ` +
        `${formatRate(p.rateA)} | ${formatRate(p.rateB)} | ${formatDelta(p.delta)} | ` +
        `${p.status} |`,
    );
  }
  lines.push('');
  return lines;
}

/** One side of the comparison: the run, the grading its numbers came from,
 * and that side's heterogeneity warnings. Grouped rather than passed as
 * three parallel positional arguments per side — six positionals in
 * A,A,A,B,B,B order is a swap waiting to happen, and a comparison that
 * silently attributes run A's scoring to run B is precisely the failure this
 * plumbing exists to prevent. */
export interface CompareSideInput {
  manifest: Manifest;
  scoring: ScoringProvenance;
  heterogeneityWarnings: string[];
}

function renderRunHeader(label: string, side: CompareSideInput): string[] {
  const { manifest } = side;
  const lines = [`## Run ${label}: ${manifest.runId}`, ''];
  lines.push(`- Model: ${manifest.model}`);
  lines.push(`- Prompt hash: ${manifest.promptHash}`);
  lines.push(`- Temperature: ${manifest.temperature}`);
  lines.push(`- Corpus version: ${shortCorpusVersion(manifest.corpusVersion)}`);
  lines.push(`- Decision rule: ${manifest.decisionRule ?? '(none recorded)'}`);
  lines.push(...renderScoringProvenance(side.scoring));
  lines.push('');
  return lines;
}

/**
 * Warns when the two sides were graded by different graders — the hazard
 * `--scoring`'s default introduces and the reason that default is safe to
 * have at all. Two kinds of mismatch count: one side read from `reps/` while
 * the other read a re-score, and two re-scores produced under different
 * checker code. Neither shows up anywhere in the rates themselves.
 */
function scoringMismatchWarnings(
  a: ScoringProvenance,
  b: ScoringProvenance,
): string[] {
  if (a.kind !== b.kind) {
    return [
      `Run A is scored from ${a.label} and run B from ${b.label} — these ` +
        'are different graders over the same kind of output, so every Δ in ' +
        'this report mixes grader change with model change. Pass ' +
        '--scoring run (or --scoring rescore) to put both sides on the same ' +
        'footing.',
    ];
  }
  if (
    a.kind === 'rescore' &&
    a.harnessVersion !== undefined &&
    b.harnessVersion !== undefined &&
    a.harnessVersion !== b.harnessVersion
  ) {
    return [
      `Run A's re-score ran under harness ${a.harnessVersion} and run B's ` +
        `under ${b.harnessVersion} — the two sides were graded by different ` +
        'checker code, so this comparison is not grader-neutral.',
    ];
  }
  return [];
}

/**
 * Renders a paired comparison as markdown. `pairs` is expected already
 * ordered by `orderForDisplay` (regressions first) — this function doesn't
 * re-sort, so the caller's ordering choice is exactly what's rendered.
 *
 * Echoes each side's `decisionRule` verbatim, if recorded, so the
 * pre-registered rule sits next to the numbers it governs — the tool never
 * evaluates it. Warns loudly, but doesn't refuse to compare, when the two
 * sides' `corpusVersion` differ: a cross-corpus comparison is exactly the
 * silent-poisoning case `corpusVersion` was made a content hash to prevent,
 * and detecting it here (rather than only in the raw manifest field) is
 * the whole reason to name it explicitly.
 */
export function renderCompareReport(
  a: CompareSideInput,
  b: CompareSideInput,
  pairs: ComparePair[],
): string {
  const lines: string[] = ['# Eval Compare Report', ''];

  lines.push(...renderRunHeader('A', a));
  lines.push(...renderRunHeader('B', b));

  const warnings = [
    ...a.heterogeneityWarnings,
    ...b.heterogeneityWarnings,
    ...scoringMismatchWarnings(a.scoring, b.scoring),
  ];
  if (a.manifest.corpusVersion !== b.manifest.corpusVersion) {
    warnings.push(
      'Corpus versions differ between run A and run B ' +
        `(${shortCorpusVersion(a.manifest.corpusVersion)} vs ${shortCorpusVersion(b.manifest.corpusVersion)}) — ` +
        'this comparison mixes prompt/model effect with fixture-corpus differences.',
    );
  }
  for (const p of findApplicabilitySourceMismatches(pairs)) {
    warnings.push(
      `Check \`${p.checkId}\` (fixture ${p.fixtureId}) gates applicability on ` +
        `${p.applicabilitySourceA} in run A and ${p.applicabilitySourceB} in ` +
        'run B — a checker migrated between the two runs, so its App column ' +
        'means something different on each side and ΔApp is not a like-for-' +
        'like measure.',
    );
  }
  const indeterminate = findIndeterminateApplicabilitySources(pairs);
  if (indeterminate.length > 0) {
    warnings.push(
      `${indeterminate.length} (fixture, check) pair(s) have an applicability ` +
        "source of '?' or 'mixed' on at least one side — their rows predate " +
        'the field or disagree within a side, so ΔApp is arithmetic but ' +
        'carries no reading: ' +
        indeterminate.map((p) => `${p.fixtureId}/${p.checkId}`).join(', ') +
        '.',
    );
  }
  lines.push('## Warnings', '');
  if (warnings.length === 0) {
    lines.push('(none)');
  } else {
    for (const w of warnings) lines.push(`- ${w}`);
  }
  lines.push('');

  const regressions = pairs.filter(isRegression);
  const improvements = pairs.filter(isImprovement);
  const unchanged = pairs.filter(isUnchanged);
  const unpaired = pairs.filter(isUnpaired);

  lines.push(...renderPairedTable('Regressions', regressions));
  lines.push(...renderPairedTable('Improvements', improvements));
  lines.push(...renderApplicabilityShiftTable(pairs));
  lines.push(...renderPairedTable('Unchanged', unchanged));
  lines.push(...renderUnpairedTable(unpaired));

  // Drop the final blank line each section pushes — join adds no trailing
  // newline of its own, matching report-multi.ts's convention.
  if (lines[lines.length - 1] === '') lines.pop();

  return lines.join('\n');
}
