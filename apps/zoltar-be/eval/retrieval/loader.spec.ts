import { describe, expect, it } from 'vitest';

import { retrievalFixtureSchema } from './fixture.schema';
import { FixtureLoadError, parseFixtureLines } from './loader';

const VALID = {
  id: 'rq-001',
  system: 'mothership',
  query: 'what happens when a character panics',
  queryStyle: 'authored',
  expectedPages: [21],
  answerable: true,
};

function jsonl(...objects: object[]): string {
  return `${objects.map((o) => JSON.stringify(o)).join('\n')}\n`;
}

describe('retrievalFixtureSchema', () => {
  it('accepts a labeled answerable fixture', () => {
    expect(retrievalFixtureSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts an unanswerable fixture with no expected pages', () => {
    const result = retrievalFixtureSchema.safeParse({
      ...VALID,
      answerable: false,
      expectedPages: [],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unedited stub', () => {
    // What `sample-retrieval-fixtures.ts` emits. Failing closed here is the
    // whole safety property: an unlabeled fixture that scored as answerable
    // would depress recall and read as an index problem.
    const result = retrievalFixtureSchema.safeParse({
      ...VALID,
      expectedPages: null,
      answerable: null,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an answerable fixture with no expected page', () => {
    const result = retrievalFixtureSchema.safeParse({
      ...VALID,
      expectedPages: [],
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('label it');
  });

  it('rejects an unanswerable fixture that carries expected pages', () => {
    const result = retrievalFixtureSchema.safeParse({
      ...VALID,
      answerable: false,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown query style', () => {
    // The per-style split is required by M7.5's bar; a typo'd style would
    // silently create a third group nobody set a target for.
    const result = retrievalFixtureSchema.safeParse({
      ...VALID,
      queryStyle: 'handwritten',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-positive or fractional page number', () => {
    expect(
      retrievalFixtureSchema.safeParse({ ...VALID, expectedPages: [0] })
        .success,
    ).toBe(false);
    expect(
      retrievalFixtureSchema.safeParse({ ...VALID, expectedPages: [21.5] })
        .success,
    ).toBe(false);
  });
});

describe('parseFixtureLines', () => {
  it('parses one fixture per line', () => {
    const fixtures = parseFixtureLines(
      jsonl(VALID, { ...VALID, id: 'rq-002' }),
      'test.jsonl',
    );

    expect(fixtures.map((f) => f.id)).toEqual(['rq-001', 'rq-002']);
  });

  it('skips blank lines and // comments', () => {
    const text = `// a header comment\n\n${JSON.stringify(VALID)}\n\n`;

    expect(parseFixtureLines(text, 'test.jsonl')).toHaveLength(1);
  });

  it('names the line number on malformed JSON', () => {
    expect(() =>
      parseFixtureLines(`${JSON.stringify(VALID)}\n{oops\n`, 'f.jsonl'),
    ).toThrow(/f\.jsonl:2/);
  });

  it('names the line number and the failing field on an invalid fixture', () => {
    const text = jsonl(VALID, { ...VALID, id: 'rq-002', expectedPages: [] });

    expect(() => parseFixtureLines(text, 'f.jsonl')).toThrow(/f\.jsonl:2/);
    expect(() => parseFixtureLines(text, 'f.jsonl')).toThrow(/expectedPages/);
  });

  it('rejects duplicate ids and points at both lines', () => {
    // A duplicate id would double-count one query in every rate and make the
    // per-fixture rows ambiguous to join on.
    const text = jsonl(VALID, VALID);

    expect(() => parseFixtureLines(text, 'f.jsonl')).toThrow(
      /reuses fixture id "rq-001", first seen on line 1/,
    );
  });

  it('throws FixtureLoadError, not a bare Error', () => {
    expect(() => parseFixtureLines('{oops\n', 'f.jsonl')).toThrow(
      FixtureLoadError,
    );
  });
});
