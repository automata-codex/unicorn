import { describe, expect, it } from 'vitest';

import {
  applyStatusDelta,
  type CampaignStateData,
  type CharacterStatus,
  classifySendError,
  deriveCharacterStatus,
  formatThresholdLine,
} from './play-helpers';

function stateWith(overrides: Partial<CampaignStateData>): CampaignStateData {
  return {
    resourcePools: {},
    entities: {},
    flags: {},
    scenarioState: {},
    worldFacts: {},
    schemaVersion: 1,
    ...overrides,
  };
}

describe('deriveCharacterStatus', () => {
  it('returns pool values when present', () => {
    const status = deriveCharacterStatus({
      state: stateWith({
        resourcePools: {
          dr_chen_hp: { current: 7, max: 10 },
          dr_chen_stress: { current: 2, max: 20 },
        },
      }),
      playerEntityId: 'dr_chen',
      fallbackMaxHp: 10,
      fallbackMaxStress: 20,
    });
    expect(status.hp).toEqual({ current: 7, max: 10 });
    expect(status.stress).toEqual({ current: 2, max: 20 });
    expect(status.conditions).toBe('');
  });

  it('falls back to character-sheet maxes when pool max is null', () => {
    const status = deriveCharacterStatus({
      state: stateWith({
        resourcePools: {
          dr_chen_hp: { current: 9, max: null },
        },
      }),
      playerEntityId: 'dr_chen',
      fallbackMaxHp: 10,
      fallbackMaxStress: 20,
    });
    expect(status.hp).toEqual({ current: 9, max: 10 });
    expect(status.stress).toEqual({ current: 0, max: 20 });
  });

  it('surfaces npcState as conditions when the entity carries one', () => {
    const status = deriveCharacterStatus({
      state: stateWith({
        entities: {
          dr_chen: {
            visible: true,
            status: 'alive',
            npcState: 'Bleeding, panicked',
          },
        },
      }),
      playerEntityId: 'dr_chen',
      fallbackMaxHp: 10,
      fallbackMaxStress: 20,
    });
    expect(status.conditions).toBe('Bleeding, panicked');
  });
});

describe('applyStatusDelta', () => {
  const previous: CharacterStatus = {
    hp: { current: 10, max: 10 },
    stress: { current: 0, max: 20 },
    conditions: '',
  };

  it('overwrites HP when applied.resourcePools carries the player HP key', () => {
    const next = applyStatusDelta({
      previous,
      playerEntityId: 'dr_chen',
      applied: {
        resourcePools: { dr_chen_hp: { current: 6, max: 10 } },
      },
    });
    expect(next.hp).toEqual({ current: 6, max: 10 });
    expect(next.stress).toEqual(previous.stress);
  });

  it('preserves previous values when the applied map does not mention them', () => {
    const next = applyStatusDelta({
      previous,
      playerEntityId: 'dr_chen',
      applied: { resourcePools: {} },
    });
    expect(next).toEqual(previous);
  });

  it('uses the previous max when applied pool max is null', () => {
    const next = applyStatusDelta({
      previous,
      playerEntityId: 'dr_chen',
      applied: {
        resourcePools: { dr_chen_hp: { current: 4, max: null } },
      },
    });
    expect(next.hp).toEqual({ current: 4, max: 10 });
  });

  it('updates conditions when the applied entity carries a new npcState', () => {
    const next = applyStatusDelta({
      previous,
      playerEntityId: 'dr_chen',
      applied: {
        entities: {
          dr_chen: { visible: true, status: 'alive', npcState: 'Hunted' },
        },
      },
    });
    expect(next.conditions).toBe('Hunted');
  });
});

describe('formatThresholdLine', () => {
  it('capitalizes the entity id and unsnakes the effect', () => {
    const line = formatThresholdLine({
      pool: 'dr_chen_hp',
      finalValue: 0,
      effect: 'death_save_required',
    });
    expect(line).toBe('Dr Chen Hp at 0 — death save required');
  });
});

describe('classifySendError', () => {
  it('returns null on a 2xx response', () => {
    expect(classifySendError({ status: 200 })).toBeNull();
  });

  it('maps 409 to precondition', () => {
    expect(classifySendError({ status: 409 })).toBe('precondition');
  });

  it('maps 502 + body.error = gm_correction_failed to the distinct code', () => {
    expect(
      classifySendError({
        status: 502,
        body: { error: 'gm_correction_failed' },
      }),
    ).toBe('gm_correction_failed');
  });

  it('maps 502 without the distinct error code to gm_unavailable', () => {
    expect(classifySendError({ status: 502, body: null })).toBe(
      'gm_unavailable',
    );
  });

  it('maps anything else to unknown', () => {
    expect(classifySendError({ status: 500 })).toBe('unknown');
  });
});
