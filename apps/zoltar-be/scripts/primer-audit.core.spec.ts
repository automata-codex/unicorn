import { describe, expect, it } from 'vitest';

import {
  auditPrimer,
  parsePrimer,
  unmentionedHeadings,
  usesTerm,
} from './primer-audit.core';

import type { PresenceLookup, TermPresence } from './primer-audit.core';

/**
 * Every test here is a real error this milestone shipped. The invariants were
 * chosen by working backwards from `§ S24`–`§ S26`, so a test that stops
 * failing means an invariant stopped catching the thing it exists for.
 */

function presence(
  corpus: string[],
  headings: string[] | null = null,
): PresenceLookup {
  return (term: string): TermPresence => {
    const needle = term.toLowerCase();
    const hits = (headings ?? []).filter((h) =>
      h.toLowerCase().includes(needle),
    );
    return {
      inCorpus: corpus.some((c) => c.toLowerCase().includes(needle)),
      inHeadings: headings === null ? null : hits.length > 0,
      headingHits: hits,
    };
  };
}

const PRIMER = `HOW TO PHRASE A rules_lookup QUERY

  attack roll            ->  Combat Check
  hit points, HP         ->  Health

Some things are not wrong words but absent mechanics, and rephrasing cannot
find them. Do not translate these: perception, stealth, flanking.

MORE PROSE
- A bullet with -> inside it must not parse as a mapping row.
`;

describe('parsePrimer', () => {
  it('reads the vocabulary table', () => {
    const p = parsePrimer(PRIMER);
    expect(p.mappings.map((m) => [m.from, m.to])).toEqual([
      ['attack roll', 'Combat Check'],
      ['hit points, HP', 'Health'],
    ]);
  });

  it('reads the absent-mechanics list', () => {
    expect(parsePrimer(PRIMER).absentMechanics).toEqual([
      'perception',
      'stealth',
      'flanking',
    ]);
  });

  it('does not mistake a prose bullet containing -> for a table row', () => {
    expect(parsePrimer(PRIMER).mappings).toHaveLength(2);
  });

  it('returns empty rather than throwing on an unrecognisable primer', () => {
    // A QA tool that crashes on a reworded prompt gets disabled. Reporting
    // "nothing found to check" is the louder signal.
    const p = parsePrimer('just some prose\nwith no structure at all\n');
    expect(p.mappings).toEqual([]);
    expect(p.absentMechanics).toEqual([]);
  });
});

