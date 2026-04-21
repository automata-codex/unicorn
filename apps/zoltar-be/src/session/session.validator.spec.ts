import {
  emptyMothershipState,
  getMothershipPoolDefinition,
  type MothershipCampaignState,
} from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import { validateStateChanges } from './session.validator';

const poolDef = getMothershipPoolDefinition;

function stateWith(
  overrides: Partial<MothershipCampaignState>,
): MothershipCampaignState {
  return { ...emptyMothershipState(), ...overrides };
}

describe('validateStateChanges — resourcePools', () => {
  it('initializes an unknown pool when the delta is positive', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: { xenomorph_hp: { delta: 12 } } },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.resourcePools).toEqual({
      xenomorph_hp: { current: 12, max: null },
    });
  });

  it('rejects an unknown pool when the delta is non-positive', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: { xenomorph_hp: { delta: -3 } } },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.resourcePools).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].path).toBe('resourcePools.xenomorph_hp');
    expect(result.rejections[0].reason).toMatch(/bootstrap/i);
  });

  it('rejects spending a min:0 pool below zero without applying a partial delta', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: { dr_chen_stress: { delta: -5 } } },
      currentData: stateWith({
        resourcePools: { dr_chen_stress: { current: 3, max: null } },
      }),
      poolDef,
    });
    expect(result.applied.resourcePools).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/spend more than available/i);
  });

  it('reports the death_save_required threshold when HP crosses zero downward', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: { dr_chen_hp: { delta: -6 } } },
      currentData: stateWith({
        resourcePools: { dr_chen_hp: { current: 5, max: 10 } },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.resourcePools.dr_chen_hp).toEqual({
      current: -1,
      max: 10,
    });
    expect(result.thresholds).toEqual([
      { pool: 'dr_chen_hp', finalValue: -1, effect: 'death_save_required' },
    ]);
  });

  it('rejects a delta that would drop a pool below its non-zero minimum', () => {
    const customPoolDef = () => ({ min: 5, max: null, thresholds: [] });
    const result = validateStateChanges({
      proposed: { resourcePools: { reactor_coolant: { delta: -4 } } },
      currentData: stateWith({
        resourcePools: { reactor_coolant: { current: 8, max: null } },
      }),
      poolDef: customPoolDef,
    });
    expect(result.applied.resourcePools).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/below minimum \(5\)/);
  });

  it('rejects a delta that would push a pool above its maximum', () => {
    const customPoolDef = () => ({ min: null, max: 100, thresholds: [] });
    const result = validateStateChanges({
      proposed: { resourcePools: { reactor_coolant: { delta: 30 } } },
      currentData: stateWith({
        resourcePools: { reactor_coolant: { current: 80, max: 100 } },
      }),
      poolDef: customPoolDef,
    });
    expect(result.applied.resourcePools).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/exceed maximum \(100\)/);
  });

  it('does not fire the HP threshold when healing from -1 to +2 (already past it)', () => {
    const result = validateStateChanges({
      proposed: { resourcePools: { dr_chen_hp: { delta: 3 } } },
      currentData: stateWith({
        resourcePools: { dr_chen_hp: { current: -1, max: 10 } },
      }),
      poolDef,
    });
    expect(result.applied.resourcePools.dr_chen_hp).toEqual({
      current: 2,
      max: 10,
    });
    expect(result.thresholds).toEqual([]);
  });
});

