import { shortCorpusVersion } from '../corpus-version';

import { rollupByTag } from './rates';

import type { Manifest } from './manifest';
import type { ExclusionsSummary, RateEntry } from './rates';

/** Shared with `compare-report.ts` — an undefined rate must never render as
 * `0.00`. */
export function formatRate(rate: number | null): string {
  return rate === null ? 'n/a' : rate.toFixed(2);
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
): string {
  const lines: string[] = [];

  lines.push(`# Eval Run Report: ${manifest.runId}`, '');
  lines.push(`- Model: ${manifest.model}`);
  lines.push(`- Prompt hash: ${manifest.promptHash}`);
  lines.push(`- Temperature: ${manifest.temperature}`);
  lines.push(`- Corpus version: ${shortCorpusVersion(manifest.corpusVersion)}`);
  lines.push(`- Planned reps: ${manifest.plannedReps}`);
  lines.push(`- Completed reps: ${manifest.completedReps.length}`);
  if (manifest.decisionRule) {
    lines.push(`- Decision rule: ${manifest.decisionRule}`);
  }
  lines.push('');

  lines.push('## Per-fixture rates', '');
  if (rates.length === 0) {
    lines.push('(no vouched rows)');
  } else {
    lines.push(
      '| Fixture | Check | Tag | Mode | Pass | Fail | N/A | Error | N | Rate |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const r of rates) {
      lines.push(
        `| ${r.fixtureId} | ${r.checkId} | ${r.tag} | ${r.checkMode} | ${r.pass} | ${r.fail} | ${r.notApplicable} | ${r.error} | ${r.n} | ${formatRate(r.rate)} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Per-tag rollup', '');
  const rollups = rollupByTag(rates);
  if (rollups.length === 0) {
    lines.push('(no vouched rows)');
  } else {
    lines.push(
      '| Tag | Pass | Fail | N | Rate | Fixtures w/o denominator |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const t of rollups) {
      lines.push(
        `| ${t.tag} | ${t.pass} | ${t.fail} | ${t.n} | ${formatRate(t.rate)} | ${t.fixturesWithNoDenominator} |`,
      );
    }
  }
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
