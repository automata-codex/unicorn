import { describe, expect, it } from 'vitest';

import {
  MothershipCharacterStateSchema,
  MothershipConditionEnum,
  MothershipWornArmorSchema,
  emptyMothershipCharacterState,
  suppressedSkills,
} from './character-state.schema';

describe('MothershipConditionEnum', () => {
  it('accepts every Panic table Condition', () => {
    for (const condition of [
      'coward',
      'frightened',
      'nightmares',
      'loss_of_confidence',
      'deflated',
      'doomed',
      'haunted',
      'spiraling',
    ]) {
      expect(() => MothershipConditionEnum.parse(condition)).not.toThrow();
    }
  });

  it('rejects a Condition the book does not have', () => {
    // Closed by design: an open string would let the Warden mint a Condition
    // nothing downstream can interpret.
    expect(() => MothershipConditionEnum.parse('mildly_annoyed')).toThrow();
  });
});

describe('MothershipCharacterStateSchema', () => {
  it('defaults an empty object to a freshly created character', () => {
    const state = MothershipCharacterStateSchema.parse({});
    expect(state).toEqual(emptyMothershipCharacterState());
  });

  it('seeds minimumStress at 2, matching creation', () => {
    expect(MothershipCharacterStateSchema.parse({}).minimumStress).toBe(2);
  });

  it('seeds bleeding at 0 and no pending Death Save', () => {
    const state = MothershipCharacterStateSchema.parse({});
    expect(state.bleeding).toBe(0);
    expect(state.pendingDeathSave).toBeNull();
  });

  it('parses a fully populated state', () => {
    const state = MothershipCharacterStateSchema.parse({
      conditions: [
        { condition: 'frightened', parameter: 'the thing in the vent' },
        { condition: 'loss_of_confidence', parameter: 'Wilderness Survival' },
      ],
      skills: [
        { skill: 'Wilderness Survival', tier: 'trained' },
        { skill: 'Xenobiology', tier: 'expert' },
      ],
      equipment: [
        { item: 'Revolver', charges: 12 },
        { item: 'Stimpak', quantity: 5 },
      ],
      wornArmor: {
        item: 'Standard Crew Attire',
        apBase: 3,
        apCurrent: 1,
        dr: 1,
        o2Remaining: null,
        features: ['air filter'],
      },
      minimumStress: 4,
      bleeding: 3,
      pendingDeathSave: 7,
    });
    expect(state.conditions).toHaveLength(2);
    expect(state.wornArmor?.apCurrent).toBe(1);
    expect(state.wornArmor?.destroyed).toBe(false);
  });

  it('rejects negative bleeding', () => {
    expect(() =>
      MothershipCharacterStateSchema.parse({ bleeding: -1 }),
    ).toThrow();
  });

  it('rejects a skill tier the rules do not have', () => {
    expect(() =>
      MothershipCharacterStateSchema.parse({
        skills: [{ skill: 'Firearms', tier: 'legendary' }],
      }),
    ).toThrow();
  });

  it('returns independent instances from the seed helper', () => {
    const a = emptyMothershipCharacterState();
    const b = emptyMothershipCharacterState();
    a.conditions.push({ condition: 'doomed' });
    expect(b.conditions).toEqual([]);
  });
});

describe('MothershipWornArmorSchema', () => {
  it('keeps DR separate from AP so it can survive destruction', () => {
    // A single number could not express "the armor is gone but the damage
    // reduction is not" (PSG §28.3).
    const armor = MothershipWornArmorSchema.parse({
      item: 'Hazard Suit',
      apBase: 5,
      apCurrent: 0,
      destroyed: true,
      dr: 2,
    });
    expect(armor.destroyed).toBe(true);
    expect(armor.dr).toBe(2);
  });

  it('defaults o2Remaining to null for an item with no air supply', () => {
    const armor = MothershipWornArmorSchema.parse({
      item: 'Standard Crew Attire',
      apBase: 1,
      apCurrent: 1,
    });
    expect(armor.o2Remaining).toBeNull();
    expect(armor.features).toEqual([]);
  });

  it('rejects negative AP', () => {
    expect(() =>
      MothershipWornArmorSchema.parse({
        item: 'Vaccsuit',
        apBase: 3,
        apCurrent: -1,
      }),
    ).toThrow();
  });
});

describe('suppressedSkills', () => {
  it('derives the suppressed set from loss_of_confidence parameters', () => {
    expect(
      suppressedSkills({
        conditions: [
          { condition: 'loss_of_confidence', parameter: 'Firearms' },
          { condition: 'doomed' },
        ],
      }),
    ).toEqual(new Set(['Firearms']));
  });

  it('suppresses nothing for other conditions, parameter or not', () => {
    expect(
      suppressedSkills({
        conditions: [
          { condition: 'frightened', parameter: 'Firearms' },
          { condition: 'spiraling' },
        ],
      }),
    ).toEqual(new Set());
  });

  it('suppresses nothing when loss_of_confidence names no skill', () => {
    // The validator rejects that on write, so reaching here means older data —
    // and guessing which skill was meant is worse than suppressing none.
    expect(
      suppressedSkills({ conditions: [{ condition: 'loss_of_confidence' }] }),
    ).toEqual(new Set());
  });

  it('is empty for a character with no conditions', () => {
    expect(suppressedSkills({ conditions: [] })).toEqual(new Set());
  });
});
