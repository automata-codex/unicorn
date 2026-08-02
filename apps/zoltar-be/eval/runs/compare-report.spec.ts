import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { comparePairs, orderForDisplay } from './compare';
import { renderCompareReport } from './compare-report';

import type { Manifest } from './manifest';
import type { RateEntry } from './rates';

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: 1,
    runId: 'claude-sonnet-4-6__aaaaaaaa__2026-07-26T14-32-10Z',
    model: 'claude-sonnet-4-6',
    promptHash: 'aaaaaaaa',
    temperature: 1,
    corpusVersion: 'deadbeef'.repeat(8),
    createdAt: '2026-07-26T14:32:10.000Z',
    plannedReps: 10,
    completedReps: [],
    ...overrides,
  };
}

function rate(overrides: Partial<RateEntry> = {}): RateEntry {
  const pass = overrides.pass ?? 5;
  const fail = overrides.fail ?? 5;
  const notApplicable = overrides.notApplicable ?? 0;
  const n = pass + fail;
  const applicabilityDenominator = n + notApplicable;
  return {
    fixtureId: 'fixture-a',
    checkId: 'check-a',
    tag: 'OUT-OF-ORDER-RESOLUTION',
    checkMode: 'structural',
    applicabilitySource: 'fixture',
    pass,
    fail,
    notApplicable,
    error: 0,
    n,
    rate: n === 0 ? null : pass / n,
    applicabilityDenominator,
    applicability:
      applicabilityDenominator === 0 ? null : n / applicabilityDenominator,
    ...overrides,
  };
}

