import { describe, expect, it } from 'vitest';

import {
  MothershipCharacterSheetSchema,
  MothershipClassEnum,
  MothershipCreationRollsSchema,
} from './character-sheet.schema';

const validRolls = {
  strength: [7, 4],
  speed: [3, 9],
  intellect: [5, 5],
  combat: [8, 6],
  sanity: [2, 7],
  fear: [6, 6],
  body: [4, 3],
  maxHp: [6],
  credits: [9, 2],
  trinket: [42],
  patch: [17],
};

const validSheet = {
  entityId: 'vasquez',
  name: 'Vasquez',
  pronouns: 'she/her',
  class: 'marine' as const,
  trinket: 'Dog tags, not yours',
  patch: '"Ask me about my Rifle"',
  traumaResponse: 'When you Panic, everyone else must make a Fear Save.',
  creationRolls: validRolls,
  notes: 'Former UASC marine, dishonorably discharged.',
};

describe('MothershipClassEnum', () => {
  it.each(['teamster', 'scientist', 'android', 'marine'])(
    'accepts %s',
    (klass) => {
      expect(() => MothershipClassEnum.parse(klass)).not.toThrow();
    },
  );

  it('rejects an unknown class', () => {
    expect(() => MothershipClassEnum.parse('warden')).toThrow();
  });
});

describe('MothershipCreationRollsSchema', () => {
  it('parses dice as rolled', () => {
    const result = MothershipCreationRollsSchema.parse(validRolls);
    expect(result.strength).toEqual([7, 4]);
  });

  it('rejects a sum where dice are expected', () => {
    // `strength: 36` would discard the doubles information the pair keeps.
    expect(() =>
      MothershipCreationRollsSchema.parse({ ...validRolls, strength: 36 }),
    ).toThrow();
  });

  it('rejects a die below 1', () => {
    expect(() =>
      MothershipCreationRollsSchema.parse({ ...validRolls, speed: [0, 4] }),
    ).toThrow();
  });

  it('rejects more than two dice for one roll', () => {
    expect(() =>
      MothershipCreationRollsSchema.parse({ ...validRolls, combat: [1, 2, 3] }),
    ).toThrow();
  });

  it('requires every roll made at creation', () => {
    const { credits: _c, ...missingCredits } = validRolls;
    expect(() =>
      MothershipCreationRollsSchema.parse(missingCredits),
    ).toThrow();
  });
});

describe('MothershipCharacterSheetSchema', () => {
  it('parses a fully populated sheet', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse(validSheet),
    ).not.toThrow();
  });

  it('treats pronouns, notes, trinket, patch, and traumaResponse as optional', () => {
    const {
      pronouns: _p,
      notes: _n,
      trinket: _t,
      patch: _pa,
      traumaResponse: _tr,
      ...rest
    } = validSheet;
    const result = MothershipCharacterSheetSchema.parse(rest);
    expect(result.pronouns).toBeUndefined();
    expect(result.notes).toBeUndefined();
    expect(result.traumaResponse).toBeUndefined();
  });

  it('requires creationRolls', () => {
    const { creationRolls: _r, ...rest } = validSheet;
    expect(() => MothershipCharacterSheetSchema.parse(rest)).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse({ ...validSheet, name: '' }),
    ).toThrow();
  });

  it('rejects a name longer than 100 characters', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse({
        ...validSheet,
        name: 'x'.repeat(101),
      }),
    ).toThrow();
  });

  describe('fields removed in M7.6', () => {
    // These moved to campaign state or were duplicates of a pool ceiling. They
    // are not merely unused — a sheet still carrying them is a sheet written by
    // something that has not been updated, and the values would be a second,
    // divergent authority.
    it.each(['level', 'stats', 'saves', 'maxHp', 'maxStress', 'skills'])(
      'no longer produces %s',
      (field) => {
        const parsed = MothershipCharacterSheetSchema.parse({
          ...validSheet,
          [field]: 'anything',
        });
        expect(parsed).not.toHaveProperty(field);
      },
    );
  });

  describe('creationChoices', () => {
    it('requires a chosen Stat for an Android', () => {
      expect(() =>
        MothershipCharacterSheetSchema.parse({
          ...validSheet,
          class: 'android',
        }),
      ).toThrow(/chosen Stat must be recorded/);
    });

    it('requires a chosen Stat for a Scientist', () => {
      expect(() =>
        MothershipCharacterSheetSchema.parse({
          ...validSheet,
          class: 'scientist',
        }),
      ).toThrow(/chosen Stat must be recorded/);
    });

    it('accepts an Android that records one', () => {
      expect(() =>
        MothershipCharacterSheetSchema.parse({
          ...validSheet,
          class: 'android',
          creationChoices: { adjustedStat: 'speed' },
        }),
      ).not.toThrow();
    });

    it('rejects a chosen Stat on a Marine, whose adjustments are fixed', () => {
      expect(() =>
        MothershipCharacterSheetSchema.parse({
          ...validSheet,
          creationChoices: { adjustedStat: 'speed' },
        }),
      ).toThrow(/entirely fixed/);
    });

    it('rejects a Save where a Stat is expected', () => {
      expect(() =>
        MothershipCharacterSheetSchema.parse({
          ...validSheet,
          class: 'android',
          creationChoices: { adjustedStat: 'fear' },
        }),
      ).toThrow();
    });
  });
});
