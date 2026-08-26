import { describe, expect, it } from 'vitest';

import {
  adrFilename,
  frontMatterSchema,
  numberToId,
  parseAdrFile,
  serializeAdrFile,
  slugify,
  splitDecisionsLog,
} from './adr.core';
import { renderIndex } from './render-index';

import type { FrontMatter } from './adr.core';
import type { LoadedAdr } from './corpus';

// Annotated rather than inferred: without it `area` and `status` widen to
// `string`, and every use that feeds an `AdrFile` fails to typecheck. The
// annotation also checks the fixture against the real schema type, which is
// what a fixture for these round-trip tests should be doing anyway.
const validFrontMatter: FrontMatter = {
  id: 'ADR-0042',
  title: 'A rate that never moves is a harness suspect, not a finding',
  area: 'eval-harness',
  status: 'accepted',
  superseded_by: null,
  milestone: 'unknown',
  summary: null,
};

describe('slugify', () => {
  it('strips backticks and asterisks rather than hyphenating them', () => {
    expect(slugify('`session` renamed to `adventure`')).toBe(
      'session-renamed-to-adventure',
    );
  });

  it('collapses a colon and its surrounding space to one hyphen', () => {
    expect(slugify('ORM: Drizzle over TypeORM')).toBe(
      'orm-drizzle-over-typeorm',
    );
  });

  it('truncates long titles without leaving a trailing hyphen', () => {
    const slug = slugify(
      'OPEN — the undecided discipline has never been extended to judged checks, and `turn24-over-resolution` is the case that shows it should be',
    );
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('open-the-undecided-discipline')).toBe(true);
  });

  it('does not leave a leading hyphen for a backtick-initial title', () => {
    expect(
      slugify('`diceRequests` IDs assigned by the backend, not Claude'),
    ).toBe('dicerequests-ids-assigned-by-the-backend-not-claude');
  });
});

describe('adrFilename', () => {
  it('uses the bare number, not the full identifier', () => {
    expect(adrFilename('ADR-0007', 'Security posture')).toBe(
      '0007-security-posture.md',
    );
  });
});

describe('numberToId', () => {
  it('zero-pads to four digits', () => {
    expect(numberToId(1)).toBe('ADR-0001');
    expect(numberToId(93)).toBe('ADR-0093');
  });
});

describe('frontMatterSchema', () => {
  it('accepts a valid record', () => {
    expect(frontMatterSchema.parse(validFrontMatter)).toMatchObject({
      id: 'ADR-0042',
    });
  });

  it('rejects an area outside the allowed set', () => {
    expect(() =>
      frontMatterSchema.parse({ ...validFrontMatter, area: 'made-up-area' }),
    ).toThrow();
  });

  it('rejects a missing required key', () => {
    const { milestone, ...withoutMilestone } = validFrontMatter;
    expect(() => frontMatterSchema.parse(withoutMilestone)).toThrow();
  });

  it('rejects an unknown key rather than passing it through', () => {
    expect(() =>
      frontMatterSchema.parse({ ...validFrontMatter, tags: ['a'] }),
    ).toThrow();
  });

  it('rejects superseded without a superseded_by', () => {
    expect(() =>
      frontMatterSchema.parse({ ...validFrontMatter, status: 'superseded' }),
    ).toThrow();
  });

  it('rejects a self-referential superseded_by', () => {
    expect(() =>
      frontMatterSchema.parse({
        ...validFrontMatter,
        status: 'superseded',
        superseded_by: 'ADR-0042',
      }),
    ).toThrow();
  });

  it('rejects a malformed id', () => {
    expect(() =>
      frontMatterSchema.parse({ ...validFrontMatter, id: 'ADR-42' }),
    ).toThrow();
  });
});

describe('parseAdrFile', () => {
  it('round-trips through serializeAdrFile', () => {
    const file = { frontMatter: validFrontMatter, body: 'Body text.' } as const;
    const parsed = parseAdrFile(serializeAdrFile(file));
    expect(parsed.frontMatter).toEqual(validFrontMatter);
    expect(parsed.body).toBe('Body text.');
  });

  it('keeps a horizontal rule in the body instead of truncating there', () => {
    const body = 'First paragraph.\n\n---\n\nSecond paragraph.';
    const text = serializeAdrFile({ frontMatter: validFrontMatter, body });
    expect(parseAdrFile(text).body).toBe(body);
  });

  it('quotes a title containing a colon so it survives the round trip', () => {
    const title = 'ORM: Drizzle over TypeORM';
    const text = serializeAdrFile({
      frontMatter: { ...validFrontMatter, title },
      body: 'x',
    });
    expect(parseAdrFile(text).frontMatter.title).toBe(title);
  });

  it('preserves a title containing backticks and quotes', () => {
    const title = "`eval:compare`'s mixed-rubric warning groups by `checkId`";
    const text = serializeAdrFile({
      frontMatter: { ...validFrontMatter, title },
      body: 'x',
    });
    expect(parseAdrFile(text).frontMatter.title).toBe(title);
  });

  it('throws when front matter is missing', () => {
    expect(() => parseAdrFile('# Just a heading\n')).toThrow();
  });
});

