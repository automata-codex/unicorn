import { describe, expect, it } from 'vitest';

import {
  PoolDefinitionSchema,
  getMothershipPoolDefinition,
} from './pool-definitions';

describe('getMothershipPoolDefinition', () => {
  it('returns the HP definition for a pool with the _hp suffix', () => {
    const def = getMothershipPoolDefinition('dr_chen_hp');
    expect(def.min).toBeNull();
    expect(def.max).toBeNull();
    expect(def.thresholds).toEqual([
      { value: 0, effect: 'death_save_required' },
    ]);
  });

  it('returns the stress definition for a pool with the _stress suffix', () => {
    const def = getMothershipPoolDefinition('vasquez_stress');
    expect(def.min).toBe(0);
    expect(def.max).toBeNull();
    expect(def.thresholds).toEqual([]);
  });

  it('returns the permissive default for unknown pool names', () => {
    const def = getMothershipPoolDefinition('reactor_integrity');
    expect(def.min).toBeNull();
    expect(def.max).toBeNull();
    expect(def.thresholds).toEqual([]);
  });

  it('matches the suffix even when the entire name is the suffix', () => {
    const def = getMothershipPoolDefinition('_hp');
    expect(def.thresholds).toEqual([
      { value: 0, effect: 'death_save_required' },
    ]);
  });
});

describe('PoolDefinitionSchema', () => {
  it('rejects a threshold with a non-integer value', () => {
    const result = PoolDefinitionSchema.safeParse({
      min: null,
      max: null,
      thresholds: [{ value: 1.5, effect: 'death_save_required' }],
    });
    expect(result.success).toBe(false);
  });
});
