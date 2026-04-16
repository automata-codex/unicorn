import { describe, expect, it } from 'vitest';

import type { MothershipCharacterSheet } from './character-sheet.schema';
import { deriveMothershipCharacterResourcePools } from './character-pools';

const baseSheet: MothershipCharacterSheet = {
  entityId: 'vasquez',
  name: 'Vasquez',
  class: 'marine',
  level: 1,
  stats: {
    strength: 55,
    speed: 40,
    intellect: 35,
    combat: 60,
    instinct: 45,
    sanity: 50,
  },
  saves: { fear: 30, body: 40, armor: 10, armorMax: 20 },
  currentHp: 12,
  maxHp: 15,
  stress: { current: 2, max: 20 },
  skills: [],
  equipment: [],
};

describe('deriveMothershipCharacterResourcePools', () => {
  it('produces {entity_id}_hp and {entity_id}_stress pools', () => {
    const pools = deriveMothershipCharacterResourcePools(baseSheet);
    expect(pools).toEqual({
      vasquez_hp: { current: 12, max: 15 },
      vasquez_stress: { current: 2, max: 20 },
    });
  });

  it('uses the entityId, not the display name, as the pool prefix', () => {
    const pools = deriveMothershipCharacterResourcePools({
      ...baseSheet,
      entityId: 'dr_chen',
      name: 'Dr. Chen',
    });
    expect(Object.keys(pools).sort()).toEqual(['dr_chen_hp', 'dr_chen_stress']);
  });

  it('carries current/max through verbatim, even at extremes', () => {
    const pools = deriveMothershipCharacterResourcePools({
      ...baseSheet,
      currentHp: 0,
      maxHp: 1,
      stress: { current: 0, max: 1 },
    });
    expect(pools.vasquez_hp).toEqual({ current: 0, max: 1 });
    expect(pools.vasquez_stress).toEqual({ current: 0, max: 1 });
  });
});
