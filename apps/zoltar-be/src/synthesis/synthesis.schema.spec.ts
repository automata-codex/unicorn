import { describe, expect, it } from 'vitest';

import { submitGmContextSchema } from './synthesis.schema';

const validInput = {
  openingNarration: 'The emergency lights cast everything in amber.',
  narrative: {
    location: 'Derelict hauler, mid-deck',
    atmosphere: 'Cold, humming, wrong',
    npcAgendas: { dr_chen: 'Conceal the manifest at any cost.' },
    hiddenTruth: 'The cargo is alive.',
    oracleConnections: 'The survivor is the one who sealed the bay.',
  },
  structured: {
    entities: [
      {
        id: 'dr_chen',
        type: 'npc' as const,
        startingPosition: { x: 3, y: 4, z: 0 },
        visible: true,
        tags: ['corporate', 'injured'],
      },
      {
        id: 'corporate_spy_1',
        type: 'threat' as const,
        visible: false,
        tags: ['armed'],
      },
    ],
    flags: {
      adventure_complete: {
        value: false,
        trigger: 'Flip to true when the player escapes with the manifest.',
      },
      distress_beacon_active: {
        value: false,
        trigger: 'Flip to true when the bridge console is activated.',
      },
    },
    initialState: {
      dr_chen_hp: { current: 8, max: 10 },
    },
  },
};

describe('submitGmContextSchema', () => {
  it('accepts a fully valid payload', () => {
    const result = submitGmContextSchema.parse(validInput);
    expect(result.openingNarration).toBe(validInput.openingNarration);
    expect(result.structured.flags.adventure_complete.value).toBe(false);
  });

  it('treats openingNarration as optional', () => {
    const { openingNarration: _omit, ...rest } = validInput;
    expect(() => submitGmContextSchema.parse(rest)).not.toThrow();
  });

  it('defaults entity startingPosition.z to 0', () => {
    const input = structuredClone(validInput);
    input.structured.entities[0].startingPosition = {
      x: 1,
      y: 2,
      z: 0,
    };
    // Rebuild without z to exercise the default.
    const raw = {
      ...input,
      structured: {
        ...input.structured,
        entities: [
          {
            ...input.structured.entities[0],
            startingPosition: { x: 1, y: 2 },
          },
          input.structured.entities[1],
        ],
      },
    };
    const result = submitGmContextSchema.parse(raw);
    expect(result.structured.entities[0].startingPosition?.z).toBe(0);
  });

  it('rejects a flag missing its trigger', () => {
    const bad = structuredClone(validInput) as unknown as {
      structured: { flags: Record<string, unknown> };
    };
    bad.structured.flags.adventure_complete = { value: false };
    expect(() => submitGmContextSchema.parse(bad)).toThrow();
  });

  it('rejects an entity with an invalid type', () => {
    const bad = structuredClone(validInput) as unknown as {
      structured: { entities: Array<{ type: string }> };
    };
    bad.structured.entities[0].type = 'player';
    expect(() => submitGmContextSchema.parse(bad)).toThrow();
  });

  it('treats worldFacts as optional', () => {
    expect(() => submitGmContextSchema.parse(validInput)).not.toThrow();
    const result = submitGmContextSchema.parse(validInput);
    expect(result.structured.worldFacts).toBeUndefined();
  });

  it('accepts worldFacts when provided', () => {
    const input = {
      ...validInput,
      structured: {
        ...validInput.structured,
        worldFacts: { current_deck: 'engineering_lower' },
      },
    };
    const result = submitGmContextSchema.parse(input);
    expect(result.structured.worldFacts).toEqual({
      current_deck: 'engineering_lower',
    });
  });

  it('rejects worldFacts with non-string values', () => {
    const input = {
      ...validInput,
      structured: {
        ...validInput.structured,
        worldFacts: { count: 42 },
      },
    };
    expect(() => submitGmContextSchema.parse(input)).toThrow();
  });

  it('rejects a non-integer grid coordinate', () => {
    const bad = structuredClone(validInput);
    (
      bad.structured.entities[0].startingPosition as { x: number }
    ).x = 1.5;
    expect(() => submitGmContextSchema.parse(bad)).toThrow();
  });
});
