import { describe, expect, it } from 'vitest';

import { computeMetrics, scoreQueries } from './query-vocab.core';

import type { HarvestedQuery, TermFrequency } from './query-vocab.core';

/**
 * A stand-in for `RulesRepository.queryTermFrequencies` over a fixed corpus.
 *
 * The real one runs Postgres text search; what this file tests is everything
 * built on top of it — the absent-term rule, the distinct-vs-weighted
 * denominators, and the aggregation. The SQL itself is exercised by
 * `rules.repository.spec-int.ts`.
 */
/**
 * An explicit word -> lexeme map rather than a toy stemmer.
 *
 * A hand-rolled stemmer here fights the tests instead of serving them —
 * `stress` becomes `stres` and `saves` becomes `sav`, neither of which is the
 * point. Which lexemes are in the corpus is what these tests are about;
 * how a real stemmer derives them is Postgres's job and
 * `rules.repository.spec-int.ts`'s.
 */
const STEMS: Record<string, string> = {
  panic: 'panic',
  stress: 'stress',
  save: 'save',
  saves: 'save',
  armor: 'armor',
  combat: 'combat',
  wound: 'wound',
  flanking: 'flank',
  suppressive: 'suppress',
  opportunity: 'opportun',
  attacks: 'attack',
  rules: 'rule',
  fire: 'fire',
  bonus: 'bonus',
  in: 'in',
};

/** Lexemes the fake corpus contains. Everything else scores absent. */
const CORPUS = new Set([
  'panic',
  'stress',
  'save',
  'armor',
  'combat',
  'wound',
  'in',
]);

function fakeTermLookup(query: string): Promise<TermFrequency[]> {
  const words = query.toLowerCase().match(/[a-z]+/g) ?? [];
  return Promise.resolve(
    words.map((word) => {
      const lexeme = STEMS[word] ?? word;
      return {
        word,
        lexeme,
        documentFrequency: CORPUS.has(lexeme) ? 0.25 : 0,
      };
    }),
  );
}

function harvest(...queries: string[]): HarvestedQuery[] {
  return queries.map((query, index) => ({
    query,
    fixtureId: `turn0${index}`,
    rep: '001',
  }));
}

describe('scoreQueries', () => {
  it('reports a query whose every term is in the corpus as in-corpus', async () => {
    const { scored, metrics } = await scoreQueries(
      harvest('panic stress save'),
      fakeTermLookup,
    );

    expect(scored[0].absentTerms).toEqual([]);
    expect(metrics.outOfCorpusQueries).toBe(0);
    expect(metrics.outOfCorpusRate).toBe(0);
  });

  it('flags a query carrying a single absent term, and names it', async () => {
    const { scored, metrics } = await scoreQueries(
      harvest('flanking bonus in combat'),
      fakeTermLookup,
    );

    expect(scored[0].absentTerms).toContain('flank');
    expect(metrics.outOfCorpusRate).toBe(1);
  });

  it('counts a query once however many terms are absent', async () => {
    // The metric is "queries carrying at least one absent term", not a term
    // count — a single query stuffed with jargon must not outweigh five
    // ordinary ones.
    const { metrics } = await scoreQueries(
      harvest('flanking suppressive opportunity attacks'),
      fakeTermLookup,
    );

    expect(metrics.outOfCorpusQueries).toBe(1);
    expect(metrics.distinctQueries).toBe(1);
  });

  it('deduplicates repeated phrasings but still counts their occurrences', async () => {
    // The same query issued across reps resolves to the same terms. Scoring
    // it twice would let whichever query the model happened to repeat
    // dominate the rate, so the headline is over distinct queries and the
    // weighted rate is reported alongside.
    const { scored, metrics } = await scoreQueries(
      harvest('panic stress', 'panic stress', 'flanking rules'),
      fakeTermLookup,
    );

    expect(scored).toHaveLength(2);
    expect(metrics.distinctQueries).toBe(2);
    expect(metrics.totalLookups).toBe(3);
    expect(metrics.outOfCorpusRate).toBe(0.5);
    // One of three actual lookups was out of corpus.
    expect(metrics.weightedOutOfCorpusRate).toBeCloseTo(1 / 3);
  });

  it('aggregates absent terms across queries, most frequent first', async () => {
    const { metrics } = await scoreQueries(
      harvest('flanking combat', 'flanking armor', 'suppressive fire'),
      fakeTermLookup,
    );

    expect(metrics.absentTermCounts[0]).toMatchObject({
      term: 'flank',
      queries: 2,
    });
  });

  it('does not re-stem an already-stemmed lexeme (§ S9.1 regression)', async () => {
    // The bug that cost S8 three false absents, and it is silent: Postgres
    // stems `surpris` -> `surpri` and `oppos` -> `oppo` if you match with
    // to_tsquery('english', lexeme) on a lexeme ts_debug already stemmed, so
    // a term fails to match its own tsvector entry and reports as absent
    // from a book that prints it. Presence is decided by documentFrequency
    // alone — no second stemming pass anywhere in this module.
    const alreadyStemmed: TermFrequency[] = [
      { word: 'surprise', lexeme: 'surpris', documentFrequency: 0.1 },
      { word: 'opposed', lexeme: 'oppos', documentFrequency: 0.05 },
    ];

    const { scored, metrics } = await scoreQueries(
      harvest('surprise opposed'),
      () => Promise.resolve(alreadyStemmed),
    );

    expect(scored[0].absentTerms).toEqual([]);
    expect(metrics.outOfCorpusRate).toBe(0);
  });

  it('treats only a zero document frequency as absent, however rare the term', async () => {
    // A term on one chunk of 61 is present. There is no threshold here to
    // tune, and introducing one would silently reclassify real vocabulary as
    // missing.
    const { scored } = await scoreQueries(harvest('rare'), () =>
      Promise.resolve([
        { word: 'rare', lexeme: 'rare', documentFrequency: 1 / 61 },
      ]),
    );

    expect(scored[0].absentTerms).toEqual([]);
  });
});

describe('computeMetrics', () => {
  it('reports an undefined rate rather than zero for an empty set', () => {
    // A run that made no lookups has no rate. Rendering that as 0% would read
    // as a perfect score, which is the same "undefined is not zero"
    // discipline the retrieval scorer applies to recall.
    const metrics = computeMetrics([]);

    expect(metrics.outOfCorpusRate).toBeNull();
    expect(metrics.weightedOutOfCorpusRate).toBeNull();
    expect(metrics.distinctQueries).toBe(0);
  });
});
