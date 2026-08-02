import { describe, expect, it } from 'vitest';

import {
  applyFilters,
  comparePairs,
  describeFilterImpact,
  detectHeterogeneity,
  orderForDisplay,
  parseRubricFilters,
} from './compare';

import type { RateEntry } from './rates';
import type { ScoreRow } from './scores';

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
    artifactPath:
      'reps/001/turn24-hidden-info-leak/judge-hidden-info-leak.json',
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
    const aOnly = comparePairs([rate({ fixtureId: 'only-a' })], []);
    expect(aOnly[0].status).toBe('a-only');
    expect(aOnly[0].rateB).toBeNull();
    expect(aOnly[0].delta).toBeNull();

    const bOnly = comparePairs([], [rate({ fixtureId: 'only-b' })]);
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
  it('does not warn when a run spans two checks with one rubric hash each', () => {
    // The normal case: one rubric template per judged check, so a run
    // covering several judged checks spans several hashes by design.
    const rows = [
      scoreRow({
        checkId: 'hidden-info-leak',
        tag: 'HIDDEN-INFO-LEAK',
        rubricHash: 'aaaaaaaa',
      }),
      scoreRow({
        checkId: 'over-resolution',
        tag: 'OVER-RESOLUTION',
        rubricHash: 'bbbbbbbb',
      }),
    ];

    const info = detectHeterogeneity(rows, 'run A');
    expect(info.mixedRubricChecks).toEqual([]);
    expect(info.warnings).toEqual([]);
  });

  it('warns and prints a runnable filter naming only the drifting check', () => {
    const rows = [
      // hidden-info-leak drifted mid-run.
      scoreRow({
        checkId: 'hidden-info-leak',
        tag: 'HIDDEN-INFO-LEAK',
        rubricHash: 'aaaaaaaa',
      }),
      scoreRow({
        checkId: 'hidden-info-leak',
        tag: 'HIDDEN-INFO-LEAK',
        rubricHash: 'bbbbbbbb',
      }),
      // over-resolution is clean and must not be named.
      scoreRow({
        checkId: 'over-resolution',
        tag: 'OVER-RESOLUTION',
        rubricHash: 'cccccccc',
      }),
    ];

    const info = detectHeterogeneity(rows, 'run A');
    expect(info.mixedRubricChecks).toEqual([
      {
        checkId: 'hidden-info-leak',
        tag: 'HIDDEN-INFO-LEAK',
        hashes: ['aaaaaaaa', 'bbbbbbbb'],
      },
    ]);
    expect(info.warnings).toHaveLength(1);
    expect(info.warnings[0]).toContain('run A');
    expect(info.warnings[0]).toContain('hidden-info-leak');
    expect(info.warnings[0]).not.toContain('over-resolution');
    expect(info.warnings[0]).toMatch(
      /--filter-rubric hidden-info-leak=aaaaaaaa/,
    );
  });

  it('applying the printed filter yields a consistent subset without touching other checks', () => {
    const rows = [
      scoreRow({
        checkId: 'hidden-info-leak',
        tag: 'HIDDEN-INFO-LEAK',
        rubricHash: 'aaaaaaaa',
      }),
      scoreRow({
        checkId: 'hidden-info-leak',
        tag: 'HIDDEN-INFO-LEAK',
        rubricHash: 'bbbbbbbb',
      }),
      scoreRow({
        checkId: 'over-resolution',
        tag: 'OVER-RESOLUTION',
        rubricHash: 'cccccccc',
      }),
    ];
    const filtered = applyFilters(rows, {
      rubricHashByCheckId: { 'hidden-info-leak': 'aaaaaaaa' },
    });
    const info = detectHeterogeneity(filtered, 'run A');
    expect(info.mixedRubricChecks).toEqual([]);
    expect(info.warnings).toEqual([]);
    expect(filtered.some((r) => r.checkId === 'over-resolution')).toBe(true);
    expect(
      filtered.filter((r) => r.checkId === 'hidden-info-leak'),
    ).toHaveLength(1);
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
    const rows = [
      scoreRow({ rubricHash: 'aaaaaaaa' }),
      scoreRow({ rubricHash: 'aaaaaaaa' }),
    ];
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
    const filtered = applyFilters(rows, {
      rubricHashByCheckId: { [rows[1].checkId]: 'aaaaaaaa' },
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.some((r) => r.checkMode === 'structural')).toBe(true);
    expect(filtered.every((r) => r.rubricHash !== 'bbbbbbbb')).toBe(true);
  });

  it('leaves other checks untouched when --filter-rubric targets one check', () => {
    const rows = [
      scoreRow({ checkId: 'hidden-info-leak', rubricHash: 'aaaaaaaa' }),
      scoreRow({ checkId: 'hidden-info-leak', rubricHash: 'bbbbbbbb' }),
      scoreRow({ checkId: 'over-resolution', rubricHash: 'cccccccc' }),
    ];
    const filtered = applyFilters(rows, {
      rubricHashByCheckId: { 'hidden-info-leak': 'aaaaaaaa' },
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.some((r) => r.checkId === 'over-resolution')).toBe(true);
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

describe('parseRubricFilters', () => {
  it('parses a single CHECK=HASH value', () => {
    expect(parseRubricFilters(['hidden-info-leak=4cf7fda1'])).toEqual({
      'hidden-info-leak': '4cf7fda1',
    });
  });

  it('parses repeated values into one map', () => {
    expect(
      parseRubricFilters(['hidden-info-leak=4cf7fda1', 'scene-jump=ba1cff52']),
    ).toEqual({
      'hidden-info-leak': '4cf7fda1',
      'scene-jump': 'ba1cff52',
    });
  });

  it('throws on the legacy bare-hash form', () => {
    expect(() => parseRubricFilters(['4cf7fda1'])).toThrow(/CHECK=HASH/);
  });

  it('throws when the same check is named twice', () => {
    expect(() =>
      parseRubricFilters([
        'hidden-info-leak=4cf7fda1',
        'hidden-info-leak=deadbeef',
      ]),
    ).toThrow(/more than once/);
  });
});

describe('describeFilterImpact', () => {
  it('reports a fixture whose denominator a filter zeroed out', () => {
    const before = [
      scoreRow({
        fixtureId: 'turn24-hidden-info-leak',
        checkId: 'hidden-info-leak',
        rubricHash: 'deadbeef',
        verdict: 'pass',
      }),
    ];
    const after = applyFilters(before, {
      rubricHashByCheckId: { 'hidden-info-leak': 'ffffffff' },
    });
    const messages = describeFilterImpact(before, after, {
      'hidden-info-leak': 'ffffffff',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('turn24-hidden-info-leak');
    expect(messages[0]).toContain('hidden-info-leak');
  });

  it('is silent when the filter costs nothing', () => {
    const before = [
      scoreRow({
        fixtureId: 'turn24-hidden-info-leak',
        checkId: 'hidden-info-leak',
        rubricHash: 'aaaaaaaa',
        verdict: 'pass',
      }),
    ];
    const after = applyFilters(before, {
      rubricHashByCheckId: { 'hidden-info-leak': 'aaaaaaaa' },
    });
    expect(
      describeFilterImpact(before, after, { 'hidden-info-leak': 'aaaaaaaa' }),
    ).toEqual([]);
  });

  it('reports a filter key naming a check with no rows in the run', () => {
    const before = [scoreRow({ checkId: 'hidden-info-leak' })];
    const after = before;
    const messages = describeFilterImpact(before, after, {
      'nonexistent-check': 'aaaaaaaa',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('nonexistent-check');
  });
});
