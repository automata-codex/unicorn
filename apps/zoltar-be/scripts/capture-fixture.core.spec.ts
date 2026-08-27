import { describe, expect, it } from 'vitest';

import {
  evalChecks,
  selectChecksForFixture,
  tagIndependentCheckIds,
  universalCheckIds,
} from '../eval/checks/registry';
import { evalFixtureSchema } from '../eval/fixture.schema';

import { placeholderApplicability } from './capture-fixture.core';

import type { EvalFixture, FailureModeTag } from '../eval/fixture.schema';

/**
 * The database-free half of `capture-fixture` — everything that decides the
 * *shape* of a newly captured fixture, as opposed to what
 * `reconstructStateAsOfTurn` puts in it. `capture-fixture.spec-int.ts` covers
 * the seeded-state half against a real adventure.
 */
describe('placeholderApplicability', () => {
  it("stubs the fixture's own tag", () => {
    const applicability = placeholderApplicability('MISSING-CANON-CAPTURE');
    expect(applicability['missing-canon-capture']).toEqual({
      applies: false,
      situation: expect.stringContaining('TODO'),
    });
  });

  it('stubs every tag-independent check as well', () => {
    // The point of the whole function: a tag-independent check reaches a
    // fixture only through an authored `applicability` entry, so a capture
    // that omits the stub produces a fixture that check can never grade.
    // `ADR-0096` — this is the hole that let SYSTEM-ROLLED-PLAYER-ACTION read
    // 1.00 on a run containing six violations.
    const applicability = placeholderApplicability('SCENE-JUMP');
    for (const checkId of tagIndependentCheckIds) {
      expect(applicability[checkId]).toEqual({
        applies: false,
        situation: expect.stringContaining('TODO'),
      });
    }
    expect(tagIndependentCheckIds.length).toBeGreaterThan(0);
  });

  it('every entry fails closed', () => {
    // An unedited stub must never read as "situation confirmed" — the
    // placeholder convention `playerInput` and `assertion` also follow.
    for (const tag of ['SCENE-JUMP', 'OUT-OF-ORDER-RESOLUTION'] as const) {
      for (const entry of Object.values(placeholderApplicability(tag))) {
        expect(entry.applies).toBe(false);
      }
    }
  });

  it('does not emit a duplicate entry when the tag is itself tag-independent', () => {
    const applicability = placeholderApplicability(
      'SYSTEM-ROLLED-PLAYER-ACTION',
    );
    expect(Object.keys(applicability)).toEqual(['system-rolled-player-action']);
  });

  it('names a distinct reason for a tag-independent stub', () => {
    // The two stubs answer different questions — "is this the failure this
    // fixture was captured for" versus "does this scenario also provoke a
    // check that travels" — and an author reading identical text would have
    // no way to tell that the second one is asked of every capture.
    const applicability = placeholderApplicability('SCENE-JUMP');
    expect(applicability['scene-jump'].situation).not.toBe(
      applicability['system-rolled-player-action'].situation,
    );
    expect(applicability['system-rolled-player-action'].situation).toContain(
      'attaches',
    );
  });

  it('produces a stub every entry of which selection accepts', () => {
    // The stub and `selectChecksForFixture` must agree: selection throws on an
    // applicability key naming a check that is not tag-independent, so a stub
    // writing one would make every newly captured fixture unloadable.
    const fixture = {
      id: 'turn1-scene-jump',
      tag: 'SCENE-JUMP' as FailureModeTag,
      sourceAdventureId: '00000000-0000-0000-0000-000000000099',
      sourceSequenceNumber: 1,
      fixtureSchemaVersion: 2,
      seededState: {
        campaignState: {},
        gmContextBlob: {},
        pendingCanon: [],
        messages: [],
        pendingDiceRequests: [],
        precedingCommittedTurn: null,
        capturedAt: '2026-08-16T00:00:00.000Z',
      },
      playerInput: { type: 'message', content: 'TODO' },
      assertion: { mode: 'judged', rubric: 'SCENE-JUMP', facts: {} },
      applicability: placeholderApplicability('SCENE-JUMP'),
    } as EvalFixture;

    expect(evalFixtureSchema.safeParse(fixture).success).toBe(true);
    expect(() => selectChecksForFixture(fixture)).not.toThrow();
    expect(selectChecksForFixture(fixture).map((c) => c.id)).toEqual([
      'scene-jump',
      ...tagIndependentCheckIds,
      // Universal checks attach with no stub — deliberately absent from
      // `placeholderApplicability`, since a fail-closed stub would let a
      // capture switch off a check with no scenario reason to be off.
      ...universalCheckIds,
    ]);
  });
});

describe('placeholderApplicability and universal checks', () => {
  it('stubs no entry for a universal check', () => {
    // A stub would be read by nothing and would invite an author to set
    // `applies: false` believing it opted the check out.
    const stub = placeholderApplicability('SCENE-JUMP');
    for (const id of universalCheckIds) {
      expect(stub).not.toHaveProperty(id);
    }
  });
});

describe('tagIndependentCheckIds', () => {
  it('agrees with the flag on the built registry', () => {
    // Derived rather than re-listed, so this pins that it stays derived.
    const fromFlag = Object.values(evalChecks)
      .filter((c) => c.tagIndependent)
      .map((c) => c.id)
      .sort();
    expect([...tagIndependentCheckIds]).toEqual(fromFlag);
  });
});
