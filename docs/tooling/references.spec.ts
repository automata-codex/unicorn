import { describe, expect, it } from 'vitest';

import {
  buildTitleIndex,
  classifyReference,
  extractReferenceText,
  findPrecedingPath,
  findReferences,
  normalize,
  rewriteResolved,
} from './references.core';

const titles = buildTitleIndex([
  {
    id: 'ADR-0031',
    title: 'Entity and resource pool identifiers use underscores only',
  },
  {
    id: 'ADR-0028',
    title: 'State placement is decided by the lifetime of the referent',
  },
  {
    id: 'ADR-0044',
    title:
      'Rules retrieval mechanism: dense embeddings over FTS or LLM-authored regex',
  },
  {
    id: 'ADR-0052',
    title: '`actingEntityId` must resolve against a declared identifier set',
  },
]);

describe('normalize', () => {
  it('treats a newline as whitespace so wrapped references still match', () => {
    expect(normalize('Entity and resource\n  pool identifiers')).toBe(
      'entity and resource pool identifiers',
    );
  });

  it('strips blockquote markers from a reference that wraps inside a quote', () => {
    expect(normalize('Rules\n> ingestion pipeline and retrieval quality')).toBe(
      'rules ingestion pipeline and retrieval quality',
    );
  });

  it('strips backticks so a code-formatted title matches a plain one', () => {
    expect(normalize('`actingEntityId` must resolve')).toBe(
      'actingentityid must resolve',
    );
  });
});

describe('classifyReference', () => {
  it('classifies a numeric citation as out of scope', () => {
    for (const ref of ['24.1', 'S8.3', 'Part 4', 'Step 2', 'S4.5']) {
      expect(classifyReference(ref, titles, null).classification).toBe(
        'out-of-scope',
      );
    }
  });

  it('resolves an exact title match', () => {
    const verdict = classifyReference(
      'Entity and resource pool identifiers use underscores only',
      titles,
      'docs/decisions.md',
    );
    expect(verdict.classification).toBe('resolves');
    expect(verdict.id).toBe('ADR-0031');
  });

  it('resolves a title carrying its original backticks', () => {
    const verdict = classifyReference(
      '`actingEntityId` must resolve against a declared identifier set',
      titles,
      null,
    );
    expect(verdict.classification).toBe('resolves');
    expect(verdict.id).toBe('ADR-0052');
  });

  it('flags an author-truncated title as ambiguous rather than resolving it', () => {
    const verdict = classifyReference(
      'Rules retrieval mechanism',
      titles,
      null,
    );
    expect(verdict.classification).toBe('ambiguous');
    expect(verdict.candidates).toEqual(['ADR-0044']);
  });

  it('flags an explicitly elided title as ambiguous', () => {
    const verdict = classifyReference(
      'Entity and resource pool identifiers...',
      titles,
      null,
    );
    expect(verdict.classification).toBe('ambiguous');
  });

  it('treats a section reference into another document as out of scope', () => {
    const verdict = classifyReference(
      'Licensing Posture',
      titles,
      'docs/zoltar-design-doc.md',
    );
    expect(verdict.classification).toBe('out-of-scope');
  });

  it('reports an unmatched decisions reference as unresolved', () => {
    const verdict = classifyReference(
      'A decision that was renamed out from under this citation',
      titles,
      'docs/decisions.md',
    );
    expect(verdict.classification).toBe('unresolved');
  });
});

describe('extractReferenceText', () => {
  it('runs to the closing backtick of the enclosing code span', () => {
    const text =
      'see `docs/decisions.md § State placement is decided by the lifetime of the referent` for why';
    const index = text.indexOf('§');
    expect(extractReferenceText(text, index)).toBe(
      'State placement is decided by the lifetime of the referent',
    );
  });

  it('keeps a backtick pair that belongs to the title', () => {
    const text =
      'see `docs/decisions.md § `actingEntityId` must resolve against a declared identifier set` above';
    const index = text.indexOf('§');
    expect(extractReferenceText(text, index)).toContain('actingEntityId');
  });

  it('spans a newline when the reference wraps', () => {
    const text =
      'applied: `docs/decisions.md § Entity and resource\npool identifiers use underscores only`.';
    const index = text.indexOf('§');
    expect(normalize(extractReferenceText(text, index))).toBe(
      'entity and resource pool identifiers use underscores only',
    );
  });
});

