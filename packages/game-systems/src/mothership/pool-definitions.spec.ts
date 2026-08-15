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
  });

  it('fires no threshold on hp, and nothing replaces the 5e one', () => {
    // `death_save_required` at 0 HP was the D&D 5e rule. Mothership takes a
    // Wound and rolls the Wounds Table at zero; the Death Save arrives only at
    // Maximum Wounds. The transition is Warden-driven, and a threshold here
    // would announce a Death Save at every Wound rather than the last.
    expect(getMothershipPoolDefinition('hp').thresholds).toEqual([]);
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

  it('carries no thresholds on any character pool', () => {
    // None of the ten fires a mechanical event on crossing a number (§1.2).
    for (const name of MOTHERSHIP_CHARACTER_POOL_NAMES) {
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
