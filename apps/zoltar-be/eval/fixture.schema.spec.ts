import { describe, expect, it } from 'vitest';

import { evalFixtureSchema } from './fixture.schema';

const SEEDED_STATE = {
  campaignState: { worldFacts: {}, entities: {}, flags: {} },
  gmContextBlob: { entities: [] },
  pendingCanon: [],
  messages: [{ id: '1', role: 'player', content: 'hello' }],
  capturedAt: '2026-07-15T00:00:00.000Z',
};

const VALID_STRUCTURAL_FIXTURE = {
  id: 'turn19-out-of-order-resolution',
  tag: 'OUT-OF-ORDER-RESOLUTION',
  sourceAdventureId: '00000000-0000-0000-0000-000000000001',
  sourceSequenceNumber: 19,
  seededState: SEEDED_STATE,
  playerInput: { type: 'message', content: 'I fire at the xenomorph.' },
  assertion: {
    mode: 'structural',
    check: 'no damage roll before to-hit roll resolves',
  },
};

const VALID_JUDGED_FIXTURE = {
  id: 'turn24-hidden-info-leak',
  tag: 'HIDDEN-INFO-LEAK',
  sourceAdventureId: '00000000-0000-0000-0000-000000000002',
  sourceSequenceNumber: 24,
  seededState: SEEDED_STATE,
  playerInput: { type: 'message', content: 'I search the room.' },
  assertion: {
    mode: 'judged',
    rubric: 'HIDDEN-INFO-LEAK',
    facts: { perceptionBoundary: 'the player can only see the airlock.' },
  },
};

describe('evalFixtureSchema', () => {
  it('accepts a valid structural fixture', () => {
    const result = evalFixtureSchema.safeParse(VALID_STRUCTURAL_FIXTURE);
    expect(result.success).toBe(true);
  });

  it('accepts a valid judged fixture', () => {
    const result = evalFixtureSchema.safeParse(VALID_JUDGED_FIXTURE);
    expect(result.success).toBe(true);
  });

  it('rejects a fixture missing a required field', () => {
    const { id: _id, ...withoutId } = VALID_STRUCTURAL_FIXTURE;
    const result = evalFixtureSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects an assertion whose fields do not match its mode', () => {
    const badAssertion = {
      ...VALID_STRUCTURAL_FIXTURE,
      assertion: { mode: 'judged', check: 'wrong fields for this mode' },
    };
    const result = evalFixtureSchema.safeParse(badAssertion);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown failure mode tag', () => {
    const badTag = { ...VALID_STRUCTURAL_FIXTURE, tag: 'SNAPSHOT-GAP' };
    const result = evalFixtureSchema.safeParse(badTag);
    expect(result.success).toBe(false);
  });

  it('rejects a judged fixture missing facts', () => {
    const badFacts = {
      ...VALID_JUDGED_FIXTURE,
      assertion: { mode: 'judged', rubric: 'HIDDEN-INFO-LEAK' },
    };
    const result = evalFixtureSchema.safeParse(badFacts);
    expect(result.success).toBe(false);
  });

  it('rejects a judged tag paired with a structural assertion', () => {
    const mismatched = {
      ...VALID_JUDGED_FIXTURE,
      assertion: VALID_STRUCTURAL_FIXTURE.assertion,
    };
    const result = evalFixtureSchema.safeParse(mismatched);
    expect(result.success).toBe(false);
  });

  it('rejects a structural tag paired with a judged assertion', () => {
    const mismatched = {
      ...VALID_STRUCTURAL_FIXTURE,
      assertion: VALID_JUDGED_FIXTURE.assertion,
    };
    const result = evalFixtureSchema.safeParse(mismatched);
    expect(result.success).toBe(false);
  });

  describe('fixtureSchemaVersion', () => {
    it('defaults to 1 when absent, for fixtures captured before the field existed', () => {
      const result = evalFixtureSchema.safeParse(VALID_STRUCTURAL_FIXTURE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fixtureSchemaVersion).toBe(1);
      }
    });

    it('accepts an explicit value greater than 1', () => {
      const result = evalFixtureSchema.safeParse({
        ...VALID_STRUCTURAL_FIXTURE,
        fixtureSchemaVersion: 2,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fixtureSchemaVersion).toBe(2);
      }
    });

    it.each([0, -1, 1.5])('rejects %s', (value) => {
      const result = evalFixtureSchema.safeParse({
        ...VALID_STRUCTURAL_FIXTURE,
        fixtureSchemaVersion: value,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('repOverride', () => {
    it('is optional', () => {
      const result = evalFixtureSchema.safeParse(VALID_STRUCTURAL_FIXTURE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repOverride).toBeUndefined();
      }
    });

    it('accepts a positive integer', () => {
      const result = evalFixtureSchema.safeParse({
        ...VALID_STRUCTURAL_FIXTURE,
        repOverride: 1,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repOverride).toBe(1);
      }
    });

    it.each([0, -1, 1.5])('rejects %s', (value) => {
      const result = evalFixtureSchema.safeParse({
        ...VALID_STRUCTURAL_FIXTURE,
        repOverride: value,
      });
      expect(result.success).toBe(false);
    });
  });
});
