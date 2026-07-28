import { describe, expect, it } from 'vitest';

import {
  applyFilters,
  comparePairs,
  detectHeterogeneity,
  orderForDisplay,
} from './compare';

import type { RateEntry } from './rates';
import type { ScoreRow } from './scores';

function rate(overrides: Partial<RateEntry> = {}): RateEntry {
  const pass = overrides.pass ?? 5;
  const fail = overrides.fail ?? 5;
  return {
    fixtureId: 'fixture-a',
    checkId: 'check-a',
    tag: 'OUT-OF-ORDER-RESOLUTION',
    checkMode: 'structural',
    pass,
    fail,
    notApplicable: 0,
    error: 0,
    n: pass + fail,
    rate: pass + fail === 0 ? null : pass / (pass + fail),
    ...overrides,
  };
}

function scoreRow(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    runId: 'run-1',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1.0,
    corpusVersion: 'abc',
    harnessVersion: 'abc1234',
    repIndex: 1,
    fixtureId: 'turn24-hidden-info-leak',
    checkId: 'hidden-info-leak',
    tag: 'HIDDEN-INFO-LEAK',
    checkMode: 'judged',
    verdict: 'pass',
    artifactPath: 'reps/001/turn24-hidden-info-leak/judge-hidden-info-leak.json',
    durationMs: 1,
    recordedAt: '2026-07-26T14:33:00.000Z',
    ...overrides,
  };
}

describe('comparePairs', () => {
  it('reports a straightforward improvement', () => {
    const [pair] = comparePairs(
      [rate({ pass: 5, fail: 5 })],
      [rate({ pass: 8, fail: 2 })],
    );
    expect(pair.status).toBe('paired');
    expect(pair.rateA).toBe(0.5);
    expect(pair.rateB).toBe(0.8);
    expect(pair.delta).toBeCloseTo(0.3);
  });

  it('reports a straightforward regression', () => {
    const [pair] = comparePairs(
      [rate({ pass: 8, fail: 2 })],
      [rate({ pass: 5, fail: 5 })],
    );
    expect(pair.status).toBe('paired');
    expect(pair.delta).toBeCloseTo(-0.3);
  });

  it('reports differing N per side honestly', () => {
    const [pair] = comparePairs(
      [rate({ pass: 8, fail: 2 })],
      [rate({ pass: 2, fail: 2 })],
    );
    expect(pair.nA).toBe(10);
    expect(pair.nB).toBe(4);
  });

  it('marks a fixture present on only one side as a-only / b-only', () => {
    const aOnly = comparePairs(
      [rate({ fixtureId: 'only-a' })],
      [],
    );
    expect(aOnly[0].status).toBe('a-only');
    expect(aOnly[0].rateB).toBeNull();
    expect(aOnly[0].delta).toBeNull();

    const bOnly = comparePairs(
      [],
      [rate({ fixtureId: 'only-b' })],
    );
    expect(bOnly[0].status).toBe('b-only');
    expect(bOnly[0].rateA).toBeNull();
    expect(bOnly[0].delta).toBeNull();
  });

  it('does not compute a delta when one side is not_applicable (n=0)', () => {
    const [pair] = comparePairs(
      [rate({ pass: 0, fail: 0, notApplicable: 5 })],
      [rate({ pass: 7, fail: 3 })],
    );
    expect(pair.status).toBe('not-applicable-one-side');
    expect(pair.rateA).toBeNull();
    expect(pair.rateB).toBe(0.7);
    expect(pair.delta).toBeNull();
  });
});

describe('orderForDisplay — the motivating mixed case', () => {
  it('surfaces two regressing fixtures at the top even though the aggregate rises', () => {
    const ratesA: RateEntry[] = [
      rate({ fixtureId: 'regresses-hard', pass: 9, fail: 1 }),
      rate({ fixtureId: 'regresses-some', pass: 9, fail: 1 }),
      rate({ fixtureId: 'improves-a', pass: 1, fail: 9 }),
      rate({ fixtureId: 'improves-b', pass: 1, fail: 9 }),
      rate({ fixtureId: 'flat', pass: 5, fail: 5 }),
    ];
    const ratesB: RateEntry[] = [
      rate({ fixtureId: 'regresses-hard', pass: 5, fail: 5 }),
      rate({ fixtureId: 'regresses-some', pass: 6, fail: 4 }),
      rate({ fixtureId: 'improves-a', pass: 9, fail: 1 }),
      rate({ fixtureId: 'improves-b', pass: 9, fail: 1 }),
      rate({ fixtureId: 'flat', pass: 5, fail: 5 }),
    ];

    // Sanity: the naive aggregate (sum of pass / sum of n) does rise.
    const sumRate = (rates: RateEntry[]) =>
      rates.reduce((s, r) => s + r.pass, 0) /
      rates.reduce((s, r) => s + r.n, 0);
    expect(sumRate(ratesB)).toBeGreaterThan(sumRate(ratesA));

    const ordered = orderForDisplay(comparePairs(ratesA, ratesB));

    expect(ordered[0].fixtureId).toBe('regresses-hard');
    expect(ordered[0].delta).toBeCloseTo(-0.4);
    expect(ordered[1].fixtureId).toBe('regresses-some');
    expect(ordered[1].delta).toBeCloseTo(-0.3);
    // Both regressions land before any improvement.
    const firstImprovementIndex = ordered.findIndex((p) => (p.delta ?? 0) > 0);
    expect(firstImprovementIndex).toBeGreaterThan(1);
  });
});

