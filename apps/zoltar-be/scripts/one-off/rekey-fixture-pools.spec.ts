import { describe, expect, it } from 'vitest';

import {
  rekeyResourcePools,
  stringifyFixture,
} from './rekey-fixture-pools.core';

const KNOWN = [
  'alvarez',
  'burned_out_medic',
  'decommissioned_android',
  'hull_breach_cascade',
  'veridian_contractor_alpha',
];

describe('rekeyResourcePools', () => {
  it('splits a composite key at the declared owner', () => {
    const { pools } = rekeyResourcePools(
      { alvarez_hp: { current: 20, max: 20 } },
      KNOWN,
    );
    expect(pools).toEqual({ alvarez: { hp: { current: 20, max: 20 } } });
  });

  it('prefers the longest matching owner', () => {
    // `veridian_contractor_alpha_hp` must not resolve to a shorter declared
    // prefix and leave `alpha_hp` as the pool name.
    const { pools } = rekeyResourcePools(
      { veridian_contractor_alpha_hp: { current: 15, max: 15 } },
      [...KNOWN, 'veridian_contractor'],
    );
    expect(pools).toEqual({
      veridian_contractor_alpha: { hp: { current: 15, max: 15 } },
    });
  });

  it('keeps a multi-word pool name intact', () => {
    const { pools } = rekeyResourcePools(
      { burned_out_medic_supply_timer: { current: 6, max: 6 } },
      KNOWN,
    );
    expect(pools.burned_out_medic).toEqual({
      supply_timer: { current: 6, max: 6 },
    });
  });

  it('files an unresolvable key under _scenario, name unchanged', () => {
    const { pools } = rekeyResourcePools(
      {
        station_power_reserve: { current: 4, max: 4 },
        hull_breach_timer: { current: 5, max: 5 },
      },
      KNOWN,
    );
    expect(pools._scenario).toEqual({
      station_power_reserve: { current: 4, max: 4 },
      hull_breach_timer: { current: 5, max: 5 },
    });
  });

  it('does not attach hull_breach_timer to hull_breach_cascade', () => {
    // `hull_breach` is a proper prefix of a declared entity id, but the key is
    // `hull_breach_timer`, not `hull_breach_cascade_timer`. Longest-prefix
    // matching requires the separator, so the near-miss does not resolve — and
    // it should not, because whether the two are the same thing is unsettled.
    const { pools } = rekeyResourcePools(
      { hull_breach_timer: { current: 5, max: 5 } },
      KNOWN,
    );
    expect(pools.hull_breach_cascade).toBeUndefined();
    expect(pools._scenario).toHaveProperty('hull_breach_timer');
  });

  it('applies the android_memory_integrity override', () => {
    const { pools, decisions } = rekeyResourcePools(
      { android_memory_integrity: { current: 3, max: 3 } },
      KNOWN,
    );
    expect(pools.decommissioned_android).toEqual({
      memory_integrity: { current: 3, max: 3 },
    });
    expect(decisions[0]).toContain('override');
  });

  it('merges several pools of one owner', () => {
    const { pools } = rekeyResourcePools(
      {
        alvarez_hp: { current: 20, max: 20 },
        alvarez_stress: { current: 0, max: 3 },
        alvarez_armor: { current: 30, max: 30 },
      },
      KNOWN,
    );
    expect(Object.keys(pools.alvarez).sort()).toEqual([
      'armor',
      'hp',
      'stress',
    ]);
  });
});

describe('stringifyFixture', () => {
  it('escapes non-ASCII as \\uXXXX so the corpus bytes do not shift', () => {
    expect(stringifyFixture({ note: 'a — b' })).toBe(
      '{\n  "note": "a \\u2014 b"\n}\n',
    );
  });

  it('escapes DEL, matching the corpus encoding', () => {
    expect(stringifyFixture({ x: '\u007f' })).toBe('{\n  "x": "\\u007f"\n}\n');
  });

  it('leaves ASCII alone and ends with exactly one newline', () => {
    expect(stringifyFixture({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
