import { describe, expect, it } from 'vitest';

import {
  buildWorksheet,
  clusterNearDuplicates,
  normalizeTokens,
  overwriteRefusal,
  renderWorksheet,
} from './query-worksheet.core';

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
    // 8 columns → 9 pipes; an unescaped one would make 10 and shift C/N/E.
    expect((row?.match(/(?<!\\)\|/g) ?? []).length).toBe(9);
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

describe('normalizeTokens', () => {
  it('drops function words and the system name, which cannot discriminate', () => {
    // "mothership" appears as a bare qualifier in a large share of queries.
    expect(normalizeTokens('what is the cover bonus in Mothership')).toEqual(
      new Set(['cover', 'bonus']),
    );
  });

  it('strips a plural s but protects singulars ending in one', () => {
    // `rolls` must collapse to `roll`; `stress` must not become `stres`, and
    // `bonus` must not become `bonu` -- it is among the most frequent words
    // in this corpus and would stop matching `bonuses`.
    expect(normalizeTokens('rolls stress saves bonus checks')).toEqual(
      new Set(['roll', 'stress', 'save', 'bonus', 'check']),
    );
  });
});

describe('clusterNearDuplicates', () => {
  it('groups two phrasings of the same question', () => {
    // The real pair from the corpus's worst turn; scores exactly 0.5.
    const families = clusterNearDuplicates([
      'using cover in combat, attack roll modifiers for cover',
      'cover bonus to armor or attack rolls in combat',
    ]);

    expect(families.size).toBe(2);
    expect(new Set(families.values()).size).toBe(1);
  });

  it('leaves a genuinely different question out of the family', () => {
    const families = clusterNearDuplicates([
      'cover bonus to armor or attack rolls in combat',
      'firearms combat attack roll damage weapon rifle',
    ]);

    expect(families.size).toBe(0);
  });

  it('omits singletons, because a family of one is not a finding', () => {
    expect(clusterNearDuplicates(['panic check trigger']).size).toBe(0);
  });

  it('compares against a fixed representative rather than chaining', () => {
    // Single-linkage would merge A and C through B even when A and C are far
    // apart, silently fusing two different questions.
    const a = 'cover bonus attack roll';
    const b = 'cover bonus attack roll damage weapon rifle shotgun';
    const c = 'damage weapon rifle shotgun ammunition';
    const families = clusterNearDuplicates([a, b, c]);

    expect(families.get(a)).not.toBe(families.get(c));
  });
});

describe('retry detection', () => {
  it('separates one rep asking six ways from six reps asking once', () => {
    // Rows are deduplicated across reps, so family size cannot tell these
    // apart -- and only the first is the cascade the prompt forbids.
    const cascade = buildWorksheet({
      harvested: [
        { fixtureId: 't', query: 'cover bonus attack roll', rep: '001' },
        { fixtureId: 't', query: 'cover bonus to attack rolls', rep: '001' },
        { fixtureId: 't', query: 'cover bonus on attack roll', rep: '001' },
      ],
      scored: [],
      fixtures: [],
    });
    const sampling = buildWorksheet({
      harvested: [
        { fixtureId: 't', query: 'cover bonus attack roll', rep: '001' },
        { fixtureId: 't', query: 'cover bonus to attack rolls', rep: '002' },
        { fixtureId: 't', query: 'cover bonus on attack roll', rep: '003' },
      ],
      scored: [],
      fixtures: [],
    });

    expect(cascade[0].rows).toHaveLength(3);
    expect(sampling[0].rows).toHaveLength(3);
    expect(cascade[0].maxSameFamilyInOneRep).toBe(3);
    expect(sampling[0].maxSameFamilyInOneRep).toBe(1);
  });
});

describe('overwriteRefusal', () => {
  const path = '/runs/worksheet.md';

  it('permits writing when the file does not exist', () => {
    expect(overwriteRefusal({ path, exists: false, force: false })).toBeNull();
  });

  it('refuses when the file exists, because scoring is not regenerable', () => {
    // The hazard this exists for: the before-set worksheet was regenerated
    // three times in one session while scoring was in progress. Every other
    // --output in scripts/ writes a derived report that costs nothing to
    // rebuild; this one holds human judgment that exists nowhere else.
    const refusal = overwriteRefusal({ path, exists: true, force: false });

    expect(refusal).not.toBeNull();
    expect(refusal).toContain(path);
    expect(refusal).toMatch(/--force/);
  });

  it('permits writing when --force is given', () => {
    expect(overwriteRefusal({ path, exists: true, force: true })).toBeNull();
  });

  it('offers a different --output before it offers --force', () => {
    // Overwriting is the destructive way out and should not be the first
    // thing a hurried reader sees.
    const refusal =
      overwriteRefusal({ path, exists: true, force: false }) ?? '';

    expect(refusal.indexOf('--output')).toBeLessThan(
      refusal.indexOf('--force'),
    );
  });
});