describe('orderForDisplay', () => {
  it('orders regressions (worst first), then improvements (biggest first), then unchanged, then unpaired', () => {
    const ratesA: RateEntry[] = [
      rate({ fixtureId: 'small-improve', pass: 5, fail: 5 }),
      rate({ fixtureId: 'big-regress', pass: 9, fail: 1 }),
      rate({ fixtureId: 'small-regress', pass: 6, fail: 4 }),
      rate({ fixtureId: 'flat', pass: 5, fail: 5 }),
    ];
    const ratesB: RateEntry[] = [
      rate({ fixtureId: 'small-improve', pass: 7, fail: 3 }),
      rate({ fixtureId: 'big-regress', pass: 1, fail: 9 }),
      rate({ fixtureId: 'small-regress', pass: 5, fail: 5 }),
      rate({ fixtureId: 'flat', pass: 5, fail: 5 }),
      rate({ fixtureId: 'b-only-fixture' }),
    ];

    const ordered = orderForDisplay(comparePairs(ratesA, ratesB));
    expect(ordered.map((p) => p.fixtureId)).toEqual([
      'big-regress',
      'small-regress',
      'small-improve',
      'flat',
      'b-only-fixture',
    ]);
  });
});

describe('detectHeterogeneity', () => {
  it('warns and prints a runnable filter when rows span two rubric hashes', () => {
    const rows = [
      scoreRow({ rubricHash: 'aaaaaaaa' }),
      scoreRow({ rubricHash: 'bbbbbbbb' }),
    ];

    const info = detectHeterogeneity(rows, 'run A');
    expect(info.rubricHashes).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    expect(info.warnings).toHaveLength(1);
    expect(info.warnings[0]).toContain('run A');
    expect(info.warnings[0]).toMatch(/--filter-rubric aaaaaaaa/);
  });

  it('applying the printed filter yields a consistent subset', () => {
    const rows = [
      scoreRow({ rubricHash: 'aaaaaaaa' }),
      scoreRow({ rubricHash: 'bbbbbbbb' }),
    ];
    const filtered = applyFilters(rows, { rubricHash: 'aaaaaaaa' });
    const info = detectHeterogeneity(filtered, 'run A');
    expect(info.rubricHashes).toEqual(['aaaaaaaa']);
    expect(info.warnings).toEqual([]);
  });

  it('warns when rows span two harness versions', () => {
    const rows = [
      scoreRow({ harnessVersion: 'abc1111' }),
      scoreRow({ harnessVersion: 'abc2222' }),
    ];
    const info = detectHeterogeneity(rows, 'run B');
    expect(info.harnessVersions).toEqual(['abc1111', 'abc2222']);
    expect(info.warnings[0]).toMatch(/--filter-harness abc1111/);
  });

  it('is silent when a side is already consistent', () => {
    const rows = [scoreRow({ rubricHash: 'aaaaaaaa' }), scoreRow({ rubricHash: 'aaaaaaaa' })];
    const info = detectHeterogeneity(rows, 'run A');
    expect(info.warnings).toEqual([]);
  });
});

describe('applyFilters', () => {
  it('never excludes structural rows (no rubricHash) when --filter-rubric is set', () => {
    const rows = [
      scoreRow({ checkMode: 'structural', rubricHash: undefined }),
      scoreRow({ checkMode: 'judged', rubricHash: 'aaaaaaaa' }),
      scoreRow({ checkMode: 'judged', rubricHash: 'bbbbbbbb' }),
    ];
    const filtered = applyFilters(rows, { rubricHash: 'aaaaaaaa' });
    expect(filtered).toHaveLength(2);
    expect(filtered.some((r) => r.checkMode === 'structural')).toBe(true);
    expect(filtered.every((r) => r.rubricHash !== 'bbbbbbbb')).toBe(true);
  });

  it('filters every row by harnessVersion when --filter-harness is set', () => {
    const rows = [
      scoreRow({ harnessVersion: 'abc1111' }),
      scoreRow({ harnessVersion: 'abc2222' }),
    ];
    const filtered = applyFilters(rows, { harnessVersion: 'abc1111' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].harnessVersion).toBe('abc1111');
  });
});