describe('splitDecisionsLog', () => {
  const log = [
    '# Decisions Log',
    '',
    'Preamble paragraph.',
    '',
    '---',
    '',
    '## Architecture & Backend',
    '',
    '### First decision',
    '',
    'Body of the first.',
    '',
    '---',
    '',
    '### Second decision',
    '',
    'Body of the second.',
    '',
    '---',
    '',
    '## Security',
    '',
    '### Third decision',
    '',
    'Body of the third.',
    '',
  ].join('\n');

  it('captures the preamble up to the first section heading', () => {
    expect(splitDecisionsLog(log).preamble).toBe(
      '# Decisions Log\n\nPreamble paragraph.\n\n---',
    );
  });

  it('finds every entry and carries the enclosing section into area', () => {
    const { entries } = splitDecisionsLog(log);
    expect(entries.map((e) => e.title)).toEqual([
      'First decision',
      'Second decision',
      'Third decision',
    ]);
    expect(entries.map((e) => e.area)).toEqual([
      'architecture-backend',
      'architecture-backend',
      'security',
    ]);
  });

  it('strips a stray entry-level separator instead of absorbing it', () => {
    // The `---` before "### Second decision" would otherwise land at the end
    // of the first entry's body. Three of these exist in the real log.
    const { entries } = splitDecisionsLog(log);
    expect(entries[0].body).toBe('Body of the first.');
  });

  it('strips the section separator from the last entry of a section', () => {
    const { entries } = splitDecisionsLog(log);
    expect(entries[1].body).toBe('Body of the second.');
  });

  it('does not split on a `### ` inside a code fence', () => {
    const fenced = [
      '## Security',
      '',
      '### Real entry',
      '',
      'Here is a markdown sample:',
      '',
      '```markdown',
      '### Not an entry',
      '```',
      '',
      'Trailing prose.',
      '',
    ].join('\n');
    const { entries } = splitDecisionsLog(fenced);
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toContain('### Not an entry');
  });

  it('throws on an unmapped section heading', () => {
    expect(() =>
      splitDecisionsLog('## Brand New Section\n\n### Entry\n\nBody.\n'),
    ).toThrow(/unknown section heading/);
  });
});

describe('renderIndex', () => {
  const adr = (
    id: string,
    body: string,
    summary: string | null,
  ): LoadedAdr => ({
    filename: `${id.slice(4)}-fixture.md`,
    frontMatter: { ...validFrontMatter, id, summary },
    body,
  });

  it('renders the full body in the full view even when a summary exists', () => {
    const out = renderIndex('# Log', [adr('ADR-0001', 'THE BODY', 'THE GIST')]);

    expect(out).toContain('THE BODY');
    expect(out).not.toContain('THE GIST');
  });

  it('renders the summary in the summary view', () => {
    const corpus = [adr('ADR-0001', 'THE BODY', 'THE GIST')];

    const out = renderIndex('# Log', corpus, 'summary');

    expect(out).toContain('THE GIST');
    expect(out).not.toContain('THE BODY');
  });

  it('falls back to the body in the summary view when no summary exists', () => {
    const out = renderIndex(
      '# Log',
      [adr('ADR-0001', 'THE BODY', null)],
      'summary',
    );

    expect(out).toContain('THE BODY');
  });

  it('produces identical views while no entry has a summary', () => {
    /* The stated starting condition: the split is additive, so the two files
       diverge only as summaries get written. */
    const corpus = [adr('ADR-0001', 'ONE', null), adr('ADR-0002', 'TWO', null)];

    const full = renderIndex('# Log', corpus, 'full');
    const summary = renderIndex('# Log', corpus, 'summary');

    expect(stripViewNote(full)).toBe(stripViewNote(summary));
  });

  it('is deterministic — the stale check diffs its own output', () => {
    const corpus = [adr('ADR-0001', 'ONE', 'GIST')];

    expect(renderIndex('# Log', corpus, 'summary')).toBe(
      renderIndex('# Log', corpus, 'summary'),
    );
  });

  /** The one line that names which view you have open, and must differ. */
  const stripViewNote = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !line.startsWith('**This is the'))
      .join('\n');
});
