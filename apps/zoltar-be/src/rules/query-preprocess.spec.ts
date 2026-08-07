import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DF_THRESHOLD,
  MIN_SURVIVING_WORDS,
  preprocessQuery,
  type QueryTerm,
} from './query-preprocess';

/**
 * Builds the term list a real `ts_debug` + frequency query would produce, in
 * query order. Frequencies are stated per word so each test reads as the
 * corpus shape it is asserting about.
 */
function terms(
  ...spec: Array<[word: string, documentFrequency: number]>
): QueryTerm[] {
  return spec.map(([word, documentFrequency], index) => ({
    position: index + 1,
    word,
    lexeme: word.toLowerCase().replace(/(ing|s)$/, ''),
    documentFrequency,
  }));
}

describe('preprocessQuery', () => {
  it('drops high-frequency words and keeps the distinctive ones', () => {
    // Shape of the real failure: `check`, `roll`, and `make` are boilerplate
    // in a rules book; `panic` and `stress` identify the section.
    const result = preprocessQuery(
      'make a check roll for panic stress',
      terms(
        ['make', 0.72],
        ['check', 0.61],
        ['roll', 0.55],
        ['panic', 0.06],
        ['stress', 0.12],
      ),
      { threshold: 0.4 },
    );

    expect(result.applied).toBe(true);
    expect(result.query).toBe('panic stress');
    expect(result.dropped).toEqual(['make', 'check', 'roll']);
  });

  it('stops at the floor rather than trimming to a single word', () => {
    // Same corpus shape, but only one word clears the ceiling. Trimming to
    // `panic` alone would throw away the query's only other signal, so the
    // floor pulls the least-frequent dropped word back in.
    const result = preprocessQuery(
      'make a check roll for panic',
      terms(['make', 0.72], ['check', 0.61], ['roll', 0.55], ['panic', 0.06]),
      { threshold: 0.4 },
    );

    expect(result.query).toBe('roll panic');
    expect(result.skipReason).toBe('below-floor');
  });

  it('embeds the original words, not their lexemes', () => {
    // The lexeme decides survival; the word is what Voyage sees. A bag of
    // stems is not natural language, and is not what any measured
    // improvement came from.
    const result = preprocessQuery('noticing environmental details', [
      {
        position: 1,
        word: 'noticing',
        lexeme: 'notic',
        documentFrequency: 0.9,
      },
      {
        position: 2,
        word: 'environmental',
        lexeme: 'environ',
        documentFrequency: 0.05,
      },
      {
        position: 3,
        word: 'details',
        lexeme: 'detail',
        documentFrequency: 0.08,
      },
    ]);

    expect(result.query).toBe('environmental details');
    // The stem-joined form is what must never reach Voyage.
    expect(result.query).not.toBe('environ detail');
  });

  it('preserves the original word order rather than frequency order', () => {
    const result = preprocessQuery(
      'stress panic trauma',
      terms(['stress', 0.05], ['panic', 0.02], ['trauma', 0.9]),
      { threshold: 0.4 },
    );

    expect(result.query).toBe('stress panic');
  });

  it('passes the query through untouched when nothing clears the ceiling', () => {
    const original = 'cryopod hypersleep sickness';
    const result = preprocessQuery(
      original,
      terms(['cryopod', 0.02], ['hypersleep', 0.03], ['sickness', 0.05]),
    );

    expect(result.applied).toBe(false);
    expect(result.query).toBe(original);
    expect(result.dropped).toEqual([]);
    expect(result.skipReason).toBe('nothing-above-threshold');
  });

  it('keeps the least-frequent words when every word is high-frequency', () => {
    // The safety floor. A query trimmed to an empty string is worse than one
    // that skipped preprocessing entirely.
    const result = preprocessQuery(
      'the character makes a check',
      terms(['character', 0.95], ['makes', 0.88], ['check', 0.61]),
      { threshold: 0.4 },
    );

    expect(result.query).not.toBe('');
    expect(result.query.split(' ')).toHaveLength(MIN_SURVIVING_WORDS);
    // Least frequent of the three survive, in original order.
    expect(result.query).toBe('makes check');
    expect(result.skipReason).toBe('below-floor');
  });

  it('never trims below the floor even at a punishing threshold', () => {
    const result = preprocessQuery(
      'a b c d',
      terms(['a', 0.99], ['b', 0.98], ['c', 0.97], ['d', 0.96]),
      { threshold: 0 },
    );

    expect(result.query.split(' ').length).toBeGreaterThanOrEqual(
      MIN_SURVIVING_WORDS,
    );
  });

  it('keeps a query that is already shorter than the floor', () => {
    const result = preprocessQuery('panic', terms(['panic', 0.99]));

    expect(result.query).toBe('panic');
  });

  it('leaves the query alone when the corpus reports no indexable terms', () => {
    // What an empty index produces: `queryTermFrequencies` returns rows with
    // frequency 0, but a corpus with no chunks at all yields no usable
    // signal. Also the all-stopword case.
    const result = preprocessQuery('what is it', []);

    expect(result.applied).toBe(false);
    expect(result.query).toBe('what is it');
    expect(result.skipReason).toBe('no-indexable-terms');
  });

  it('treats an empty index as nothing to drop', () => {
    // Every frequency is 0 against an empty corpus, so nothing exceeds the
    // ceiling and the raw query is embedded — the M7 behaviour, unchanged.
    const result = preprocessQuery(
      'panic check roll',
      terms(['panic', 0], ['check', 0], ['roll', 0]),
    );

    expect(result.applied).toBe(false);
    expect(result.query).toBe('panic check roll');
  });

  it('honours a caller-supplied threshold', () => {
    const input = terms(['alpha', 0.3], ['beta', 0.5]);

    expect(
      preprocessQuery('alpha beta', input, { threshold: 0.6 }).applied,
    ).toBe(false);
    expect(
      preprocessQuery('alpha beta', input, { threshold: 0.4, minWords: 1 })
        .query,
    ).toBe('alpha');
  });

  it('treats the threshold as inclusive at the boundary', () => {
    const result = preprocessQuery(
      'alpha beta',
      terms(['alpha', DEFAULT_DF_THRESHOLD], ['beta', 0.99]),
      { minWords: 1 },
    );

    expect(result.query).toBe('alpha');
    expect(result.dropped).toEqual(['beta']);
  });

  it('leaves the measured Mothership frequency band untouched by default', () => {
    // The shipped default is deliberately above every frequency observed on
    // the real corpus, because a sweep found each active setting costs recall
    // (`docs/rules-extraction-findings.md § S15.3`). If someone lowers the
    // constant without new evidence, this test is what should stop them.
    const measured = terms(
      ['check', 0.47],
      ['makes', 0.56],
      ['saves', 0.58],
      ['roll', 0.61],
      ['character', 0.64],
      ['panic', 0.24],
    );

    const result = preprocessQuery(
      'character makes a saves roll check panic',
      measured,
    );

    expect(DEFAULT_DF_THRESHOLD).toBeGreaterThan(0.64);
    expect(result.applied).toBe(false);
    expect(result.dropped).toEqual([]);
  });

  it('breaks frequency ties by position so output is deterministic', () => {
    const result = preprocessQuery(
      'alpha beta gamma',
      terms(['alpha', 0.9], ['beta', 0.9], ['gamma', 0.9]),
      { minWords: 2 },
    );

    expect(result.query).toBe('alpha beta');
  });
});
