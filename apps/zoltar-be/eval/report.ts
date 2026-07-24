import type { EvalFixture } from './fixture.schema';

/**
 * `NOT_APPLICABLE` means the turn never produced the condition this
 * fixture's checker/rubric evaluates (no dice_roll this turn, no player
 * entity identifiable, no block pending, ...) — distinct from `PASSED`,
 * which means the condition was present and no violation was found. Judged
 * (LLM-graded) fixtures never produce this outcome — a judge can always
 * answer its rubric's question, even trivially — only structural checkers
 * can (see `StructuralOutcome` in `checks/structural/types.ts`).
 */
export type FixtureOutcome = 'PASSED' | 'FAILED' | 'NOT_APPLICABLE';

/**
 * One fixture's outcome, ready to render. `expected` is sourced from the
 * fixture's own `check` (structural) or the judge's rubric-derived
 * description (judged) — `renderReport` never re-derives it, just displays
 * it. `actual` is the checker's verdict detail (`StructuralVerdict.actual`
 * or the judge's `rationale`).
 */
export interface FixtureResult {
  fixture: EvalFixture;
  outcome: FixtureOutcome;
  expected: string;
  actual: string;
  /** The scratch `campaign`/`adventure` row ids this fixture ran against —
   * always populated (even when `--keep-scratch` wasn't passed and the rows
   * are already deleted by the time the report is read), so a report entry
   * can be traced back to its DB rows without a name-pattern guess. */
  campaignId: string;
  adventureId: string;
}

interface TagCounts {
  passed: number;
  failed: number;
  notApplicable: number;
}

function summaryByTag(results: FixtureResult[]): string[] {
  const byTag = new Map<string, TagCounts>();
  for (const result of results) {
    const counts = byTag.get(result.fixture.tag) ?? {
      passed: 0,
      failed: 0,
      notApplicable: 0,
    };
    if (result.outcome === 'PASSED') counts.passed += 1;
    else if (result.outcome === 'FAILED') counts.failed += 1;
    else counts.notApplicable += 1;
    byTag.set(result.fixture.tag, counts);
  }

  return [...byTag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, { passed, failed, notApplicable }]) => {
      const base = `- ${tag}: ${passed}/${passed + failed} passed`;
      return notApplicable > 0 ? `${base} (${notApplicable} n/a)` : base;
    });
}

function resultBlocks(
  results: FixtureResult[],
  outcome: FixtureOutcome,
): string[] {
  return results
    .filter((result) => result.outcome === outcome)
    .map(
      (result) =>
        `### ${result.fixture.id} — ${outcome}\n` +
        `Campaign: ${result.campaignId}  |  Adventure: ${result.adventureId}\n` +
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
 * Also extended with a "## Not Applicable" section, between Failures and
 * Passes — a fixture whose checker found nothing to evaluate this run
 * (non-deterministic live model output; see `FixtureOutcome`) is neither a
 * confirmed pass nor a regression, and burying it in either section would
 * misrepresent which fixtures actually exercised their target failure mode
 * this run. `runLabel` is typically the prompt-variant filename (or
 * "baseline" for the unmodified prompt) — whatever the caller wants
 * displayed as which run this is.
 *
 * Renders valid, non-crashing markdown for empty `results` too (fixture
 * count 0, all three sections present but empty) — the spec's fixture-count
 * bar explicitly allows tags with fewer than 2 (or 0) confirmed instances
 * while coverage fills in, and a harness run over a sparse or as-yet-empty
 * fixture set shouldn't be a special case the renderer chokes on.
 *
 * `meta.runId` is the harness invocation's id (embedded in every scratch
 * campaign's name as `__eval__<fixture.id>__<runId>`) — printed once in the
 * header so a report can be traced back to its exact scratch rows even
 * after repeated `--keep-scratch` reruns leave multiple same-fixture
 * campaigns behind. `meta.keptScratch` reflects whether this run passed
 * `--keep-scratch`, so a reader knows up front whether the ids below are
 * still queryable or already torn down.
 */
export function renderReport(
  runLabel: string,
  results: FixtureResult[],
  meta: { runId: string; keptScratch: boolean },
): string {
  const passedCount = results.filter((r) => r.outcome === 'PASSED').length;
  const failedCount = results.filter((r) => r.outcome === 'FAILED').length;
  const notApplicableCount = results.length - passedCount - failedCount;

  const sections = [
    `# Eval Run: ${runLabel}  |  runId: ${meta.runId}  |  scratch: ${meta.keptScratch ? 'kept' : 'torn down'}`,
    `Fixtures: ${results.length}  |  Passed: ${passedCount}  |  Failed: ${failedCount}  |  N/A: ${notApplicableCount}`,
    ['## Summary by tag', ...summaryByTag(results)].join('\n'),
    ['## Failures', ...resultBlocks(results, 'FAILED')].join('\n\n'),
    ['## Not Applicable', ...resultBlocks(results, 'NOT_APPLICABLE')].join(
      '\n\n',
    ),
    ['## Passes', ...resultBlocks(results, 'PASSED')].join('\n\n'),
  ];

  return `${sections.join('\n\n')}\n`;
}