describe('findPrecedingPath', () => {
  it('finds a path immediately before the marker', () => {
    const text = 'see `docs/decisions.md § Something`';
    expect(findPrecedingPath(text, text.indexOf('§'))?.path).toBe(
      'docs/decisions.md',
    );
  });

  it('ignores a path separated by prose from the marker', () => {
    const text = 'docs/schema.md is the schema. Later, § Something else';
    expect(findPrecedingPath(text, text.indexOf('§'))).toBeNull();
  });
});

describe('rewriteResolved', () => {
  it('collapses the whole construct including the path', () => {
    const text =
      'the underscore rule (`docs/decisions.md § Entity and resource pool identifiers use underscores only`) applies';
    const out = rewriteResolved(text, findReferences(text, titles));
    expect(out).toBe('the underscore rule (`ADR-0031`) applies');
  });

  it('substitutes in place where the sentence grammar depends on the title', () => {
    const text =
      '`docs/decisions.md § State placement is decided by the lifetime of the referent` states the rule';
    const out = rewriteResolved(text, findReferences(text, titles));
    expect(out).toBe('`ADR-0028` states the rule');
  });

  it('collapses a wrapped reference onto one line', () => {
    const text =
      'applied: `docs/decisions.md § Entity and resource\npool identifiers use underscores only`.';
    const out = rewriteResolved(text, findReferences(text, titles));
    expect(out).toBe('applied: `ADR-0031`.');
  });

  it('leaves ambiguous and unresolved references untouched', () => {
    const text = 'see `docs/decisions.md § Rules retrieval mechanism`, above';
    expect(rewriteResolved(text, findReferences(text, titles))).toBe(text);
  });

  it('leaves numeric citations untouched', () => {
    const text = 'measured in `docs/rules-extraction-findings.md § S18.4`';
    expect(rewriteResolved(text, findReferences(text, titles))).toBe(text);
  });

  it('rewrites several references in one pass without corrupting offsets', () => {
    const text =
      'first `docs/decisions.md § Entity and resource pool identifiers use underscores only` then `docs/decisions.md § State placement is decided by the lifetime of the referent` done';
    const out = rewriteResolved(text, findReferences(text, titles));
    expect(out).toBe('first `ADR-0031` then `ADR-0028` done');
  });
});

describe('code-span detection', () => {
  it('does not treat a reference inside a fenced block as a code span', () => {
    // schema.md puts a decisions reference inside a ```sql fence, 21 fences
    // deep. Counting backticks from the start of the file made every later
    // reference look like it was inside a code span, so the extractor ran
    // past the closing paren and swallowed the rest of the SQL comment.
    const text = [
      '```sql',
      "  source text NOT NULL,  -- e.g. 'p.34'",
      '  section_path text[] NOT NULL, -- (see docs/decisions.md § Rules retrieval mechanism: dense embeddings over FTS or LLM-authored regex); stored for provenance',
      '```',
    ].join('\n');
    const index = text.indexOf('§');
    expect(extractReferenceText(text, index)).toBe(
      'Rules retrieval mechanism: dense embeddings over FTS or LLM-authored regex',
    );
  });

  it('scopes backtick parity to the paragraph, not the whole file', () => {
    const text = [
      'An earlier paragraph with an unbalanced ` backtick.',
      '',
      'Later: `docs/decisions.md § State placement is decided by the lifetime of the referent` applies.',
    ].join('\n');
    const index = text.indexOf('§');
    expect(extractReferenceText(text, index)).toBe(
      'State placement is decided by the lifetime of the referent',
    );
  });
});

describe('intra-document section references', () => {
  it('treats a bare reference to the document own heading as out of scope', () => {
    const verdict = classifyReference(
      'Two kinds of corpus bump',
      titles,
      null,
      ['Two kinds of corpus bump', 'Some other section'],
    );
    expect(verdict.classification).toBe('out-of-scope');
  });

  it('still resolves a decisions title that is not an own heading', () => {
    const verdict = classifyReference(
      'State placement is decided by the lifetime of the referent',
      titles,
      null,
      ['Unrelated heading'],
    );
    expect(verdict.classification).toBe('resolves');
  });
});
