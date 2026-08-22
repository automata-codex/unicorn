import { describe, expect, it } from 'vitest';

import { submitGmResponseSchema } from './session.schema';
import {
  describeToolCallSyntax,
  detectToolCallSyntax,
  findToolCallSyntax,
  SUBMIT_GM_RESPONSE_KEYS,
  toolCallSyntaxRetryInstruction,
} from './session.tool-syntax';

// Shapes taken from the 2026-08-16 playtest and the 2026-08-09/16 eval runs,
// trimmed to the markup that matters. Keeping all three is deliberate: the
// model used a different closing dialect on different turns, and a detector
// that only knew the canonical one would have missed the very first failure.
const SEED_DIALECT = // playtest turn 12 — fabricated property-name closer
  'You squeeze through the gap and drop into Engineering.</playerText>\n' +
  '<parameter name="stateChanges">{}';

const CANONICAL_DIALECT = // playtest turn 52 — full payload lost
  'Everything goes dark at the edges.</parameter>\n' +
  '<parameter name="stateChanges">{"resourcePools":[{"owner":"dr_kennedy","pool":"hp","delta":-12}]}</parameter>\n' +
  '<parameter name="gmUpdates">{"notes":"Wounds chain."}</parameter>\n' +
  '</invoke>';

const BARE_TAG_DIALECT = // playtest turn 48
  'The hatch grinds shut behind you.</playerText>\n<stateChanges>{}</invoke>';

describe('findToolCallSyntax', () => {
  it('returns null for clean narration', () => {
    expect(
      findToolCallSyntax(
        'The cartographer looks at you, and there is something underneath ' +
          'the fear — guilt, maybe, sitting there like a stone.',
      ),
    ).toBeNull();
  });

  it('catches the fabricated property-name closer that seeded the playtest', () => {
    const found = findToolCallSyntax(SEED_DIALECT);
    expect(found).not.toBeNull();
    expect(found?.tokens).toContain('</playerText>');
    expect(found?.tokens).toContain('<parameter name="stateChanges">');
  });

  it('catches the canonical parameter/invoke dialect', () => {
    const found = findToolCallSyntax(CANONICAL_DIALECT);
    expect(found?.tokens).toContain('</parameter>');
    expect(found?.tokens).toContain('</invoke>');
  });

  it('catches a bare property-name tag', () => {
    expect(findToolCallSyntax(BARE_TAG_DIALECT)?.tokens).toContain(
      '<stateChanges>',
    );
  });

  it('reports the offset of the first match, not the last', () => {
    const found = findToolCallSyntax(CANONICAL_DIALECT);
    expect(found?.index).toBe(CANONICAL_DIALECT.indexOf('</parameter>'));
  });

  it('counts every match but caps the reported token list', () => {
    const many = Array.from(
      { length: 20 },
      (_, i) => `<parameter name="p${i}">`,
    ).join('x');
    const found = findToolCallSyntax(many);
    expect(found?.matchCount).toBe(20);
    expect(found?.tokens).toHaveLength(6);
  });

  it('is deterministic across repeated scans', () => {
    // Guards the module-level RegExp `lastIndex` state — a stateful /g
    // pattern would make the second call disagree with the first.
    const first = findToolCallSyntax(CANONICAL_DIALECT);
    const second = findToolCallSyntax(CANONICAL_DIALECT);
    expect(second).toEqual(first);
  });

  describe('does not fire on prose', () => {
    it.each([
      [
        'the element names as bare words',
        'Keep the ruling consistent — if you invoke a number, the parameter you set stands.',
      ],
      [
        'a similarly-prefixed tag',
        'The console reads <parameterization> across the panel.',
      ],
      ['a less-than comparison', 'Her pulse is < 40 and dropping, stress > 3.'],
      [
        'schema field names discussed in prose',
        'You have no way to read the stateChanges or the playerText of the world.',
      ],
      [
        'angle-bracketed non-tool markup',
        'The stencil reads <COMPARTMENT OVERRIDE — MANUAL>.',
      ],
    ])('%s', (_label, text) => {
      expect(findToolCallSyntax(text)).toBeNull();
    });
  });
});

describe('detectToolCallSyntax', () => {
  it('returns null for a well-formed payload', () => {
    expect(
      detectToolCallSyntax({
        playerText: 'The reactor housing hums, amber where it should be green.',
        stateChanges: {},
      }),
    ).toBeNull();
  });

  it('flags playerText and names the field', () => {
    const finding = detectToolCallSyntax({ playerText: CANONICAL_DIALECT });
    expect(finding?.field).toBe('playerText');
  });

  it('ignores markup-shaped text in Warden-private notes', () => {
    // gmUpdates.notes is where the Warden reasons about the schema by name;
    // scanning it would trade the real signal for false positives.
    expect(
      detectToolCallSyntax({
        playerText: 'The lever holds fast.',
        gmUpdates: {
          notes:
            'No way to increment wounds via <parameter name="stateChanges">.',
        },
      }),
    ).toBeNull();
  });
});

describe('token set', () => {
  it('tracks the schema rather than a hand-maintained list', () => {
    expect(SUBMIT_GM_RESPONSE_KEYS).toEqual(
      Object.keys(submitGmResponseSchema.shape),
    );
  });

  it('detects a tag for every top-level schema property', () => {
    for (const key of SUBMIT_GM_RESPONSE_KEYS) {
      expect(findToolCallSyntax(`narration</${key}>`)).not.toBeNull();
    }
  });
});

describe('messages', () => {
  const finding = detectToolCallSyntax({ playerText: CANONICAL_DIALECT });

  it('describes the consequence, not just the match', () => {
    const text = describeToolCallSyntax(finding!);
    expect(text).toContain('playerText');
    expect(text).toContain('silently discarded');
  });

  it('tells Claude what to do differently', () => {
    const text = toolCallSyntaxRetryInstruction(finding!);
    expect(text).toContain('Call submit_gm_response again');
    expect(text).toContain('separate tool parameters');
  });
});

describe('findToolCallSyntax with a caller-supplied property-name set', () => {
  it('detects a tag built from a supplied name', () => {
    expect(
      findToolCallSyntax('text</rationale>', ['passed', 'rationale']),
    ).not.toBeNull();
  });

  it('leaves the Warden path unchanged when no set is passed', () => {
    // The default is SUBMIT_GM_RESPONSE_KEYS, so a judge_verdict property
    // name is not markup as far as the Warden detector is concerned. This is
    // the assertion that the parameterisation did not widen the Warden's
    // token set by accident.
    expect(findToolCallSyntax('text</rationale>')).toBeNull();
    expect(findToolCallSyntax('text</playerText>')).not.toBeNull();
  });

  it('still matches the canonical elements regardless of the set', () => {
    expect(findToolCallSyntax('text</invoke>', ['passed'])).not.toBeNull();
  });
});
