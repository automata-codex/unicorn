import { shortCorpusVersion } from '../corpus-version';

import { isImprovement, isRegression, isUnchanged, isUnpaired } from './compare';
import { formatRate } from './report-multi';

import type { Manifest } from './manifest';
import type { ComparePair } from './compare';

function formatDelta(delta: number | null): string {
  if (delta === null) return 'n/a';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}`;
}

function renderPairedTable(title: string, pairs: ComparePair[]): string[] {
  const lines = [`## ${title} (${pairs.length})`, ''];
  if (pairs.length === 0) {
    lines.push('(none)');
  } else {
    lines.push(
      '| Fixture | Check | Tag | Rate A | Rate B | Δ | N A | N B |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const p of pairs) {
      lines.push(
        `| ${p.fixtureId} | ${p.checkId} | ${p.tag} | ${formatRate(p.rateA)} | ${formatRate(p.rateB)} | ${formatDelta(p.delta)} | ${p.nA} | ${p.nB} |`,
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
      '| Fixture | Check | Tag | Status | Rate A | Rate B | N A | N B |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const p of pairs) {
      lines.push(
        `| ${p.fixtureId} | ${p.checkId} | ${p.tag} | ${p.status} | ${formatRate(p.rateA)} | ${formatRate(p.rateB)} | ${p.nA} | ${p.nB} |`,
      );
    }
  }
  lines.push('');
  return lines;
}

function renderRunHeader(label: string, manifest: Manifest): string[] {
  const lines = [`## Run ${label}: ${manifest.runId}`, ''];
  lines.push(`- Model: ${manifest.model}`);
  lines.push(`- Prompt hash: ${manifest.promptHash}`);
  lines.push(`- Temperature: ${manifest.temperature}`);
  lines.push(`- Corpus version: ${shortCorpusVersion(manifest.corpusVersion)}`);
  lines.push(
    `- Decision rule: ${manifest.decisionRule ?? '(none recorded)'}`,
  );
  lines.push('');
  return lines;
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
  manifestA: Manifest,
  manifestB: Manifest,
  pairs: ComparePair[],
  heterogeneityWarningsA: string[],
  heterogeneityWarningsB: string[],
): string {
  const lines: string[] = ['# Eval Compare Report', ''];

  lines.push(...renderRunHeader('A', manifestA));
  lines.push(...renderRunHeader('B', manifestB));

  const warnings = [...heterogeneityWarningsA, ...heterogeneityWarningsB];
  if (manifestA.corpusVersion !== manifestB.corpusVersion) {
    warnings.push(
      'Corpus versions differ between run A and run B ' +
        `(${shortCorpusVersion(manifestA.corpusVersion)} vs ${shortCorpusVersion(manifestB.corpusVersion)}) — ` +
        'this comparison mixes prompt/model effect with fixture-corpus differences.',
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
  lines.push(...renderPairedTable('Unchanged', unchanged));
  lines.push(...renderUnpairedTable(unpaired));

  // Drop the final blank line each section pushes — join adds no trailing
  // newline of its own, matching report-multi.ts's convention.
  if (lines[lines.length - 1] === '') lines.pop();

  return lines.join('\n');
}
