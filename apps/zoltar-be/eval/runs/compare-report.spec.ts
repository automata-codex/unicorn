import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { comparePairs, orderForDisplay } from './compare';
import { renderCompareReport } from './compare-report';

import type { CompareSideInput } from './compare-report';
import type { Manifest } from './manifest';
import type { RateEntry } from './rates';
import type { ScoringProvenance } from './report-multi';

const RUN_SCORING: ScoringProvenance = {
  kind: 'run',
  label: "the run's own scores",
  source: '/runs/thisrun/reps/<nnn>/scores.jsonl',
};

function side(
  manifest: Manifest,
  overrides: Partial<CompareSideInput> = {},
): CompareSideInput {
  return {
    manifest,
    scoring: RUN_SCORING,
    heterogeneityWarnings: [],
    ...overrides,
  };
}

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: 1,
    runId: 'claude-sonnet-4-6__aaaaaaaa__2026-07-26T14-32-10Z',
    model: 'claude-sonnet-4-6',
    promptHash: 'aaaaaaaa',
    temperature: 1,
    corpusVersion: 'deadbeef'.repeat(8),
    assemblyHash: '0bb41002',
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

    const report = renderCompareReport(side(manifestA), side(manifestB), []);

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

    const report = renderCompareReport(side(manifestA), side(manifestB), []);

    expect(report).toContain('Corpus versions differ between run A and run B');
    expect(report).toContain('aaaaaaaaaaaa'); // shortCorpusVersion(A)
    expect(report).toContain('bbbbbbbbbbbb'); // shortCorpusVersion(B)
  });

  it('warns when the two sides have different assemblyHash', () => {
    // promptHash is identical on both sides here on purpose: that is exactly
    // the case this warning exists for, since promptHash covers only the
    // prompt file and cannot see a tool or formatter change.
    const report = renderCompareReport(
      side(baseManifest({ assemblyHash: '0bb41002' })),
      side(baseManifest({ assemblyHash: 'ffffffff' })),
      [],
    );
    expect(report).toContain('Assembly hashes differ');
    expect(report).toContain('0bb41002');
    expect(report).toContain('ffffffff');
  });

  it('reports a missing assemblyHash as unknown rather than matching', () => {
    const { assemblyHash: _omitted, ...withoutHash } = baseManifest({});
    const report = renderCompareReport(
      side(withoutHash),
      side(baseManifest({ assemblyHash: '0bb41002' })),
      [],
    );
    expect(report).toContain('does not record');
    expect(report).not.toContain('Assembly hashes differ');
  });

  it('does not warn when both sides share the same corpusVersion', () => {
    const shared = 'cc'.repeat(32);
    const manifestA = baseManifest({ corpusVersion: shared });
    const manifestB = baseManifest({
      runId: 'claude-sonnet-4-6__bbbbbbbb__2026-07-27T09-00-00Z',
      corpusVersion: shared,
    });

    const report = renderCompareReport(side(manifestA), side(manifestB), []);

    expect(report).toContain('## Warnings\n\n(none)');
  });

  it('includes heterogeneity warnings from both sides', () => {
    const report = renderCompareReport(
      side(baseManifest(), {
        heterogeneityWarnings: [
          'run A spans multiple rubric hashes (aaaaaaaa, bbbbbbbb)',
        ],
      }),
      side(baseManifest({ runId: 'run-b' }), {
        heterogeneityWarnings: [
          'run B spans multiple harness versions (abc1111, abc2222)',
        ],
      }),
      [],
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
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
      pairs,
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
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
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
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
      pairs,
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
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
      pairs,
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
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
      pairs,
    );

    expect(report).toContain('## Improvements (1)');
    expect(report).toContain('## Applicability shifts (1)');
    expect(report.indexOf('## Applicability shifts')).toBeGreaterThan(
      report.indexOf('## Improvements'),
    );
  });

  it('names each side scoring source in its header', () => {
    const report = renderCompareReport(
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' }), {
        scoring: {
          kind: 'rescore',
          label: 're-score 2026-07-30T09-00-00Z',
          source: '/runs/b/rescore/2026-07-30T09-00-00Z.jsonl',
          harnessVersion: 'abc1234',
        },
      }),
      [],
    );

    expect(report).toContain(
      "- Scoring: the run's own scores (/runs/thisrun/reps/<nnn>/scores.jsonl)",
    );
    expect(report).toContain(
      '- Scoring: re-score 2026-07-30T09-00-00Z ' +
        '(/runs/b/rescore/2026-07-30T09-00-00Z.jsonl)',
    );
  });

  it('warns when the two sides were graded by different graders', () => {
    const report = renderCompareReport(
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' }), {
        scoring: {
          kind: 'rescore',
          label: 're-score 2026-07-30T09-00-00Z',
          source: '/runs/b/rescore/2026-07-30T09-00-00Z.jsonl',
        },
      }),
      [],
    );

    expect(report).toContain(
      "Run A is scored from the run's own scores and run B from " +
        're-score 2026-07-30T09-00-00Z',
    );
  });

  it('does not call carried-forward provenance a grader mismatch', () => {
    // The two frozen runs: both re-graded under 600cc73, differing only in
    // the harness their carried-forward rows retained. Reporting that as
    // "graded by different checker code" is what nearly got one side
    // re-scored under a harness predating every checker migration.
    const rescore = (label: string, carriedFrom: string) =>
      ({
        kind: 'rescore',
        label,
        source: `/runs/x/rescore/${label}.jsonl`,
        harnessVersion: '600cc73',
        carriedForward: 18,
        carriedForwardHarnessVersion: carriedFrom,
      }) as const;

    const report = renderCompareReport(
      side(baseManifest(), { scoring: rescore('pass-a', 'fa1d801') }),
      side(baseManifest({ runId: 'run-b' }), {
        scoring: rescore('pass-b', 'dfe5e4d'),
      }),
      [],
    );

    expect(report).toContain('## Warnings\n\n(none)');
    // The counts and their provenance still appear, just not as divergence.
    expect(report).toContain(
      '- Carried forward (no artifact to re-grade): 18 (verdicts retained from harness fa1d801)',
    );
    expect(report).toContain(
      '- Carried forward (no artifact to re-grade): 18 (verdicts retained from harness dfe5e4d)',
    );
  });

  it('bands low-N pairs beneath the ranked rows instead of ranking them', () => {
    // turn03's shape: 1/10 -> 0/7 is a -0.10 delta at p ~ 1.0, and it sorted
    // above a genuine regression built on ten reps a side.
    const pairs = orderForDisplay(
      comparePairs(
        [
          rate({ fixtureId: 'real-regression', pass: 9, fail: 1 }),
          rate({ fixtureId: 'thin', pass: 1, fail: 9 }),
        ],
        [
          rate({ fixtureId: 'real-regression', pass: 4, fail: 6 }),
          rate({ fixtureId: 'thin', pass: 0, fail: 3, notApplicable: 7 }),
        ],
      ),
    );

    const report = renderCompareReport(
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
      pairs,
    );

    // Both are regressions and the count covers both.
    expect(report).toContain('## Regressions (2)');
    expect(report).toContain(
      '**Low N (fewer than 5 decided reps on a side) — listed, not ranked (1)**',
    );
    // The thin pair is listed, never dropped...
    expect(report).toContain('| thin | check-a |');
    // ...but below the ranked one, despite its larger delta.
    expect(report.indexOf('| real-regression | check-a |')).toBeLessThan(
      report.indexOf('| thin | check-a |'),
    );
  });

  it('leaves Unchanged unbanded, having no ranking to qualify', () => {
    const pairs = orderForDisplay(
      comparePairs(
        [rate({ fixtureId: 'flat-thin', pass: 2, fail: 0 })],
        [rate({ fixtureId: 'flat-thin', pass: 2, fail: 0 })],
      ),
    );

    const report = renderCompareReport(
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
      pairs,
    );

    expect(report).toContain('## Unchanged (1)');
    expect(report).not.toContain('listed, not ranked');
  });

  it('warns when both sides are re-scores under different checker code', () => {
    const rescore = (label: string, harnessVersion: string) =>
      ({
        kind: 'rescore',
        label,
        source: `/runs/x/rescore/${label}.jsonl`,
        harnessVersion,
      }) as const;

    const report = renderCompareReport(
      side(baseManifest(), { scoring: rescore('pass-1', 'aaa1111') }),
      side(baseManifest({ runId: 'run-b' }), {
        scoring: rescore('pass-2', 'bbb2222'),
      }),
      [],
    );

    expect(report).toContain(
      "Run A's re-score ran under harness aaa1111 and run B's under bbb2222",
    );
  });

  it('does not warn when both sides used the same grading', () => {
    const report = renderCompareReport(
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
      [],
    );

    expect(report).toContain('## Warnings\n\n(none)');
  });

  it('warns when a check gates applicability differently on each side', () => {
    const pairs = comparePairs(
      [rate({ fixtureId: 'migrated', applicabilitySource: 'artifact' })],
      [rate({ fixtureId: 'migrated', applicabilitySource: 'fixture' })],
    );

    const report = renderCompareReport(
      side(baseManifest()),
      side(baseManifest({ runId: 'run-b' })),
      pairs,
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
