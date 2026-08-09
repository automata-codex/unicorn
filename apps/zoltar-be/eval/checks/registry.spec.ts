import { describe, expect, it } from 'vitest';

import {
  failureModeTagSchema,
  judgedFailureModeTags,
  structuralFailureModeTags,
} from '../fixture.schema';

import {
  evalChecks,
  rubricHashFor,
  rubricTextFor,
  selectChecksForFixture,
} from './registry';
import { fakeFixture } from './structural/test-helpers';

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
      expect(['fixture', 'artifact', 'ungated']).toContain(
        check.applicabilitySource,
      );
    }
  });

  it('marks the purely fixture-gated check as fixture-sourced', () => {
    // Moved off "did the model happen to roll?" onto fixture-authored
    // applicability — the fix `decisions.md` records.
    expect(evalChecks['system-rolled-player-action'].applicabilitySource).toBe(
      'fixture',
    );
  });

  it('marks a check that gates on both the fixture and the artifact as artifact-sourced', () => {
    // `out-of-order-resolution` consults fixture applicability first and then
    // the turn's own output — a turn that leaves no pending dice_request and
    // declares no gatedByRollId has no ordering to adjudicate. It was
    // declared 'fixture' until the 2026-08-09 re-baseline produced the first
    // run where reps disagreed, which tripped the report's own "fixture-gated
    // but applicability is 0.70" defect line.
    //
    // The rule the label encodes: 'fixture' asserts every rep must agree, so
    // a single artifact-dependent branch makes it false. Declare the weakest
    // link.
    expect(evalChecks['out-of-order-resolution'].applicabilitySource).toBe(
      'artifact',
    );
  });

  it('marks checks that never report not_applicable as ungated', () => {
    // Narrowed from "every judged tag" once the first hybrid checks landed.
    // `mode` and `applicabilitySource` are different axes: a judged check
    // with a structural pre-filter can and does report not_applicable, and
    // labelling it 'ungated' would put the hazard label on the wrong checks.
    for (const id of [
      'hidden-info-leak',
      'over-resolution',
      'unsurfaced-check',
      'scene-jump',
    ]) {
      expect(evalChecks[id].applicabilitySource).toBe('ungated');
    }
  });

  it('marks a judged check whose gate can report not_applicable as artifact-sourced', () => {
    // `unauditable-mapping` is judged, and its `judgeGate` decides
    // applicability from the turn's own rolls — the outcome-selection hazard
    // the label exists to flag. This pairing is the reason the enum value is
    // 'ungated' rather than 'judged-check'.
    const check = evalChecks['unauditable-mapping'];
    expect(check.mode).toBe('judged');
    expect(check.applicabilitySource).toBe('artifact');
    expect(check.judgeGate).toBeDefined();
  });

  it('gives every judged check with a gate a matching judgeContext or a self-contained rubric', () => {
    // A gate that narrows *which* events the rubric is about must hand that
    // set to the judge, or the rubric has to restate the filter in prose and
    // the two can drift. `narrating-past-a-block`'s gate narrows nothing
    // (it only ever FAILs or falls through), so it needs no context.
    expect(evalChecks['unauditable-mapping'].judgeContext).toBeDefined();
    expect(evalChecks['narrating-past-a-block'].judgeContext).toBeUndefined();
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
