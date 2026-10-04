import { describe, expect, it } from 'vitest';

import { parseMarks, renderReport, tally } from './report';
import { renderMarksCsv } from './run';

function csv(...rows: string[]): string {
  return ['fixture,rep,mark,note', ...rows, ''].join('\n');
}

describe('parseMarks', () => {
  it('reads marks, ignoring case and surrounding space', () => {
    const rows = parseMarks(csv('a,01,pass,', 'a,02, FAIL ,wrong deck'));
    expect(rows.map((r) => r.mark)).toEqual(['pass', 'fail']);
    expect(rows[1].note).toBe('wrong deck');
  });

  it('keeps commas inside a note', () => {
    const [row] = parseMarks(csv('a,01,fail,says deck 3, layout says deck 2'));
    expect(row.note).toBe('says deck 3, layout says deck 2');
  });

  it('tolerates Windows line endings', () => {
    expect(parseMarks(csv('a,01,pass,').replace(/\n/g, '\r\n'))).toHaveLength(
      1,
    );
  });

  it('refuses a file with unmarked rows, saying how many', () => {
    expect(() => parseMarks(csv('a,01,pass,', 'a,02,,', 'a,03,,'))).toThrow(
      /2 row\(s\) are not marked/,
    );
  });

  it('refuses an unknown mark, naming the row', () => {
    expect(() => parseMarks(csv('a,01,pass,', 'a,02,maybe,'))).toThrow(
      /row 3 \(a rep 02\): unknown mark "maybe"/,
    );
  });

  it('refuses a file without the header', () => {
    expect(() => parseMarks('a,01,pass,\n')).toThrow(/header/);
  });

  it('refuses what ev2:run writes until it has been marked', () => {
    const fresh = renderMarksCsv([{ fixtureId: 'a', rep: 1, mark: '' }]);
    expect(() => parseMarks(fresh)).toThrow(/not marked/);
  });
});

describe('tally', () => {
  it('leaves na and error out of the rate', () => {
    const rows = parseMarks(
      csv(
        ...Array.from({ length: 9 }, (_, i) => `a,0${i + 1},pass,`),
        'a,10,fail,',
        'a,11,na,',
        'a,12,error,',
      ),
    );
    expect(tally(rows)).toEqual([
      {
        fixtureId: 'a',
        pass: 9,
        fail: 1,
        na: 1,
        error: 1,
        rate: 0.9,
        meetsBar: true,
      },
    ]);
  });

  it('is below the bar at 8 of 10', () => {
    const rows = parseMarks(
      csv(
        ...Array.from({ length: 8 }, (_, i) => `a,0${i + 1},pass,`),
        'a,09,fail,',
        'a,10,fail,',
      ),
    );
    expect(tally(rows)[0]).toMatchObject({ rate: 0.8, meetsBar: false });
  });

  it('gives a case with no checkable rep no rate, and not the bar', () => {
    const [t] = tally(parseMarks(csv('a,01,na,', 'a,02,error,')));
    expect(t).toMatchObject({ rate: null, meetsBar: false });
  });

  it('keeps cases separate and in file order', () => {
    const tallies = tally(parseMarks(csv('b,01,pass,', 'a,01,fail,')));
    expect(tallies.map((t) => t.fixtureId)).toEqual(['b', 'a']);
  });
});

describe('renderReport', () => {
  it('names the cases below the bar', () => {
    const out = renderReport(
      tally(parseMarks(csv('good,01,pass,', 'bad,01,fail,', 'none,01,na,'))),
    );
    expect(out).toContain('Below the 0.90 bar: bad, none');
    expect(out).toMatch(/good\s+1\s+0\s+0\s+0\s+1\.00\s+met/);
    expect(out).toMatch(/none\s+0\s+0\s+1\s+0\s+—\s+NOT/);
  });

  it('says so when every case meets it', () => {
    expect(renderReport(tally(parseMarks(csv('a,01,pass,'))))).toContain(
      'Every case meets the 0.90 bar.',
    );
  });
});