describe('validateStateChanges — entities', () => {
  it('accepts a status=dead transition without auto-zeroing prefixed pools', () => {
    const result = validateStateChanges({
      proposed: { entities: { dr_chen: { status: 'dead' } } },
      currentData: stateWith({
        entities: {
          dr_chen: { visible: true, status: 'alive', npcState: 'Stressed' },
        },
        resourcePools: { dr_chen_hp: { current: 5, max: 10 } },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.entities.dr_chen).toEqual({
      visible: true,
      status: 'dead',
      npcState: 'Stressed',
    });
    expect(result.applied.resourcePools).toEqual({});
  });

  it('initializes an absent entity with sensible defaults', () => {
    const result = validateStateChanges({
      proposed: { entities: { corporate_spy_1: { status: 'alive' } } },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.entities.corporate_spy_1).toEqual({
      visible: true,
      status: 'alive',
    });
  });

  it('rejects an invalid status string', () => {
    const result = validateStateChanges({
      proposed: { entities: { dr_chen: { status: 'hibernating' } } },
      currentData: stateWith({
        entities: { dr_chen: { visible: true, status: 'alive' } },
      }),
      poolDef,
    });
    expect(result.applied.entities).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].path).toBe('entities.dr_chen');
  });
});

describe('validateStateChanges — flags', () => {
  it('rejects a new flag that is missing a trigger', () => {
    const result = validateStateChanges({
      proposed: { flags: { secret_door_found: { value: true } } },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.flags).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/trigger/i);
  });

  it('applies a new flag that carries a trigger', () => {
    const result = validateStateChanges({
      proposed: {
        flags: {
          secret_door_found: {
            value: true,
            trigger: 'Player notices the maintenance panel',
          },
        },
      },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.flags.secret_door_found).toEqual({
      value: true,
      trigger: 'Player notices the maintenance panel',
    });
  });

  it('preserves the original trigger when Claude provides one on an existing flag', () => {
    const result = validateStateChanges({
      proposed: {
        flags: {
          reactor_primed: { value: true, trigger: 'mutated replacement text' },
        },
      },
      currentData: stateWith({
        flags: {
          reactor_primed: {
            value: false,
            trigger: 'Engineer toggles the primer switch',
          },
        },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.flags.reactor_primed).toEqual({
      value: true,
      trigger: 'Engineer toggles the primer switch',
    });
  });
});

describe('validateStateChanges — scenarioState', () => {
  it('rejects a scenarioState key that was not authored at synthesis time', () => {
    const result = validateStateChanges({
      proposed: { scenarioState: { brand_new_counter: { current: 3 } } },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.applied.scenarioState).toEqual({});
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/synthesis time/i);
  });

  it('overwrites current while preserving max and note on an existing key', () => {
    const result = validateStateChanges({
      proposed: { scenarioState: { oxygen: { current: 40 } } },
      currentData: stateWith({
        scenarioState: {
          oxygen: { current: 80, max: 100, note: 'Life support reserve' },
        },
      }),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.scenarioState.oxygen).toEqual({
      current: 40,
      max: 100,
      note: 'Life support reserve',
    });
  });
});

describe('validateStateChanges — worldFacts', () => {
  it('applies worldFacts verbatim without rejecting', () => {
    const result = validateStateChanges({
      proposed: {
        worldFacts: {
          captains_log_subject: 'Outbreak on Deck 4',
          mess_hall_graffiti: 'THEY HEAR US',
        },
      },
      currentData: emptyMothershipState(),
      poolDef,
    });
    expect(result.rejections).toEqual([]);
    expect(result.applied.worldFacts).toEqual({
      captains_log_subject: 'Outbreak on Deck 4',
      mess_hall_graffiti: 'THEY HEAR US',
    });
  });
});

describe('validateStateChanges — mixed batch', () => {
  it('partitions valid and invalid entries without throwing', () => {
    const result = validateStateChanges({
      proposed: {
        resourcePools: {
          dr_chen_hp: { delta: -2 },
          xenomorph_hp: { delta: -5 },
        },
        flags: {
          unknown_flag: { value: true },
          known_flag: { value: true },
        },
        worldFacts: { corridor_smell: 'ozone and burnt hair' },
      },
      currentData: stateWith({
        resourcePools: { dr_chen_hp: { current: 5, max: 10 } },
        flags: {
          known_flag: { value: false, trigger: 'airlock cycles' },
        },
      }),
      poolDef,
    });

    expect(result.applied.resourcePools).toEqual({
      dr_chen_hp: { current: 3, max: 10 },
    });
    expect(result.applied.flags).toEqual({
      known_flag: { value: true, trigger: 'airlock cycles' },
    });
    expect(result.applied.worldFacts).toEqual({
      corridor_smell: 'ozone and burnt hair',
    });
    expect(result.rejections).toHaveLength(2);
    expect(result.rejections.map((r) => r.path).sort()).toEqual([
      'flags.unknown_flag',
      'resourcePools.xenomorph_hp',
    ]);
  });
});
