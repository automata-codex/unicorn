import { describe, expect, it } from 'vitest';

import { CASES } from './cases';
import { parseFixture } from './fixture';
import { parseArgs, renderCaseMd, renderMarksCsv } from './run.core';

describe('parseArgs', () => {
  it('defaults to every case of the question', () => {
    expect(parseArgs(['--question', 'q1', '--reps', '10'])).toEqual({
      question: 'q1',
      reps: 10,
      fixtureIds: [...CASES.q1],
    });
  });

  it('narrows to the named fixtures', () => {
    const args = parseArgs([
      '--question',
      'q1',
      '--reps',
      '1',
      '--fixtures',
      CASES.q1[0],
    ]);
    expect(args.fixtureIds).toEqual([CASES.q1[0]]);
  });

  it('rejects a fixture that is not a case of the question', () => {
    expect(() =>
      parseArgs(['--question', 'q1', '--reps', '1', '--fixtures', 'nope']),
    ).toThrow(/not a case of q1: nope/);
  });

  it('rejects an unknown question', () => {
    expect(() => parseArgs(['--question', 'q9', '--reps', '1'])).toThrow(
      /--question must be one of/,
    );
  });

  it.each(['0', '-1', '2.5', 'ten', ''])('rejects --reps %j', (reps) => {
    expect(() => parseArgs(['--question', 'q1', '--reps', reps])).toThrow(
      /--reps/,
    );
  });

  it('rejects a missing --reps and an unknown flag', () => {
    expect(() => parseArgs(['--question', 'q1'])).toThrow(/--reps/);
    expect(() => parseArgs(['--model', 'x'])).toThrow(/unknown argument/);
  });
});

describe('renderCaseMd', () => {
  const fixture = parseFixture(
    {
      id: 'a-fixture',
      playerInput: { type: 'message', content: 'line one\nline two' },
      seededState: {
        campaignState: {
          worldFacts: { ship_layout: 'three decks', crew: { count: 4 } },
        },
        gmContextBlob: {
          playerEntityIds: ['danny'],
          openingNarration: 'Dark.',
        },
        messages: [],
        pendingCanon: [],
        pendingDiceRequests: [],
      },
    },
    'a-fixture',
  );

  it('puts the player input, world facts and opening narration together', () => {
    const md = renderCaseMd(fixture);
    expect(md).toContain('> line one\n> line two');
    expect(md).toContain('### ship_layout\n\nthree decks');
    expect(md).toContain('"count": 4');
    expect(md).toContain('## Opening narration\n\nDark.');
  });

  it('says so when a fixture has no world facts or opening narration', () => {
    const bare = parseFixture(
      {
        ...fixture,
        seededState: {
          ...fixture.seededState,
          campaignState: {},
          gmContextBlob: { playerEntityIds: ['danny'] },
        },
      },
      'a-fixture',
    );
    const md = renderCaseMd(bare);
    expect(md).toContain('## World facts\n\n_none_');
    expect(md).toContain('_none recorded_');
  });
});

describe('renderMarksCsv', () => {
  it('writes one row per rep, blank unless the turn threw', () => {
    expect(
      renderMarksCsv([
        { fixtureId: 'a', rep: 1, mark: '' },
        { fixtureId: 'a', rep: 2, mark: 'error' },
      ]),
    ).toBe('fixture,rep,mark,note\na,01,,\na,02,error,\n');
  });
});
