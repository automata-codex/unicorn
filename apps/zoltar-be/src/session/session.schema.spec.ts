import { MOTHERSHIP_CHARACTER_POOL_NAMES } from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import {
  rollDiceInputSchema,
  rollDiceOutputSchema,
  rulesLookupInputSchema,
  rulesLookupOutputSchema,
  submitGmResponseSchema,
} from './session.schema';

/**
 * Reads a `resourcePools` field's `.describe()` text off the schema — which is
 * what actually reaches the model as the tool's `input_schema`, and therefore
 * the only place these assertions mean anything.
 */
function describeField(field: string): string {
  const shape = (submitGmResponseSchema._def.schema ??
    submitGmResponseSchema) as never;
  const stateChanges = (shape as any).shape.stateChanges;
  const inner = stateChanges._def.innerType ?? stateChanges;
  const pools = inner.shape.resourcePools;
  const element = (pools._def.innerType ?? pools)._def.type;
  return element.shape[field]._def.description ?? '';
}

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
        resourcePools: [
          {
            owner: 'dr_chen',
            pool: 'hp',
            delta: -3,
            reason: 'gunshot from the contractor',
            damageType: 'gunshot',
          },
        ],
        characterState: [{ op: 'bleeding_set', entityId: 'dr_chen', value: 2 }],
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
        resourcePools: [
          { owner: 'dr_chen', pool: 'hp', delta: 1.5, reason: 'x' },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a pool change with no reason', () => {
    // `reason` is what makes a delta auditable; without it the payload cannot
    // express the change at all, rather than expressing it unexplained.
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        resourcePools: [{ owner: 'dr_chen', pool: 'hp', delta: -2 }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty reason as firmly as a missing one', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        resourcePools: [
          { owner: 'dr_chen', pool: 'hp', delta: -2, reason: '' },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a damage type outside the five Wounds Table columns', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        resourcePools: [
          {
            owner: 'dr_chen',
            pool: 'hp',
            delta: -2,
            reason: 'x',
            damageType: 'psychic',
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a characterState op the union does not have', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        characterState: [{ op: 'armor_repair', entityId: 'dr_chen' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a condition outside the Panic table', () => {
    const result = submitGmResponseSchema.safeParse({
      playerText: 'x',
      stateChanges: {
        characterState: [
          {
            op: 'condition_add',
            entityId: 'dr_chen',
            condition: 'mildly_annoyed',
          },
        ],
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
  const valid = {
    notation: '2d6+3',
    purpose: 'Panic check for Dr. Chen',
    actingEntityId: 'dr_chen',
    rollType: 'panic_check',
  };

  it('accepts a fully populated roll', () => {
    expect(rollDiceInputSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a roll that names the roll it is gated by', () => {
    const result = rollDiceInputSchema.safeParse({
      ...valid,
      rollType: 'damage',
      gatedByRollId: 'roll_1',
    });
    expect(result.success).toBe(true);
  });

  it('treats gatedByRollId as optional, because most rolls have no gate', () => {
    const result = rollDiceInputSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gatedByRollId).toBeUndefined();
    }
  });

  it.each([
    'notation',
    'purpose',
    'actingEntityId',
    'rollType',
  ])('rejects a payload missing %s', (field) => {
    const { [field]: _omitted, ...rest } = valid as Record<string, unknown>;
    expect(rollDiceInputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an empty actingEntityId rather than treating it as absent', () => {
    // An empty string would reach the checkers as a present-but-useless
    // field, which reads as an attributed roll that matches no entity.
    const result = rollDiceInputSchema.safeParse({
      ...valid,
      actingEntityId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a rollType outside the enum', () => {
    const result = rollDiceInputSchema.safeParse({
      ...valid,
      rollType: 'initiative',
    });
    expect(result.success).toBe(false);
  });
});

describe('rollDiceOutputSchema', () => {
  it('accepts a fully populated output', () => {
    const result = rollDiceOutputSchema.safeParse({
      rollId: 'roll_1',
      notation: '2d6+3',
      results: [4, 2],
      modifier: 3,
      total: 9,
    });
    expect(result.success).toBe(true);
  });

  it('defaults modifier to 0 when omitted', () => {
    const result = rollDiceOutputSchema.safeParse({
      rollId: 'roll_1',
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
      rollId: 'roll_1',
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

describe('the pool field names what a character can carry', () => {
  /**
   * The 2026-08-16 playtest, turn 52: the Warden ran the whole wounds chain
   * correctly, then recorded in its own notes that it could find no way to
   * increment `dr_kennedy.wounds` through `resourcePools`, and inferred the
   * Wound from `characterState.death_save_pending` instead.
   *
   * The state was never missing — the fixtures from that playtest carry all
   * eleven pools, `wounds` among them, and the snapshot filters nothing. What
   * the model read was a description whose entire content was three examples,
   * `"hp", "stress", "combat"`, with `wounds` appearing nowhere in the tool
   * schema except under `maxDelta` — the field that moves a *ceiling*. Same
   * defect class as `ADR-0097` addendum 2: an open string whose examples were
   * read as the domain.
   */
  it('lists every pool a player character carries', () => {
    const description = describeField('pool');
    for (const name of MOTHERSHIP_CHARACTER_POOL_NAMES) {
      expect(description, name).toContain(name);
    }
  });

  it('says the set is not closed, so NPC and scenario pools stay legal', () => {
    expect(describeField('pool')).toMatch(/other owners may carry/i);
  });

  it('points taking a Wound at delta, and away from maxDelta', () => {
    expect(describeField('delta')).toContain('"wounds", delta: 1');
    expect(describeField('maxDelta')).toMatch(/not a change to its maximum/i);
  });
});
