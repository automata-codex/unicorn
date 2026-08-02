import { shortCorpusVersion } from '../eval/corpus-version';
import { rollupByTag } from '../eval/runs/rates';
import {
  formatRate,
  renderApplicabilityFindings,
  renderRatesTable,
  renderTagRollupTable,
} from '../eval/runs/report-multi';

import type { RescoreSummary } from './eval-rescore.core';

function formatDelta(from: number | null, to: number | null): string {
  if (from === null && to === null) return 'n/a';
  if (from === null || to === null)
    return `${formatRate(from)} → ${formatRate(to)}`;
  const change = to - from;
  const sign = change > 0 ? '+' : '';
  return `${formatRate(from)} → ${formatRate(to)} (${sign}${change.toFixed(2)})`;
}

/**
 * Renders a re-score pass as markdown. The **Deltas** section is the point
 * of the command and comes first: a re-score exists to answer "what did the
 * checker change move," and a report that led with absolute rates would
 * bury that under numbers indistinguishable from a fresh run's.
 *
 * Pure function over `runRescore`'s summary — no DB, no network.
 */
export function renderRescoreReport(summary: RescoreSummary): string {
  const { manifest } = summary;
  const lines: string[] = [];

  lines.push(`# Eval Re-score: ${manifest.runId}`, '');
  lines.push(`- Raw rows: ${summary.outputPath}`);
  lines.push(
    `- Model: ${manifest.model} (generation — unchanged by a re-score)`,
  );
  lines.push(`- Prompt hash: ${manifest.promptHash} (generation)`);
  lines.push(
    `- Corpus version at re-score: ${shortCorpusVersion(summary.corpusVersion)}` +
      (summary.corpusVersion === manifest.corpusVersion
        ? ' (unchanged)'
        : ` (run was scored under ${shortCorpusVersion(manifest.corpusVersion)})`),
  );
  lines.push(`- Harness version at re-score: ${summary.harnessVersion}`);
  lines.push(`- Rows written: ${summary.rows.length}`);
  lines.push(
    `- Carried forward (no artifact to re-grade): ${summary.carriedForward}`,
  );
  lines.push('');

  const moved = summary.deltas.filter((d) => d.changedVerdicts > 0);
  lines.push("## Deltas vs. the run's own scores.jsonl", '');
  if (summary.deltas.length === 0) {
    lines.push('(nothing re-scored)');
  } else if (moved.length === 0) {
    lines.push(
      `No verdict changed across ${summary.rows.length} rows — the current ` +
        'checkers reproduce this run exactly.',
    );
  } else {
    lines.push(
      '| Fixture | Check | Rate | N | Changed | Transitions |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const d of moved) {
      const transitions = d.transitions
        .map((t) => `${t.from}→${t.to} ×${t.count}`)
        .join(', ');
      const n =
        d.sourceN === d.rescoredN
          ? `${d.rescoredN}`
          : `${d.sourceN} → ${d.rescoredN}`;
      lines.push(
        `| ${d.fixtureId} | ${d.checkId} | ${formatDelta(d.sourceRate, d.rescoredRate)} | ${n} | ${d.changedVerdicts} | ${transitions} |`,
      );
    }
    lines.push('');
    lines.push(
      `${moved.length} of ${summary.deltas.length} (fixture, check) pairs moved.`,
    );
  }
  lines.push('');

  lines.push('## Re-scored per-fixture rates', '');
  lines.push(...renderRatesTable(summary.rates, '(no rows)'));
  lines.push('');

  lines.push('## Re-scored per-tag rollup', '');
  lines.push(...renderTagRollupTable(rollupByTag(summary.rates), '(no rows)'));
  lines.push('');

  lines.push(...renderApplicabilityFindings(summary.rates));
  lines.push('');

  lines.push('## Unpaired checks', '');
  if (summary.unpairedChecks.length === 0) {
    lines.push(
      "(none — the current registry produced exactly the run's check set)",
    );
  } else {
    for (const u of summary.unpairedChecks) lines.push(`- ${u}`);
  }
  lines.push('');

  lines.push('## Not-applicable, by fixture', '');
  if (summary.exclusions.notApplicableByFixture.length === 0) {
    lines.push('(none)');
  } else {
    lines.push(
      '| Fixture | Check | Count | Reason |',
      '| --- | --- | --- | --- |',
    );
    for (const na of summary.exclusions.notApplicableByFixture) {
      lines.push(
        `| ${na.fixtureId} | ${na.checkId} | ${na.count} | ${na.reason} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Errors', '');
  if (summary.exclusions.errorsByMessage.length === 0) {
    lines.push('(none)');
  } else {
    for (const e of summary.exclusions.errorsByMessage) {
      lines.push(`- (${e.count}x) ${e.message}`);
    }
  }

  if (summary.notes.length > 0) {
    lines.push('', '## Notes', '');
    for (const n of summary.notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
}
