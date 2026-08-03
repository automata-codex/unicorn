import { describe, expect, it } from 'vitest';

import { renderRescoreReport } from './eval-rescore.report';

import type { Manifest } from '../eval/runs/manifest';
import type { RescoreSummary } from './eval-rescore.core';

const MANIFEST: Manifest = {
  schemaVersion: 1,
  runId: 'claude-sonnet-4-6__97feadbd__2026-07-29T10-51-26Z',
  model: 'claude-sonnet-4-6',
  promptHash: '97feadbd',
  temperature: 1,
  corpusVersion: '4c9f2e73efd7aaaaaaaa',
  createdAt: '2026-07-29T10:51:26.000Z',
  plannedReps: 10,
  completedReps: [],
};

function summary(overrides: Partial<RescoreSummary> = {}): RescoreSummary {
  return {
    outputPath: '/runs/thisrun/rescore/2026-07-30T09-00-00Z.jsonl',
    manifest: MANIFEST,
    rows: [],
    corpusVersion: '4c9f2e73efd7aaaaaaaa',
    harnessVersion: 'deadbee',
    rates: [],
    exclusions: {
      unvouchedReps: [],
      rawExclusions: [],
      notApplicableByReason: [],
      notApplicableByFixture: [],
      errorsByMessage: [],
    },
    deltas: [],
    unpairedChecks: [],
    carriedForward: 0,
    notes: [],
    ...overrides,
  };
}

describe('renderRescoreReport', () => {
  it('says so plainly when nothing moved', () => {
    const rendered = renderRescoreReport(
      summary({
        rows: Array(20).fill(null) as never,
        deltas: [
          {
            fixtureId: 'turn19-out-of-order-resolution',
            checkId: 'out-of-order-resolution',
            sourceRate: 0,
            sourceN: 9,
            rescoredRate: 0,
            rescoredN: 9,
            changedVerdicts: 0,
            transitions: [],
          },
        ],
      }),
    );

    expect(rendered).toContain('No verdict changed across 20 rows');
  });

  it('leads with the deltas, naming transitions and the rate move', () => {
    const rendered = renderRescoreReport(
      summary({
        deltas: [
          {
            fixtureId: 'turn19-system-rolled-player-action',
            checkId: 'system-rolled-player-action',
            sourceRate: 0.125,
            sourceN: 8,
            rescoredRate: 0.3,
            rescoredN: 10,
            changedVerdicts: 4,
            transitions: [
              { from: 'not_applicable', to: 'pass', count: 3 },
              { from: 'pass', to: 'fail', count: 1 },
            ],
          },
          {
            fixtureId: 'turn21-out-of-order-resolution',
            checkId: 'out-of-order-resolution',
            sourceRate: null,
            sourceN: 0,
            rescoredRate: 1,
            rescoredN: 10,
            changedVerdicts: 10,
            transitions: [{ from: 'not_applicable', to: 'pass', count: 10 }],
          },
        ],
      }),
    );

    const deltaHeading = rendered.indexOf('## Deltas');
    const ratesHeading = rendered.indexOf('## Re-scored per-fixture rates');
    expect(deltaHeading).toBeGreaterThan(-1);
    expect(deltaHeading).toBeLessThan(ratesHeading);

    expect(rendered).toContain('0.13 → 0.30 (+0.17)');
    expect(rendered).toContain('not_applicable→pass ×3');
    expect(rendered).toContain('8 → 10');
    expect(rendered).toContain('2 of 2 (fixture, check) pairs moved.');
  });

  it('never renders an undefined rate as 0.00', () => {
    const rendered = renderRescoreReport(
      summary({
        deltas: [
          {
            fixtureId: 'turn14-unauditable-mapping',
            checkId: 'unauditable-mapping',
            sourceRate: null,
            sourceN: 0,
            rescoredRate: null,
            rescoredN: 0,
            changedVerdicts: 2,
            transitions: [{ from: 'fail', to: 'not_applicable', count: 2 }],
          },
        ],
      }),
    );

    expect(rendered).toContain('n/a');
    expect(rendered).not.toContain('0.00');
  });

  it('flags a corpus version that moved between the run and the re-score', () => {
    const unchanged = renderRescoreReport(summary());
    expect(unchanged).toContain(
      'Corpus version at re-score: 4c9f2e73efd7 (unchanged)',
    );

    const moved = renderRescoreReport(
      summary({ corpusVersion: 'aaaa1111bbbb2222' }),
    );
    expect(moved).toContain('run was scored under 4c9f2e73efd7');
  });

  it('reports unpaired checks rather than absorbing them into a rate', () => {
    const rendered = renderRescoreReport(
      summary({
        unpairedChecks: [
          'rep 1 / turn16-narrating-past-a-block: check "narrating-past-a-block" ' +
            'is produced by the current registry but has no row in the source run',
        ],
      }),
    );

    expect(rendered).toContain('## Unpaired checks');
    expect(rendered).toContain('no row in the source run');
  });

  it('surfaces carried-forward rows in the header', () => {
    const rendered = renderRescoreReport(summary({ carriedForward: 24 }));
    expect(rendered).toContain(
      '- Carried forward (no artifact to re-grade): 24',
    );
  });

  it('renders the same rate and rollup columns eval:report does', () => {
    // Not a duplicate of report-multi.spec's golden: the point is that both
    // commands go through `renderRatesTable`/`renderTagRollupTable`, so a
    // re-scored report can never describe different columns than the run
    // report it will be compared against.
    const rendered = renderRescoreReport(
      summary({
        rates: [
          {
            fixtureId: 'turn14-unauditable-mapping',
            checkId: 'unauditable-mapping',
            tag: 'UNAUDITABLE-MAPPING',
            checkMode: 'judged',
            applicabilitySource: 'artifact',
            pass: 0,
            fail: 0,
            notApplicable: 7,
            error: 3,
            n: 0,
            rate: null,
            applicabilityDenominator: 7,
            applicability: 0,
          },
        ],
      }),
    );

    expect(rendered).toContain(
      '| Fixture | Check | Tag | Mode | Src | Pass | Fail | N/A | Error | N | Rate | App |',
    );
    expect(rendered).toContain(
      '| Tag | Src | Pass | Fail | N/A | Error | N | Rate | App | Fixtures w/o denominator |',
    );
    // The 3 errors are out of the applicability denominator entirely — this
    // reads 0/7, not 0/10.
    expect(rendered).toContain(
      '| turn14-unauditable-mapping | unauditable-mapping | UNAUDITABLE-MAPPING | judged | artifact | 0 | 0 | 7 | 3 | 0 | n/a | 0.00 (0/7) |',
    );
    // Artifact-gated: a note about how to read it, never filed as a defect.
    expect(rendered).toContain('**How to read these numbers**');
    expect(rendered).not.toContain('**Harness defects**');
  });
});
