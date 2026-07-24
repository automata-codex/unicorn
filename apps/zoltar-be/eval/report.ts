import type { EvalFixture } from './fixture.schema';

/**
 * One fixture's outcome, ready to render. `expected` is sourced from the
 * fixture's own `check` (structural) or the judge's rubric-derived
 * description (judged) — `renderReport` never re-derives it, just displays
 * it. `actual` is the checker's verdict detail (`StructuralVerdict.actual`
 * or the judge's `rationale`).
 */
export interface FixtureResult {
  fixture: EvalFixture;
  passed: boolean;
  expected: string;
  actual: string;
}

function summaryByTag(results: FixtureResult[]): string[] {
  const byTag = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const counts = byTag.get(result.fixture.tag) ?? { passed: 0, total: 0 };
    counts.total += 1;
    if (result.passed) counts.passed += 1;
    byTag.set(result.fixture.tag, counts);
  }

  return [...byTag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, { passed, total }]) => `- ${tag}: ${passed}/${total} passed`);
}

function resultBlocks(results: FixtureResult[], passed: boolean): string[] {
  return results
    .filter((result) => result.passed === passed)
    .map(
      (result) =>
        `### ${result.fixture.id} — ${passed ? 'PASSED' : 'FAILED'}\n` +
        `Expected: ${result.expected}\n` +
        `Actual: ${result.actual}`,
    );
}

/**
 * Renders the M7.4 spec's "Output Format" markdown, extended with a
 * trailing "## Passes" section (beyond what the spec illustrates) so a
 * reviewer confirming a whole fixture library against a baseline prompt can
 * see every fixture's Expected/Actual detail, not just the failing ones —
 * a passing regression fixture can still be passing for the wrong reason.
 * `runLabel` is typically the prompt-variant filename (or "baseline" for
 * the unmodified prompt) — whatever the caller wants displayed as which
 * run this is.
 *
 * Renders valid, non-crashing markdown for empty `results` too (fixture
 * count 0, both sections present but empty) — the spec's fixture-count bar
 * explicitly allows tags with fewer than 2 (or 0) confirmed instances while
 * coverage fills in, and a harness run over a sparse or as-yet-empty
 * fixture set shouldn't be a special case the renderer chokes on.
 */
export function renderReport(
  runLabel: string,
  results: FixtureResult[],
): string {
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  const sections = [
    `# Eval Run: ${runLabel}`,
    `Fixtures: ${results.length}  |  Passed: ${passedCount}  |  Failed: ${failedCount}`,
    ['## Summary by tag', ...summaryByTag(results)].join('\n'),
    ['## Failures', ...resultBlocks(results, false)].join('\n\n'),
    ['## Passes', ...resultBlocks(results, true)].join('\n\n'),
  ];

  return `${sections.join('\n\n')}\n`;
}
