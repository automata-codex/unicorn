import { describe, expect, it } from 'vitest';

import {
  MothershipCharacterSheetSchema,
  MothershipClassEnum,
} from './character-sheet.schema';

const validSheet = {
  entityId: 'vasquez',
  name: 'Vasquez',
  pronouns: 'she/her',
  class: 'marine' as const,
  level: 2,
  stats: {
    strength: 55,
    speed: 40,
    intellect: 35,
    combat: 60,
    instinct: 45,
    sanity: 50,
  },
  saves: {
    fear: 30,
    body: 40,
    armor: 10,
    armorMax: 20,
  },
  maxHp: 15,
  maxStress: 20,
  skills: ['Military Training', 'Firearms'],
  equipment: ['Combat Armor', 'Pulse Rifle'],
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

describe('MothershipCharacterSheetSchema', () => {
  it('parses a fully populated sheet', () => {
    expect(() => MothershipCharacterSheetSchema.parse(validSheet)).not.toThrow();
  });

  it('defaults level to 1, skills to [], equipment to []', () => {
    const { level: _l, skills: _s, equipment: _e, ...rest } = validSheet;
    const result = MothershipCharacterSheetSchema.parse(rest);
    expect(result.level).toBe(1);
    expect(result.skills).toEqual([]);
    expect(result.equipment).toEqual([]);
  });

  it('treats pronouns and notes as optional', () => {
    const { pronouns: _p, notes: _n, ...rest } = validSheet;
    const result = MothershipCharacterSheetSchema.parse(rest);
    expect(result.pronouns).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse({ ...validSheet, name: '' }),
    ).toThrow();
  });

  it('rejects a stat outside 0..100', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse({
        ...validSheet,
        stats: { ...validSheet.stats, strength: 120 },
      }),
    ).toThrow();
  });

  it('rejects maxHp < 1', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse({ ...validSheet, maxHp: 0 }),
    ).toThrow();
  });

  it('rejects maxStress < 1', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse({ ...validSheet, maxStress: 0 }),
    ).toThrow();
  });

  it('rejects a level above 10', () => {
    expect(() =>
      MothershipCharacterSheetSchema.parse({ ...validSheet, level: 11 }),
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
});
