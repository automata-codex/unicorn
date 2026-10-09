import { describe, expect, it } from 'vitest';

import {
  compare,
  compareCase,
  fisherOneSided,
  isTestFile,
  parseArgs,
  poolSide,
  renderComparison,
} from './compare';
import { tally } from './report';

import type { LoadedRun, Side } from './compare';
import type { CaseTally, Mark, MarkedRow } from './report';

function rows(fixtureId: string, pass: number, fail: number): MarkedRow[] {
  const marks: Mark[] = [
    ...Array<Mark>(pass).fill('pass'),
    ...Array<Mark>(fail).fill('fail'),
  ];
  return marks.map((mark, i) => ({
    fixtureId,
    rep: String(i + 1).padStart(2, '0'),
    mark,
    note: '',
  }));
}

function caseTally(pass: number, fail: number): CaseTally {
  // One `na` rep, so a case with nothing judged still has a tally.
  const na: MarkedRow = { fixtureId: 'a', rep: '00', mark: 'na', note: '' };
  return tally([na, ...rows('a', pass, fail)])[0];
}

function run(overrides: {
  runId?: string;
  question?: string;
  commit?: string;
  dirty?: boolean;
  hash?: string;
  rubric?: string | null;
  rows?: MarkedRow[];
}): LoadedRun {
  return {
    info: {
      runId: overrides.runId ?? '2026-10-10T14-02-11Z',
      question: overrides.question ?? 'q1',
      commit: overrides.commit ?? 'd83812d0000000000000000000000000000000000',
      dirty: overrides.dirty ?? false,
      prompt: {
        filename: 'mothership-m7.txt',
        hash: overrides.hash ?? 'e83e8aaa',
      },
    },
    rubric: overrides.rubric === undefined ? 'v1' : overrides.rubric,
    rows: overrides.rows ?? rows('a', 4, 5),
  };
}

function side(name: Side['name'], ...runs: LoadedRun[]): Side {
  return poolSide(name, runs);
}

describe('parseArgs', () => {
  it('takes one run a side', () => {
    expect(parseArgs(['x', 'y'])).toEqual({ before: ['x'], after: ['y'] });
  });

  it('takes a comma-separated pool on either side', () => {
    expect(parseArgs(['x,x2', 'y, y2'])).toEqual({
      before: ['x', 'x2'],
      after: ['y', 'y2'],
    });
  });

  it('refuses anything but two arguments', () => {
    expect(() => parseArgs(['x'])).toThrow(/Usage/);
    expect(() => parseArgs(['x', 'y', 'z'])).toThrow(/Usage/);
    expect(() => parseArgs(['x', ','])).toThrow(/Usage/);
  });
});

describe('fisherOneSided', () => {
  // The four rows of spec 027's table, and the two it quotes for 10 a side.
  it.each([
    [4, 5, 9, 1, 0.0495],
    [2, 6, 8, 2, 0.0306],
    [4, 3, 9, 1, 0.1618],
    [8, 2, 10, 0, 0.2368],
    [4, 6, 9, 1, 0.0286],
    [5, 5, 9, 1, 0.0704],
  ])('%i/%i pass/fail against %i/%i', (lp, lf, hp, hf, expected) => {
    expect(
      fisherOneSided({ pass: lp, fail: lf }, { pass: hp, fail: hf }),
    ).toBeCloseTo(expected, 4);
  });

  it('is 1 when a side has no judged rep', () => {
    expect(fisherOneSided({ pass: 0, fail: 0 }, { pass: 9, fail: 1 })).toBe(1);
    expect(fisherOneSided({ pass: 4, fail: 5 }, { pass: 0, fail: 0 })).toBe(1);
  });

  it('is 1 when every rep passed on both sides', () => {
    expect(fisherOneSided({ pass: 10, fail: 0 }, { pass: 10, fail: 0 })).toBe(
      1,
    );
  });
});

describe('compareCase', () => {
  it('labels a gain at the boundary improved', () => {
    const result = compareCase(caseTally(4, 5), caseTally(9, 1));
    expect(result.label).toBe('improved');
    expect(result.chance).toBeCloseTo(0.0495, 4);
  });

  it('does not label a gain just past the boundary', () => {
    expect(compareCase(caseTally(5, 5), caseTally(9, 1)).label).toBe(
      'not shown',
    );
  });

  it('labels the same splits worse in the other direction', () => {
    expect(compareCase(caseTally(9, 1), caseTally(4, 5)).label).toBe('worse');
    expect(compareCase(caseTally(9, 1), caseTally(5, 5)).label).toBe(
      'not shown',
    );
  });

  it('has no chance to report for equal rates or a side with no rate', () => {
    expect(compareCase(caseTally(4, 4), caseTally(5, 5))).toMatchObject({
      label: 'not shown',
      chance: null,
    });
    expect(compareCase(caseTally(0, 0), caseTally(9, 1))).toMatchObject({
      label: 'not shown',
      chance: null,
    });
  });
});

