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
  universalCheckIds,
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
    expect(
      evalChecks['ungrounded-contractor-target'].judgeContext,
    ).toBeDefined();
    expect(evalChecks['narrating-past-a-block'].judgeContext).toBeUndefined();
  });

  it('names all three ungrounded-contractor-target violations in its rubric', () => {
    // The third one is why the check is named for the target rather than the
    // skill, and it is the one a rubric can lose silently: judgeContext hands
    // the judge every derived number, so the main question already catches a
    // target matching none of them — but a judge working down an enumerated
    // list of skill mistakes has a fair reading in which a fabricated Instinct
    // matches no bullet and passes.
    const rubric = rubricTextFor('ungrounded-contractor-target');
    expect(rubric).toContain('Three distinct violations');
    expect(rubric).toContain('a bonus that was owed went unapplied');
    expect(rubric).toContain('a bonus was applied that is not owed');
    expect(rubric).toContain('not any of the supplied numbers');
  });

  it('wires seeded-canon-contradiction as judged, artifact-gated, with both halves', () => {
    // The judgeContext is the load-bearing half here: runJudgeCall shows the
    // judge no seededState at all, so without it the rubric asks whether the
    // narration contradicts a ship layout the judge has never seen.
    const check = evalChecks['seeded-canon-contradiction'];
    expect(check.mode).toBe('judged');
    expect(check.applicabilitySource).toBe('artifact');
    expect(check.judgeGate).toBeDefined();
    expect(check.judgeContext).toBeDefined();
    expect(check.stub).toBeUndefined();
  });

  it('leaves SPATIAL-RELATION-ERROR unregistered', () => {
    // `ADR-0104`'s addendum defers it, and the deferral is load-bearing rather
    // than bookkeeping: while the tag is absent from failureModeTagSchema,
    // capture-fixture rejects `--tag SPATIAL-RELATION-ERROR` outright, so a
    // fixture cannot be captured against it by accident. Registering it would
    // replace that mechanical guard with a note asking people to remember, and
    // would force the structural-versus-judged choice that is the actual open
    // question.
    expect(failureModeTagSchema.options).not.toContain(
      'SPATIAL-RELATION-ERROR',
    );
    expect(evalChecks['spatial-relation-error']).toBeUndefined();
  });

  it('wires ungrounded-contractor-target as judged, artifact-gated, with both halves', () => {
    // The check depends on all three being present together: the gate picks
    // the Contractor rolls, the context computes their derived targets, and
    // the rubric decides which target each roll should have used. A missing
    // context in particular would not fail loudly — the judge would simply
    // grade with no numbers in front of it.
    const check = evalChecks['ungrounded-contractor-target'];
    expect(check.mode).toBe('judged');
    expect(check.applicabilitySource).toBe('artifact');
    expect(check.judgeGate).toBeDefined();
    expect(check.judgeContext).toBeDefined();
    expect(check.stub).toBeUndefined();
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
  it("returns the check matching the fixture's tag, plus the universal ones", () => {
    const fixture = fakeFixture({ tag: 'OUT-OF-ORDER-RESOLUTION' });
    const checks = selectChecksForFixture(fixture);
    expect(checks.map((c) => c.id)).toEqual([
      'out-of-order-resolution',
      'tool-syntax-leak',
    ]);
  });

  it('attaches every universal check to a fixture that authors no applicability at all', () => {
    // The property that separates universal from tag-independent: no
    // authoring act stands between the check and the fixture, so a capture
    // that forgets everything still carries it.
    const fixture = fakeFixture({ tag: 'MISSING-CANON-CAPTURE' });
    for (const id of universalCheckIds) {
      expect(selectChecksForFixture(fixture).map((c) => c.id)).toContain(id);
    }
  });

  it('throws when a fixture authors applicability for a universal check', () => {
    // The entry would be read by nothing, so an author who wrote
    // `applies: false` would believe they had opted out and would be wrong.
    const fixture = fakeFixture({
      tag: 'SCENE-JUMP',
      assertion: { mode: 'judged', rubric: 'SCENE-JUMP', facts: {} },
      applicability: {
        'tool-syntax-leak': { applies: false, situation: 'test' },
      },
    });
    expect(() => selectChecksForFixture(fixture)).toThrow(
      /universal check|silently ignored/,
    );
  });

  it('does not double-count a tag check that also authors its own applicability', () => {
    // The corpus shape for `turn19-out-of-order-resolution`: the tag check
    // and the applicability key are the same check.
    const fixture = fakeFixture({
      tag: 'OUT-OF-ORDER-RESOLUTION',
      applicability: {
        'out-of-order-resolution': {
          applies: true,
          playerEntity: 'Alvarez',
          situation: 'test',
        },
      },
    });
    expect(selectChecksForFixture(fixture).map((c) => c.id)).toEqual([
      'out-of-order-resolution',
      // Universal, appended to every fixture — see `universalCheckIds`.
      'tool-syntax-leak',
    ]);
  });

  it('attaches a tag-independent check to a fixture tagged something else', () => {
    // The `turn24-*` shape: a judged fixture that also provokes
    // SYSTEM-ROLLED-PLAYER-ACTION. Selection follows the fixture's
    // declaration, not its tag — the coverage hole in
    // `rules-extraction-findings.md § S34` was the tag deciding alone.
    const fixture = fakeFixture({
      tag: 'SCENE-JUMP',
      assertion: { mode: 'judged', rubric: 'SCENE-JUMP', facts: {} },
      applicability: {
        'system-rolled-player-action': {
          applies: true,
          playerEntity: 'Alvarez',
          situation: 'test',
        },
      },
    });
    expect(selectChecksForFixture(fixture).map((c) => c.id)).toEqual([
      'scene-jump',
      'system-rolled-player-action',
      'tool-syntax-leak',
    ]);
  });

  it('throws when applicability names a check that is not tag-independent', () => {
    // Silently skipping it would mean a fixture edit made to close a
    // coverage hole opens no rows and reports nothing — the same failure
    // shape as the hole.
    const fixture = fakeFixture({
      tag: 'SCENE-JUMP',
      assertion: { mode: 'judged', rubric: 'SCENE-JUMP', facts: {} },
      applicability: {
        'missing-canon-capture': {
          applies: true,
          playerEntity: 'Alvarez',
          situation: 'test',
        },
      },
    });
    expect(() => selectChecksForFixture(fixture)).toThrow(
      /not tag-independent/,
    );
  });

  it('throws when applicability names an unregistered check', () => {
    const fixture = fakeFixture({
      applicability: {
        'system-rolled-playr-action': {
          applies: true,
          playerEntity: 'Alvarez',
          situation: 'test',
        },
      },
    });
    expect(() => selectChecksForFixture(fixture)).toThrow(
      /not a registered check/,
    );
  });
});

describe('tagIndependent', () => {
  it('is declared only on structural checks', () => {
    // A judged check grades against `assertion.facts`, which exists only for
    // the fixture's own tag — the registry throws at build time rather than
    // letting one be listed, and this asserts the built registry agrees.
    for (const check of Object.values(evalChecks)) {
      if (check.tagIndependent) expect(check.mode).toBe('structural');
    }
  });

  it('covers system-rolled-player-action', () => {
    // The check whose applicability is already purely fixture-authored, so
    // it reads nothing from `fixture.assertion` and travels.
    expect(evalChecks['system-rolled-player-action'].tagIndependent).toBe(true);
  });

  it('does not cover a check that parses the fixture assertion', () => {
    // `missing-canon-capture` reads `assertion.check` prose directly.
    expect(evalChecks['missing-canon-capture'].tagIndependent).toBeUndefined();
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
