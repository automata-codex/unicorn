import { describe, expect, it } from 'vitest';

import { buildWorksheet, renderWorksheet } from './query-worksheet.core';

import type { EvalFixture } from '../eval/fixture.schema';
import type { HarvestedQuery, ScoredQuery } from './query-vocab.core';

function harvest(
  ...items: Array<[fixtureId: string, query: string, rep?: string]>
): HarvestedQuery[] {
  return items.map(([fixtureId, query, rep]) => ({
    fixtureId,
    query,
    rep: rep ?? '001',
  }));
}

function scored(
  ...items: Array<[query: string, absent: string[]]>
): ScoredQuery[] {
  return items.map(([query, absentTerms]) => ({
    query,
    absentTerms,
    absentWords: absentTerms,
    occurrences: 1,
  }));
}

function fixture(id: string, content: string): EvalFixture {
  return {
    id,
    tag: 'OUT-OF-ORDER-RESOLUTION',
    sourceAdventureId: '00000000-0000-0000-0000-000000000099',
    sourceSequenceNumber: 1,
    fixtureSchemaVersion: 2,
    seededState: {
      campaignState: {},
      gmContextBlob: {},
      pendingCanon: [],
      messages: [],
      pendingDiceRequests: [],
      capturedAt: '2026-07-15T00:00:00.000Z',
    },
    playerInput: { type: 'message', content },
    assertion: { mode: 'structural', check: 'test' },
  } as EvalFixture;
}

describe('buildWorksheet', () => {
  it('groups queries by turn and attaches the situation', () => {
    const turns = buildWorksheet({
      harvested: harvest(
        ['turn19-x', 'cover bonus'],
        ['turn19-x', 'rifle damage'],
        ['turn21-y', 'panic table'],
      ),
      scored: scored(
        ['cover bonus', []],
        ['rifle damage', []],
        ['panic table', []],
      ),
      fixtures: [
        fixture('turn19-x', 'I shoot from behind the racks.'),
        fixture('turn21-y', 'I keep my nerve.'),
      ],
    });

    expect(turns.map((t) => t.fixtureId)).toEqual(['turn19-x', 'turn21-y']);
    expect(turns[0].playerInput).toBe('I shoot from behind the racks.');
    expect(turns[0].rows).toHaveLength(2);
  });

  it('collapses a query repeated across reps into one row with a count', () => {
    // The same phrasing on every rep is one thing to judge, not ten — but how
    // often the model reached for it is the informative part.
    const turns = buildWorksheet({
      harvested: harvest(
        ['turn19-x', 'cover bonus', '001'],
        ['turn19-x', 'cover bonus', '002'],
        ['turn19-x', 'cover bonus', '003'],
        ['turn19-x', 'rifle damage', '001'],
      ),
      scored: scored(['cover bonus', []], ['rifle damage', []]),
      fixtures: [fixture('turn19-x', 'I shoot.')],
    });

    expect(turns[0].rows).toHaveLength(2);
    expect(turns[0].rows[0]).toMatchObject({
      query: 'cover bonus',
      occurrences: 3,
    });
  });

  it('orders rows most-issued first', () => {
    const turns = buildWorksheet({
      harvested: harvest(
        ['turn19-x', 'rare'],
        ['turn19-x', 'common'],
        ['turn19-x', 'common'],
      ),
      scored: scored(['rare', []], ['common', []]),
      fixtures: [fixture('turn19-x', 'I shoot.')],
    });

    expect(turns[0].rows.map((r) => r.query)).toEqual(['common', 'rare']);
  });

  it('keeps a turn whose fixture file is missing, with no context', () => {
    // The queries were really emitted. Dropping them because the corpus moved
    // on would quietly shrink the denominator, which is the failure the
    // applicability discipline exists to prevent everywhere else.
    const turns = buildWorksheet({
      harvested: harvest(['turn99-gone', 'some query']),
      scored: scored(['some query', []]),
      fixtures: [],
    });

    expect(turns).toHaveLength(1);
    expect(turns[0].playerInput).toBeUndefined();
    expect(turns[0].rows).toHaveLength(1);
  });

  it('gives every row a stable id scoped to its turn', () => {
    // Labels are joined back on this for Task 8's judge validation set, so it
    // must not be "position in a markdown table."
    const turns = buildWorksheet({
      harvested: harvest(['turn19-x', 'a'], ['turn19-x', 'b']),
      scored: scored(['a', []], ['b', []]),
      fixtures: [fixture('turn19-x', 'I shoot.')],
    });

    expect(turns[0].rows.map((r) => r.rowId)).toEqual([
      'turn19-x/01',
      'turn19-x/02',
    ]);
  });

  it('carries absent terms through as a hint, defaulting to none', () => {
    const turns = buildWorksheet({
      harvested: harvest(
        ['turn19-x', 'flanking rules'],
        ['turn19-x', 'unscored'],
      ),
      scored: scored(['flanking rules', ['flank']]),
      fixtures: [fixture('turn19-x', 'I shoot.')],
    });

    const byQuery = Object.fromEntries(
      turns[0].rows.map((r) => [r.query, r.absentTerms]),
    );
    expect(byQuery['flanking rules']).toEqual(['flank']);
    expect(byQuery.unscored).toEqual([]);
  });
});

describe('renderWorksheet', () => {
  const base = {
    model: 'claude-sonnet-5',
    promptHash: '97feadbd',
    runDir: '/runs/x',
    generatedAt: '2026-08-07T00:00:00.000Z',
  };

  it('renders the situation once per turn, not per query', () => {
    const turns = buildWorksheet({
      harvested: harvest(
        ['turn19-x', 'a'],
        ['turn19-x', 'b'],
        ['turn19-x', 'c'],
      ),
      scored: scored(['a', []], ['b', []], ['c', []]),
      fixtures: [fixture('turn19-x', 'I shoot from behind the racks.')],
    });

    const out = renderWorksheet({ ...base, turns });

    expect(out.split('I shoot from behind the racks.').length - 1).toBe(1);
  });

  it('escapes pipes so a query cannot break its own table row', () => {
    const turns = buildWorksheet({
      harvested: harvest(['turn19-x', 'damage | armor']),
      scored: scored(['damage | armor', []]),
      fixtures: [fixture('turn19-x', 'I shoot.')],
    });

    const row = renderWorksheet({ ...base, turns })
      .split('\n')
      .find((l) => l.includes('damage'));
    expect(row).toContain('damage \\| armor');
    // 6 columns → 7 pipes; an unescaped one would make 8 and shift W/E.
    expect((row?.match(/(?<!\\)\|/g) ?? []).length).toBe(7);
  });

  it('says so explicitly when a turn has no situation', () => {
    const turns = buildWorksheet({
      harvested: harvest(['turn99-gone', 'q']),
      scored: scored(['q', []]),
      fixtures: [],
    });

    expect(renderWorksheet({ ...base, turns })).toContain(
      'No fixture file matched this turn',
    );
  });

  it('names the model and prompt hash in the header', () => {
    // The worksheet is one half of a paired before/after comparison; one
    // mislabelled with the wrong prompt hash would pair against itself.
    const out = renderWorksheet({ ...base, turns: [] });

    expect(out).toContain('claude-sonnet-5');
    expect(out).toContain('97feadbd');
  });
});