describe('poolSide', () => {
  it('adds the reps of a top-up run to the run it tops up', () => {
    const pooled = side(
      'after',
      run({ runId: 'first', rows: rows('a', 6, 4) }),
      run({ runId: 'top-up', rows: rows('a', 18, 2), dirty: true }),
    );
    expect(pooled.runIds).toEqual(['first', 'top-up']);
    expect(pooled.dirty).toBe(true);
    expect(tally(pooled.rows)[0]).toMatchObject({ pass: 24, fail: 6 });
  });

  it('refuses a run with no rubric version, naming it', () => {
    expect(() => side('before', run({ runId: 'old', rubric: null }))).toThrow(
      /before: run old records no rubric version/,
    );
  });

  it.each([
    ['commit', { commit: 'ffffffff' }],
    ['prompt hash', { hash: '7c20f3d1' }],
    ['rubric version', { rubric: 'v2' }],
    ['question', { question: 'q2' }],
  ])('refuses a pool that mixes a %s', (what, other) => {
    expect(() => side('after', run({}), run(other))).toThrow(
      new RegExp(`after: pooled runs must share a ${what}`),
    );
  });
});

describe('compare', () => {
  it('refuses runs of different questions', () => {
    expect(() =>
      compare(side('before', run({})), side('after', run({ question: 'q2' }))),
    ).toThrow(/different questions: q1 and q2/);
  });

  it('refuses runs marked under different rubrics', () => {
    expect(() =>
      compare(side('before', run({})), side('after', run({ rubric: 'v2' }))),
    ).toThrow(/different rubrics: v1 and v2/);
  });

  it('refuses runs with no case in common', () => {
    expect(() =>
      compare(
        side('before', run({ rows: rows('a', 1, 1) })),
        side('after', run({ rows: rows('b', 1, 1) })),
      ),
    ).toThrow(/no case in common/);
  });

  it('compares the shared cases and names the rest', () => {
    const result = compare(
      side('before', run({ rows: [...rows('a', 4, 5), ...rows('b', 1, 1)] })),
      side('after', run({ rows: [...rows('c', 1, 1), ...rows('a', 9, 1)] })),
    );
    expect(result.cases.map((c) => [c.fixtureId, c.label])).toEqual([
      ['a', 'improved'],
    ]);
    expect(result.onlyBefore).toEqual(['b']);
    expect(result.onlyAfter).toEqual(['c']);
  });
});

describe('isTestFile', () => {
  it('picks out unit and integration tests', () => {
    expect(isTestFile('apps/zoltar-be/eval-v2/replay.spec-int.ts')).toBe(true);
    expect(isTestFile('apps/zoltar-be/src/a/b.spec.ts')).toBe(true);
    expect(isTestFile('packages/rules-engine/src/dice.test.ts')).toBe(true);
    expect(isTestFile('apps/zoltar-be/test/db-test-helper.ts')).toBe(true);
  });

  it('leaves code and fixtures in', () => {
    expect(isTestFile('apps/zoltar-be/eval-v2/replay.ts')).toBe(false);
    expect(isTestFile('apps/zoltar-be/eval/fixtures/x.json')).toBe(false);
  });
});

describe('renderComparison', () => {
  const before = side(
    'before',
    run({ rows: [...rows('turn14', 4, 5), ...rows('turn01', 1, 1)] }),
  );
  const after = side(
    'after',
    run({
      runId: '2026-10-10T16-40-37Z',
      commit: '4be19a00000000000000000000000000000000000',
      dirty: true,
      hash: '7c20f3d1',
      rows: rows('turn14', 9, 1),
    }),
  );
  const comparison = compare(before, after);

  it('prints the differences, then the cases', () => {
    const out = renderComparison(
      before,
      after,
      ['apps/zoltar-be/src/wardens/prompts/mothership-m7.txt'],
      comparison,
    );
    expect(out).toBe(
      [
        'before  2026-10-10T14-02-11Z  d83812d        mothership-m7.txt e83e8aaa  rubric v1',
        'after   2026-10-10T16-40-37Z  4be19a0 dirty  mothership-m7.txt 7c20f3d1  rubric v1',
        '',
        'Prompt changed: mothership-m7.txt e83e8aaa → mothership-m7.txt 7c20f3d1',
        'Run from a dirty tree: after',
        'Files changed between d83812d and 4be19a0:',
        '  apps/zoltar-be/src/wardens/prompts/mothership-m7.txt',
        'Only in before: turn01',
        '',
        'case    before     after       bar (after)  change',
        'turn14  4/9  0.44  9/10  0.90  met          improved (0.05)',
      ].join('\n'),
    );
  });

  it('says why when a commit is not in the repository', () => {
    const out = renderComparison(
      before,
      after,
      { missingCommit: after.commit },
      comparison,
    );
    expect(out).toContain(
      'File list left out: commit 4be19a0 is not in this repository.',
    );
    expect(out).not.toContain('Files changed');
  });

  it('says so when both sides are one commit, or nothing but tests moved', () => {
    const same = side('after', run({ rows: rows('turn14', 9, 1) }));
    expect(renderComparison(before, same, [], compare(before, same))).toContain(
      'Same commit: d83812d',
    );
    expect(renderComparison(before, after, [], comparison)).toContain(
      'No files changed between d83812d and 4be19a0, tests aside.',
    );
  });

  it('prints a case with no judged rep without a rate or a chance', () => {
    const empty = side('after', run({ rows: [] }));
    empty.rows = [{ fixtureId: 'turn14', rep: '01', mark: 'na', note: '' }];
    const out = renderComparison(before, empty, [], compare(before, empty));
    expect(out).toMatch(
      /turn14 {2}4\/9 {2}0\.44 {2}0\/0 {2}— +NOT +not shown$/,
    );
  });
});
