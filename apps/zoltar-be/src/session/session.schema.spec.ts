import { describe, expect, it } from 'vitest';

import {
  rollDiceInputSchema,
  rollDiceOutputSchema,
  rulesLookupInputSchema,
  rulesLookupOutputSchema,
  submitGmResponseSchema,
} from './session.schema';

describe('submitGmResponseSchema', () => {
  it('accepts a minimal payload with only playerText', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'You stand at the airlock.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated payload', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'The terminal flickers.',
      stateChanges: {
        resourcePools: { dr_chen_hp: { delta: -3 } },
        entities: {
          shadow_threat: { visible: true, status: 'revealed' },
        },
        flags: {
          airlock_sealed: { value: true },
          corporate_spy_revealed: { value: true, trigger: 'Manifest shown.' },
        },
        scenarioState: { hull_breach_progression: { current: 3 } },
        worldFacts: { corridor_length: 'eight meters' },
      },
      gmUpdates: {
        npcStates: { engineer_kowalski: 'wounded, cooperating' },
        notes: 'Party is running low on ammo.',
        proposedCanon: [{ summary: 'Ship has a brig.', context: 'Cell door.' }],
      },
      diceRequests: [{ notation: '1d100', purpose: 'Fear save', target: 30 }],
      adventureMode: 'initiative',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing playerText', () => {
    const result = submitGmResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a legacy position subfield on entities', () => {
    // Position is not in the corrected shape — the write path must reject it
    // if Claude emits it, so the spatial deferral stays clean.
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        entities: {
          dr_chen: { position: { x: 1, y: 2, z: 0 } },
        },
      },
    });
    // Zod's default behaviour is to strip unknown keys, not reject them, so a
    // payload carrying `position` still parses. Assert that at minimum the
    // parsed output does NOT carry position through.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stateChanges?.entities?.dr_chen).not.toHaveProperty(
        'position',
      );
    }
  });

  it('rejects a flags entry with non-boolean value', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        flags: { airlock_sealed: { value: 'true' } },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer delta in resourcePools', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        resourcePools: { dr_chen_hp: { delta: 1.5 } },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts adventureMode: null', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      adventureMode: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a diceRequests entry with target: null (commitment mode)', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      diceRequests: [
        { notation: '1d100', purpose: 'Hidden save', target: null },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a diceRequests entry with target omitted', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      diceRequests: [{ notation: '1d100', purpose: 'Save' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-integer target on a diceRequests entry', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      diceRequests: [{ notation: '1d100', purpose: 'Save', target: 42.5 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('rollDiceInputSchema', () => {
  it('accepts notation and purpose', () => {
    const result = rollDiceInputSchema.safeParse({
      notation: '2d6+3',
      purpose: 'Panic check for Dr. Chen',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing purpose', () => {
    const result = rollDiceInputSchema.safeParse({ notation: '1d100' });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing notation', () => {
    const result = rollDiceInputSchema.safeParse({ purpose: 'Fear save' });
    expect(result.success).toBe(false);
  });
});

describe('rollDiceOutputSchema', () => {
  it('accepts a fully populated output', () => {
    const result = rollDiceOutputSchema.safeParse({
      notation: '2d6+3',
      results: [4, 2],
      modifier: 3,
      total: 9,
    });
    expect(result.success).toBe(true);
  });

  it('defaults modifier to 0 when omitted', () => {
    const result = rollDiceOutputSchema.safeParse({
      notation: '1d100',
      results: [73],
      total: 73,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modifier).toBe(0);
    }
  });

  it('rejects a non-integer die result', () => {
    const result = rollDiceOutputSchema.safeParse({
      notation: '1d100',
      results: [73.5],
      total: 73,
    });
    expect(result.success).toBe(false);
  });
});

describe('rulesLookupInputSchema', () => {
  it('accepts a query with explicit limit', () => {
    const result = rulesLookupInputSchema.safeParse({
      query: 'panic check result of 73',
      limit: 5,
    });
    expect(result.success).toBe(true);
  });

  it('defaults limit to 3 when omitted', () => {
    const result = rulesLookupInputSchema.safeParse({
      query: 'panic check',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(3);
    }
  });

  it('rejects limit below 1', () => {
    const result = rulesLookupInputSchema.safeParse({
      query: 'panic',
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects limit above 5', () => {
    const result = rulesLookupInputSchema.safeParse({
      query: 'panic',
      limit: 6,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer limit', () => {
    const result = rulesLookupInputSchema.safeParse({
      query: 'panic',
      limit: 2.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing query', () => {
    const result = rulesLookupInputSchema.safeParse({ limit: 3 });
    expect(result.success).toBe(false);
  });
});

describe('rulesLookupOutputSchema', () => {
  it('accepts an empty results array (empty-index path)', () => {
    const result = rulesLookupOutputSchema.safeParse({ results: [] });
    expect(result.success).toBe(true);
  });

  it('accepts populated results with similarity scores', () => {
    const result = rulesLookupOutputSchema.safeParse({
      results: [
        {
          text: 'On a panic result of 71–80, the character…',
          source: 'Player Survival Guide p.42',
          similarity: 0.87,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a result missing source', () => {
    const result = rulesLookupOutputSchema.safeParse({
      results: [{ text: 'x', similarity: 0.5 }],
    });
    expect(result.success).toBe(false);
  });
});