describe('auditPrimer', () => {
  it('flags a mapping whose SOURCE term the book already uses', () => {
    // The `damage reduction -> Armor Points (AP)` error (§ S26.1). The book
    // prints "Damage Reduction (DR)" verbatim, so the mapping redirected a
    // word the book uses toward a different mechanic.
    const primer = parsePrimer('x\n\n  damage reduction  ->  Armor Points\n\n');
    const findings = auditPrimer(
      primer,
      presence([
        'some armor may have Damage Reduction (DR) which always',
        'ignore all Damage less than their Armor Points',
      ]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      invariant: 'mapping-source-is-in-the-book',
    });
  });

  it('flags a mapping whose TARGET is nowhere in the book', () => {
    // The `Sensors` error (§ S21 commit trail): a mapping pointing at a term
    // appearing in zero chunks sends the Warden to search for nothing.
    const primer = parsePrimer('x\n\n  perception  ->  Sensors\n\n');
    const findings = auditPrimer(primer, presence(['intellect and combat']));

    expect(findings.map((f) => f.invariant)).toContain(
      'mapping-target-is-absent',
    );
  });

  it('flags a term that is both mapped and declared absent', () => {
    // `perception -> Intellect Check` and `stealth -> sneak` each shipped
    // alongside later lines saying those checks do not exist (§ S26.1). The
    // Warden was told both to translate the term and that it does not exist.
    const primer = parsePrimer(
      'x\n\n  stealth  ->  sneak\n\nnot wrong words but absent mechanics: stealth, flanking.\n',
    );
    const findings = auditPrimer(primer, presence(['sneak out before it']));

    expect(findings.map((f) => f.invariant)).toContain(
      'term-both-mapped-and-declared-absent',
    );
  });

  it('flags a declared-absent mechanic that the book has a HEADING for', () => {
    // The check that could not run before `--dump-headings`, and the one that
    // would have caught `26.2 SURPRISE` being called absent (§ S26.3).
    const primer = parsePrimer(
      'x\n\nnot wrong words but absent mechanics: surprise, flanking.\n',
    );
    const findings = auditPrimer(
      primer,
      presence(['ambushed or stunned'], ['26.2 SURPRISE', '26.1 TURN ORDER']),
    );

    const hit = findings.find(
      (f) => f.invariant === 'declared-absent-but-a-heading-names-it',
    );
    expect(hit?.severity).toBe('error');
    expect(hit?.detail).toContain('26.2 SURPRISE');
  });

  it('only warns when a declared-absent term appears in body prose', () => {
    // "cover" appears in prose that is not about a cover bonus, so corpus
    // presence alone is a prompt to look rather than a defect.
    const primer = parsePrimer(
      'x\n\nnot wrong words but absent mechanics: flanking.\n',
    );
    const findings = auditPrimer(
      primer,
      presence(
        ['moving to a flanking position was never a rule'],
        ['28.4 COVER'],
      ),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('passes a coherent primer', () => {
    const primer = parsePrimer(PRIMER);
    const findings = auditPrimer(
      primer,
      presence(
        ['make a Combat Check', 'subtract it from Health'],
        ['28.1 HOW DO I ATTACK?'],
      ),
    );

    expect(findings).toEqual([]);
  });
});

describe('unmentionedHeadings', () => {
  it('lists a heading whose subject the primer never mentions', () => {
    // How `26.1 TURN ORDER`'s optional Speed Check rule was found missing.
    const out = unmentionedHeadings('the primer talks about panic checks', [
      { physicalPage: 25, text: '26.1 TURN ORDER' },
      { physicalPage: 20, text: '21.1 WHAT IS A PANIC CHECK?' },
    ]);

    expect(out.map((h) => h.text)).toEqual(['26.1 TURN ORDER']);
  });

  it('strips the section number before matching', () => {
    const out = unmentionedHeadings('turn order is loose by default', [
      { physicalPage: 25, text: '26.1 TURN ORDER' },
    ]);

    expect(out).toEqual([]);
  });

  it('counts a heading as mentioned when the primer covers its content words', () => {
    // Whole-string matching would flag this: "WHAT IS A PANIC CHECK?" never
    // appears verbatim in a primer that plainly discusses panic checks, and a
    // list full of those is noise nobody reads.
    const out = unmentionedHeadings(
      'panic checks are the one exception to roll-under',
      [{ physicalPage: 20, text: '21.1 WHAT IS A PANIC CHECK?' }],
    );

    expect(out).toEqual([]);
  });

  it('ignores a heading with no content words at all', () => {
    // A bare section number cannot be matched either way, so reporting it
    // would be noise with no possible resolution. A short-but-real heading
    // like "Sex" is a different case and IS reported — over-inclusion is the
    // safe direction for a review list.
    const out = unmentionedHeadings('nothing relevant here', [
      { physicalPage: 5, text: '6.1' },
      { physicalPage: 19, text: 'Sex' },
    ]);

    expect(out.map((h) => h.text)).toEqual(['Sex']);
  });

  it('matches on word boundaries, so a substring does not count as coverage', () => {
    // `cover` contains `over`; `start` contains `art`. Substring matching
    // would silently mark a section as covered because an unrelated word
    // happened to contain its name.
    const out = unmentionedHeadings('cover works like armor', [
      { physicalPage: 29, text: '30.1 OVER THE EDGE' },
    ]);

    expect(out).toHaveLength(1);
  });
});

describe('usesTerm', () => {
  it('does not match a term buried inside a longer word', () => {
    // Both were real false positives on this audit's first run against the
    // live primer: "DC" was found in "Handcuffs" and "search" in "research".
    expect(usesTerm('Fuzzy Handcuffs', 'DC')).toBe(false);
    expect(usesTerm('Used to research xenoflora', 'search')).toBe(false);
  });

  it('still matches a genuine appearance', () => {
    expect(usesTerm('see if you can spot a pattern', 'spot')).toBe(true);
    expect(
      usesTerm('use a computer terminal to search a directory', 'search'),
    ).toBe(true);
  });

  it('matches a plural against its singular', () => {
    // Trailing boundaries would break this, and a primer discussing panic
    // checks would report the panic-check section as uncovered.
    expect(usesTerm('panic checks are the exception', 'check')).toBe(true);
  });

  it('treats regex metacharacters in a term literally', () => {
    // Mappings carry text like "Armor Points (AP)"; an unescaped paren would
    // throw or match the wrong thing.
    expect(
      usesTerm('their armor points (ap) threshold', 'Armor Points (AP)'),
    ).toBe(true);
    expect(() => usesTerm('anything', 'a[b')).not.toThrow();
  });
});
