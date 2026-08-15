import { describe, expect, it } from 'vitest';

import {
  MothershipCampaignStateSchema,
  SCENARIO_POOL_OWNER,
  emptyMothershipState,
  isInvalidReservedPoolOwner,
} from './campaign-state.schema';

describe('MothershipCampaignStateSchema', () => {
  it('parses a minimally populated state and applies map defaults', () => {
    const result = MothershipCampaignStateSchema.parse({ schemaVersion: 1 });
    expect(result.resourcePools).toEqual({});
    expect(result.entities).toEqual({});
    expect(result.flags).toEqual({});
    expect(result.scenarioState).toEqual({});
    expect(result.worldFacts).toEqual({});
  });

  it('parses a fully populated state', () => {
    const result = MothershipCampaignStateSchema.parse({
      schemaVersion: 1,
      resourcePools: {
        dr_chen: {
          hp: { current: 8, max: 10 },
          stress: { current: 2, max: 20 },
        },
        _scenario: { hull_breach_timer: { current: 5, max: 5 } },
      },
      entities: {
        dr_chen: { visible: true, status: 'alive', npcState: 'Cooperative' },
      },
      flags: {
        adventure_complete: { value: false, trigger: 'Escape the vessel.' },
      },
      scenarioState: {
        oxygen: { current: 80, max: 100, note: 'bleeding slowly' },
      },
      worldFacts: { bridge_display: 'ERROR 0x4A' },
    });
    expect(result.resourcePools.dr_chen.hp.current).toBe(8);
    expect(result.resourcePools._scenario.hull_breach_timer.current).toBe(5);
    expect(result.entities.dr_chen.npcState).toBe('Cooperative');
    expect(result.scenarioState.oxygen.note).toBe('bleeding slowly');
  });

  it('rejects a schemaVersion other than 1', () => {
    expect(() =>
      MothershipCampaignStateSchema.parse({ schemaVersion: 2 }),
    ).toThrow();
  });

  it('rejects a malformed resource pool entry', () => {
    expect(() =>
      MothershipCampaignStateSchema.parse({
        schemaVersion: 1,
        resourcePools: { dr_chen: { hp: { current: 'eight', max: 10 } } },
      }),
    ).toThrow();
  });

  it('rejects a flat pool map left over from the pre-M7.6 shape', () => {
    expect(() =>
      MothershipCampaignStateSchema.parse({
        schemaVersion: 1,
        resourcePools: { dr_chen_hp: { current: 8, max: 10 } },
      }),
    ).toThrow();
  });

  it('rejects a flag missing its trigger', () => {
    expect(() =>
      MothershipCampaignStateSchema.parse({
        schemaVersion: 1,
        flags: { adventure_complete: { value: false } },
      }),
    ).toThrow();
  });
});

describe('isInvalidReservedPoolOwner', () => {
  it('accepts the reserved scenario owner', () => {
    expect(isInvalidReservedPoolOwner(SCENARIO_POOL_OWNER)).toBe(false);
  });

  it('rejects any other leading-underscore owner', () => {
    expect(isInvalidReservedPoolOwner('_station')).toBe(true);
    expect(isInvalidReservedPoolOwner('_')).toBe(true);
  });

  it('leaves ordinary entity ids alone', () => {
    expect(isInvalidReservedPoolOwner('dr_chen')).toBe(false);
    expect(isInvalidReservedPoolOwner('scenario')).toBe(false);
  });
});

describe('emptyMothershipState', () => {
  it('produces a state that passes schema validation', () => {
    expect(() =>
      MothershipCampaignStateSchema.parse(emptyMothershipState()),
    ).not.toThrow();
  });

  it('returns independent instances', () => {
    const a = emptyMothershipState();
    const b = emptyMothershipState();
    a.flags.test = { value: true, trigger: 'x' };
    expect(b.flags.test).toBeUndefined();
  });
});
