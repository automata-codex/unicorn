import { describe, expect, it } from 'vitest';

import {
  failureModeTagSchema,
  judgedFailureModeTags,
  structuralFailureModeTags,
} from '../fixture.schema';
import { fakeFixture } from './structural/test-helpers';

import {
  evalChecks,
  rubricHashFor,
  rubricTextFor,
  selectChecksForFixture,
} from './registry';

describe('evalChecks', () => {
  it('has exactly one check per tag in failureModeTagSchema', () => {
    const tags = failureModeTagSchema.options;
    const checksByTag = Object.values(evalChecks);

    for (const tag of tags) {
      const matching = checksByTag.filter((c) => c.tag === tag);
      expect(matching).toHaveLength(1);
    }
    expect(checksByTag).toHaveLength(tags.length);
  });

  it('declares an applicabilitySource for every check', () => {
    // Required, not optional, so adding a check forces the question to be
    // answered rather than defaulted — the field exists precisely to make
    // outcome-selected denominators visible, and a silent default would be
    // a guess at the thing it records.
    for (const check of Object.values(evalChecks)) {
      expect(['fixture', 'artifact', 'none']).toContain(
        check.applicabilitySource,
      );
    }
  });

  it('marks the two re-gated checks as fixture-sourced', () => {
    // These are the checks moved off "did the model happen to roll?" onto
    // fixture-authored applicability — the fix `decisions.md` records.
    expect(evalChecks['system-rolled-player-action'].applicabilitySource).toBe(
      'fixture',
    );
    expect(evalChecks['out-of-order-resolution'].applicabilitySource).toBe(
      'fixture',
    );
  });

  it('marks checks that never report not_applicable as gating on nothing', () => {
    // A judged check reaches pass or fail on every rep, so labelling it
    // 'artifact' would imply a selection hazard it does not have.
    for (const tag of judgedFailureModeTags) {
      expect(evalChecks[tag.toLowerCase()].applicabilitySource).toBe('none');
    }
  });

  it('has unique, lower-kebab ids that match their tag', () => {
    const ids = new Set<string>();
    for (const check of Object.values(evalChecks)) {
      expect(ids.has(check.id)).toBe(false);
      ids.add(check.id);

      expect(check.id).toBe(check.id.toLowerCase());
      expect(check.id).not.toMatch(/[A-Z_]/);
      expect(check.id).toBe(check.tag.toLowerCase());
    }
  });

  it('agrees with structuralFailureModeTags / judgedFailureModeTags on mode', () => {
    for (const tag of structuralFailureModeTags) {
      expect(evalChecks[tag.toLowerCase()].mode).toBe('structural');
    }
    for (const tag of judgedFailureModeTags) {
      expect(evalChecks[tag.toLowerCase()].mode).toBe('judged');
    }
  });

  it('registers evalChecks by id as the record key', () => {
    for (const [key, check] of Object.entries(evalChecks)) {
      expect(key).toBe(check.id);
    }
  });

  it('every judged check has a rubric registered', () => {
    for (const check of Object.values(evalChecks)) {
      if (check.mode !== 'judged') continue;
      expect(() => rubricTextFor(check.id)).not.toThrow();
      expect(rubricTextFor(check.id).length).toBeGreaterThan(0);
    }
  });

  it('every structural check has no rubricHash', () => {
    for (const check of Object.values(evalChecks)) {
      if (check.mode === 'structural') {
        expect(check.rubricHash).toBeUndefined();
      }
    }
  });
});

describe('selectChecksForFixture', () => {
  it("returns the one check matching the fixture's tag", () => {
    const fixture = fakeFixture({ tag: 'OUT-OF-ORDER-RESOLUTION' });
    const checks = selectChecksForFixture(fixture);
    expect(checks).toHaveLength(1);
    expect(checks[0].id).toBe('out-of-order-resolution');
  });
});

describe('rubricHashFor', () => {
  it('is stable across calls', () => {
    const first = rubricHashFor('hidden-info-leak');
    const second = rubricHashFor('hidden-info-leak');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differs between different rubrics', () => {
    expect(rubricHashFor('hidden-info-leak')).not.toBe(
      rubricHashFor('over-resolution'),
    );
  });

  it('throws for a non-judged (structural) check id', () => {
    expect(() => rubricHashFor('out-of-order-resolution')).toThrow(
      /not a registered judged check/,
    );
  });

  it('throws for an unknown check id', () => {
    expect(() => rubricHashFor('not-a-real-check')).toThrow();
  });
});
