import { describe, expect, it } from 'vitest';

import { renderJudgeCsv } from './judge.core';
import {
  check,
  JUDGE_PASS_LIMIT,
  parseArgs,
  parseJudgeFile,
  pickJudgeFile,
  renderCheck,
} from './judge-check';

import type { RunMarks } from './judge-check';
import type { Mark, MarkedRow } from './report';

const TURN_14 = '2c0ba938-turn14-seeded-canon-contradiction';
const TURN_18 = '2c0ba938-turn18-seeded-canon-contradiction';
const TURN_01 = '2c0ba938-turn01-seeded-canon-contradiction';

/** `count` rows of one case, numbered from `from`. */
function rows(
  fixtureId: string,
  mark: Mark,
  count: number,
  from = 1,
): MarkedRow[] {
  return Array.from({ length: count }, (_, i) => ({
    fixtureId,
    rep: String(from + i).padStart(2, '0'),
    mark,
    note: mark === 'fail' ? 'wrong deck' : '',
  }));
}

function run(hand: MarkedRow[], judge: MarkedRow[]): RunMarks {
  return { runId: 'run-a', hand, judge };
}

describe('parseArgs', () => {
  it('takes runs separated by commas or spaces', () => {
    expect(parseArgs(['a,b', 'c']).runs).toEqual(['a', 'b', 'c']);
  });

  it('takes a prompt hash', () => {
    expect(parseArgs(['a', '--prompt', '3fa1c2d0']).prompt).toBe('3fa1c2d0');
  });

  it.each([
    [[]],
    [['a', '--prompt']],
    [['a', '--force']],
  ])('rejects %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow(/Usage/);
  });
});

describe('parseJudgeFile', () => {
  it('reads back what the judge writes, commas and all', () => {
    const file = parseJudgeFile(
      renderJudgeCsv(
        { question: 'q1', rubric: 'v1', prompt: '3fa1c2d0', model: 'm' },
        [
          {
            fixtureId: 'a',
            rep: '01',
            mark: 'fail',
            note: 'deck 3, not deck 2',
          },
        ],
      ),
    );
    expect(file.identity).toBe('q1 rubric v1 · prompt 3fa1c2d0 · m');
    expect(file.rows).toEqual([
      { fixtureId: 'a', rep: '01', mark: 'fail', note: 'deck 3, not deck 2' },
    ]);
  });

  it('refuses a file with no judge line', () => {
    expect(() => parseJudgeFile('fixture,rep,mark,note\na,01,pass,\n')).toThrow(
      /must start with a "# judge:" line/,
    );
  });
});

describe('pickJudgeFile', () => {
  const names = ['marks.csv', 'run.json', 'marks.2026-10-04.csv'];

  it('takes the only judge file', () => {
    expect(pickJudgeFile([...names, 'judge.3fa1c2d0.csv'], null)).toBe(
      'judge.3fa1c2d0.csv',
    );
  });

  it('refuses a run that was never judged', () => {
    expect(() => pickJudgeFile(names, null)).toThrow(/no judge file/);
  });

  it('refuses to choose between two, and says so', () => {
    const two = [...names, 'judge.3fa1c2d0.csv', 'judge.9b0e11aa.csv'];
    expect(() => pickJudgeFile(two, null)).toThrow(/judged 2 times/);
    expect(pickJudgeFile(two, '9b0e11aa')).toBe('judge.9b0e11aa.csv');
  });

  it('refuses a prompt hash the run was not judged with', () => {
    expect(() => pickJudgeFile(['judge.3fa1c2d0.csv'], 'ffffffff')).toThrow(
      /no judge.ffffffff.csv/,
    );
  });
});

