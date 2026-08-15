import { describe, expect, it } from 'vitest';

import {
  MOTHERSHIP_CHARACTER_POOL_NAMES,
  PoolDefinitionSchema,
  getMothershipPoolDefinition,
} from './pool-definitions';

describe('getMothershipPoolDefinition', () => {
  it('looks up the bare pool name, not a suffix of a composite key', () => {
    const def = getMothershipPoolDefinition('hp');
    expect(def.min).toBe(0);
    expect(def.max).toBeNull();
    expect(def.thresholds).toEqual([
      { value: 0, effect: 'death_save_required' },
    ]);
  });

  it('no longer matches a composite key by suffix', () => {
    // Pre-M7.6 this returned the HP definition. Pools are addressed as
    // resourcePools[owner][poolName] now, so a composite key never reaches
    // this function — and if one does, it is a bug worth surfacing as the
    // permissive default rather than silently honouring the old convention.
    const def = getMothershipPoolDefinition('dr_chen_hp');
    expect(def.min).toBeNull();
    expect(def.thresholds).toEqual([]);
  });

  it('returns the stress definition, floored at zero and uncapped', () => {
    const def = getMothershipPoolDefinition('stress');
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

  it('floors every character pool at zero', () => {
    for (const name of MOTHERSHIP_CHARACTER_POOL_NAMES) {
      expect(getMothershipPoolDefinition(name).min, name).toBe(0);
    }
  });

  it('caps no character pool at the system level — ceilings are per-instance', () => {
    for (const name of MOTHERSHIP_CHARACTER_POOL_NAMES) {
      expect(getMothershipPoolDefinition(name).max, name).toBeNull();
    }
  });

  it('carries no thresholds on any character pool except hp', () => {
    // hp's is the 5e-shaped `death_save_required`, removed in Part 5 alongside
    // the wounds chain that replaces it.
    for (const name of MOTHERSHIP_CHARACTER_POOL_NAMES) {
      if (name === 'hp') continue;
      expect(getMothershipPoolDefinition(name).thresholds, name).toEqual([]);
    }
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
