import { describe, expect, it } from 'vitest';

import {
  MothershipCampaignStateSchema,
  emptyMothershipState,
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
        dr_chen_hp: { current: 8, max: 10 },
        dr_chen_stress: { current: 2, max: 20 },
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
    expect(result.resourcePools.dr_chen_hp.current).toBe(8);
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
        resourcePools: { dr_chen_hp: { current: 'eight', max: 10 } },
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