describe('renderCompareReport', () => {
  it('echoes each side decisionRule verbatim in the header', () => {
    const manifestA = baseManifest({
      decisionRule: 'ship if no fixture drops >0.2 and median rises',
    });
    const manifestB = baseManifest({
      runId: 'claude-sonnet-4-6__bbbbbbbb__2026-07-27T09-00-00Z',
      promptHash: 'bbbbbbbb',
    });

    const report = renderCompareReport(manifestA, manifestB, [], [], []);

    expect(report).toContain(
      '- Decision rule: ship if no fixture drops >0.2 and median rises',
    );
    expect(report).toContain('- Decision rule: (none recorded)');
  });

  it('warns loudly when the two sides have different corpusVersion', () => {
    const manifestA = baseManifest({ corpusVersion: 'aa'.repeat(32) });
    const manifestB = baseManifest({
      runId: 'claude-sonnet-4-6__bbbbbbbb__2026-07-27T09-00-00Z',
      corpusVersion: 'bb'.repeat(32),
    });

    const report = renderCompareReport(manifestA, manifestB, [], [], []);

    expect(report).toContain('Corpus versions differ between run A and run B');
    expect(report).toContain('aaaaaaaaaaaa'); // shortCorpusVersion(A)
    expect(report).toContain('bbbbbbbbbbbb'); // shortCorpusVersion(B)
  });

  it('does not warn when both sides share the same corpusVersion', () => {
    const shared = 'cc'.repeat(32);
    const manifestA = baseManifest({ corpusVersion: shared });
    const manifestB = baseManifest({
      runId: 'claude-sonnet-4-6__bbbbbbbb__2026-07-27T09-00-00Z',
      corpusVersion: shared,
    });

    const report = renderCompareReport(manifestA, manifestB, [], [], []);

    expect(report).toContain('## Warnings\n\n(none)');
  });

  it('includes heterogeneity warnings from both sides', () => {
    const report = renderCompareReport(
      baseManifest(),
      baseManifest({ runId: 'run-b' }),
      [],
      ['run A spans multiple rubric hashes (aaaaaaaa, bbbbbbbb)'],
      ['run B spans multiple harness versions (abc1111, abc2222)'],
    );

    expect(report).toContain(
      '- run A spans multiple rubric hashes (aaaaaaaa, bbbbbbbb)',
    );
    expect(report).toContain(
      '- run B spans multiple harness versions (abc1111, abc2222)',
    );
  });

  it('sections pairs into Regressions/Improvements/Unchanged/Unpaired and renders their rows', () => {
    const ratesA: RateEntry[] = [
      rate({ fixtureId: 'regresses', pass: 9, fail: 1 }),
      rate({ fixtureId: 'improves', pass: 1, fail: 9 }),
      rate({ fixtureId: 'flat', pass: 5, fail: 5 }),
    ];
    const ratesB: RateEntry[] = [
      rate({ fixtureId: 'regresses', pass: 5, fail: 5 }),
      rate({ fixtureId: 'improves', pass: 9, fail: 1 }),
      rate({ fixtureId: 'flat', pass: 5, fail: 5 }),
      rate({ fixtureId: 'b-only' }),
    ];
    const pairs = orderForDisplay(comparePairs(ratesA, ratesB));

    const report = renderCompareReport(
      baseManifest(),
      baseManifest({ runId: 'run-b' }),
      pairs,
      [],
      [],
    );

    expect(report).toContain('## Regressions (1)');
    expect(report).toContain('| regresses | check-a |');
    expect(report).toContain('## Improvements (1)');
    expect(report).toContain('| improves | check-a |');
    expect(report).toContain('## Unchanged (1)');
    expect(report).toContain('| flat | check-a |');
    expect(report).toContain('## Unpaired / No Denominator (1)');
    expect(report).toContain('| b-only | check-a |');

    // Regressions section appears before Improvements in the rendered text.
    expect(report.indexOf('## Regressions')).toBeLessThan(
      report.indexOf('## Improvements'),
    );
  });

  it('renders "(none)" for every section on an empty comparison', () => {
    const report = renderCompareReport(
      baseManifest(),
      baseManifest({ runId: 'run-b' }),
      [],
      [],
      [],
    );

    expect(report).toContain('## Regressions (0)\n\n(none)');
    expect(report).toContain('## Improvements (0)\n\n(none)');
    expect(report).toContain('## Applicability shifts (0)\n\n(none)');
    expect(report).toContain('## Unchanged (0)\n\n(none)');
    expect(report).toContain('## Unpaired / No Denominator (0)\n\n(none)');
  });

  it('puts App A / App B / ΔApp on every paired row', () => {
    const pairs = orderForDisplay(
      comparePairs(
        [rate({ fixtureId: 'improves', pass: 6, fail: 4 })],
        [rate({ fixtureId: 'improves', pass: 4, fail: 0, notApplicable: 6 })],
      ),
    );

    const report = renderCompareReport(
      baseManifest(),
      baseManifest({ runId: 'run-b' }),
      pairs,
      [],
      [],
    );

    expect(report).toContain(
      '| Fixture | Check | Tag | Rate A | Rate B | Δ | N A | N B | App A | App B | ΔApp |',
    );
    // +0.40 on the rate, entirely bought by six reps leaving the denominator.
    expect(report).toContain(
      '| improves | check-a | OUT-OF-ORDER-RESOLUTION | 0.60 | 1.00 | +0.40 | 10 | 4 | 1.00 | 0.40 | -0.60 |',
    );
  });

  it('gives an applicability collapse a magnitude even with no rate delta', () => {
    // Previously this rendered as a bare `not-applicable-one-side` row: the
    // largest denominator move in the run, with no number attached to it.
    const pairs = orderForDisplay(
      comparePairs(
        [
          rate({
            fixtureId: 'turn19-system-rolled-player-action',
            checkId: 'system-rolled-player-action',
            pass: 18,
            fail: 0,
            notApplicable: 2,
          }),
        ],
        [
          rate({
            fixtureId: 'turn19-system-rolled-player-action',
            checkId: 'system-rolled-player-action',
            pass: 0,
            fail: 0,
            notApplicable: 20,
          }),
        ],
      ),
    );

    const report = renderCompareReport(
      baseManifest(),
      baseManifest({ runId: 'run-b' }),
      pairs,
      [],
      [],
    );

    expect(report).toContain('## Applicability shifts (1)');
    expect(report).toContain('Not disjoint from the sections above');
    expect(report).toContain(
      '| turn19-system-rolled-player-action | system-rolled-player-action | ' +
        'OUT-OF-ORDER-RESOLUTION | fixture | fixture | 0.90 (18/20) | ' +
        '0.00 (0/20) | -0.90 | 1.00 | n/a | n/a | not-applicable-one-side |',
    );
    // And it is still reported in the unpaired table, unchanged.
    expect(report).toContain('## Unpaired / No Denominator (1)');
  });

  it('lists a denominator-bought improvement in both Improvements and Applicability shifts', () => {
    const pairs = orderForDisplay(
      comparePairs(
        [rate({ fixtureId: 'bought', pass: 6, fail: 4 })],
        [rate({ fixtureId: 'bought', pass: 4, fail: 0, notApplicable: 6 })],
      ),
    );

    const report = renderCompareReport(
      baseManifest(),
      baseManifest({ runId: 'run-b' }),
      pairs,
      [],
      [],
    );

    expect(report).toContain('## Improvements (1)');
    expect(report).toContain('## Applicability shifts (1)');
    expect(report.indexOf('## Applicability shifts')).toBeGreaterThan(
      report.indexOf('## Improvements'),
    );
  });

  it('warns when a check gates applicability differently on each side', () => {
    const pairs = comparePairs(
      [rate({ fixtureId: 'migrated', applicabilitySource: 'artifact' })],
      [rate({ fixtureId: 'migrated', applicabilitySource: 'fixture' })],
    );

    const report = renderCompareReport(
      baseManifest(),
      baseManifest({ runId: 'run-b' }),
      pairs,
      [],
      [],
    );

    expect(report).toContain(
      'gates applicability on artifact in run A and fixture in run B',
    );
  });
});

describe('guard: compare.ts and compare-report.ts never read the DB', () => {
  it('import nothing from src/db', () => {
    for (const file of ['compare.ts', 'compare-report.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf-8');
      expect(source).not.toMatch(/from ['"].*src\/db/);
    }
  });
});