describe('check', () => {
  it('counts each kind of disagreement apart', () => {
    const result = check([
      run(
        [...rows(TURN_14, 'pass', 4), ...rows(TURN_14, 'fail', 4, 5)],
        [
          ...rows(TURN_14, 'pass', 2),
          ...rows(TURN_14, 'fail', 1, 3),
          ...rows(TURN_14, 'na', 1, 4),
          ...rows(TURN_14, 'pass', 1, 5),
          ...rows(TURN_14, 'fail', 3, 6),
        ],
      ),
    ]);
    expect(result.total).toEqual({
      marks: 8,
      agree: 5,
      judgePassHandFail: 1,
      judgeFailHandPass: 1,
      judgeNa: 1,
    });
    expect(result.disagreements.map((d) => [d.rep, d.hand, d.judge])).toEqual([
      ['03', 'pass', 'fail'],
      ['04', 'pass', 'na'],
      ['05', 'fail', 'pass'],
    ]);
  });

  it('counts per case as well as overall', () => {
    const result = check([
      run(
        [...rows(TURN_14, 'pass', 2), ...rows(TURN_18, 'fail', 3)],
        [...rows(TURN_14, 'pass', 2), ...rows(TURN_18, 'pass', 3)],
      ),
    ]);
    expect(result.cases).toEqual([
      expect.objectContaining({ fixtureId: TURN_14, marks: 2, agree: 2 }),
      expect.objectContaining({
        fixtureId: TURN_18,
        marks: 3,
        agree: 0,
        judgePassHandFail: 3,
      }),
    ]);
  });

  it('leaves error rows and the timeline case out of every count', () => {
    const result = check([
      run(
        [
          ...rows(TURN_14, 'pass', 2),
          ...rows(TURN_14, 'error', 1, 3),
          ...rows(TURN_01, 'na', 10),
        ],
        rows(TURN_14, 'pass', 2),
      ),
    ]);
    expect(result.total.marks).toBe(2);
    expect(result.handNa.marks).toBe(0);
    expect(result.skipped).toEqual({ error: 1, noStart: 10, notJudged: 0 });
  });

  it('keeps hand na marks apart from the limits', () => {
    const result = check([
      run(
        [...rows(TURN_18, 'na', 2), ...rows(TURN_18, 'pass', 1, 3)],
        [
          ...rows(TURN_18, 'na', 1),
          ...rows(TURN_18, 'fail', 1, 2),
          ...rows(TURN_18, 'pass', 1, 3),
        ],
      ),
    ]);
    expect(result.handNa).toEqual({ marks: 2, judgeNa: 1 });
    expect(result.total).toMatchObject({ marks: 1, agree: 1 });
    expect(result.disagreements).toHaveLength(1);
  });

  it('counts a marked rep the judge did not mark, and leaves it out', () => {
    const result = check([
      run(rows(TURN_14, 'pass', 3), rows(TURN_14, 'pass', 2)),
    ]);
    expect(result.total.marks).toBe(2);
    expect(result.skipped.notJudged).toBe(1);
  });

  it('keeps two runs with the same rep numbers apart', () => {
    const result = check([
      {
        runId: 'run-a',
        hand: rows(TURN_14, 'pass', 1),
        judge: rows(TURN_14, 'pass', 1),
      },
      {
        runId: 'run-b',
        hand: rows(TURN_14, 'pass', 1),
        judge: rows(TURN_14, 'fail', 1),
      },
    ]);
    expect(result.total).toMatchObject({ marks: 2, agree: 1 });
    expect(result.disagreements[0].runId).toBe('run-b');
  });

  // The check is 114 marks: 38 pass and 76 fail.
  const of114 = (failsPassed: number, passesFailed: number) =>
    check([
      run(
        [...rows(TURN_14, 'pass', 38), ...rows(TURN_18, 'fail', 76)],
        [
          ...rows(TURN_14, 'fail', passesFailed),
          ...rows(TURN_14, 'pass', 38 - passesFailed, passesFailed + 1),
          ...rows(TURN_18, 'pass', failsPassed),
          ...rows(TURN_18, 'fail', 76 - failsPassed, failsPassed + 1),
        ],
      ),
    ]);

  it('meets the agreement limit at 11 disagreements and not at 12', () => {
    expect(of114(0, 11).meetsAgreement).toBe(true);
    expect(of114(0, 12).meetsAgreement).toBe(false);
  });

  it('meets the judge-pass limit at 4 and not at 5', () => {
    expect(JUDGE_PASS_LIMIT).toBe(4);
    expect(of114(4, 0).meetsJudgePass).toBe(true);
    expect(of114(5, 0)).toMatchObject({
      meetsJudgePass: false,
      meetsAgreement: true,
    });
  });

  it('meets neither limit with nothing to count', () => {
    const result = check([run([], [])]);
    expect(result.agreement).toBeNull();
    expect(result.meetsAgreement).toBe(false);
  });
});

describe('renderCheck', () => {
  it('prints both limits, the cases and each disagreement', () => {
    const text = renderCheck(
      'q1 rubric v1 · prompt 3fa1c2d0 · claude-opus-5-5',
      1,
      check([
        run(
          [...rows(TURN_14, 'pass', 9), ...rows(TURN_18, 'fail', 1)],
          [...rows(TURN_14, 'pass', 9), ...rows(TURN_18, 'pass', 1)],
        ),
      ]),
    );
    expect(text).toContain('judge  q1 rubric v1 · prompt 3fa1c2d0');
    expect(text).toMatch(/agreement\s+9 of 10\s+0\.90\s+limit 0\.90\s+met/);
    expect(text).toMatch(/judge pass, you fail\s+1\s+limit 4\s+met/);
    expect(text).toContain(`run-a  ${TURN_18}  01   you fail · judge pass`);
    expect(text).toContain('    judge: ');
  });

  it('says so when a limit is missed, and when nothing disagrees', () => {
    const missed = renderCheck(
      'j',
      1,
      check([run(rows(TURN_18, 'fail', 5), rows(TURN_18, 'pass', 5))]),
    );
    expect(missed).toMatch(
      /agreement\s+0 of 5\s+0\.00\s+limit 0\.90\s+NOT met/,
    );
    expect(missed).toMatch(/limit 4\s+NOT met/);

    const clean = renderCheck(
      'j',
      1,
      check([run(rows(TURN_14, 'pass', 2), rows(TURN_14, 'pass', 2))]),
    );
    expect(clean).toContain('No disagreements.');
  });
});
