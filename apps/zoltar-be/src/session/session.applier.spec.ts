import {
  emptyMothershipState,
  type MothershipCampaignState,
} from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import { applyToCampaignState } from './session.applier';

import type { ValidationResult } from './session.validator';

function emptyApplied(): ValidationResult['applied'] {
  return {
    resourcePools: {},
    entities: {},
    flags: {},
    scenarioState: {},
    worldFacts: {},
  };
}

describe('applyToCampaignState', () => {
  it('returns an equivalent state when applied is empty', () => {
    const currentData: MothershipCampaignState = {
      ...emptyMothershipState(),
      resourcePools: { dr_chen_hp: { current: 5, max: 10 } },
      worldFacts: { corridor_smell: 'ozone' },
    };

    const result = applyToCampaignState({
      currentData,
      applied: emptyApplied(),
    });

    expect(result).toEqual(currentData);
  });

  it('does not mutate the input state', () => {
    const currentData: MothershipCampaignState = {
      ...emptyMothershipState(),
      resourcePools: { dr_chen_hp: { current: 5, max: 10 } },
    };
    const snapshot = structuredClone(currentData);

    applyToCampaignState({
      currentData,
      applied: {
        ...emptyApplied(),
        resourcePools: { dr_chen_hp: { current: 2, max: 10 } },
      },
    });

    expect(currentData).toEqual(snapshot);
  });

  it('shallow-merges resourcePools, preserving keys not mentioned in applied', () => {
    const currentData: MothershipCampaignState = {
      ...emptyMothershipState(),
      resourcePools: {
        dr_chen_hp: { current: 5, max: 10 },
        vasquez_stress: { current: 3, max: null },
      },
    };

    const result = applyToCampaignState({
      currentData,
      applied: {
        ...emptyApplied(),
        resourcePools: { dr_chen_hp: { current: 2, max: 10 } },
      },
    });

    expect(result.resourcePools).toEqual({
      dr_chen_hp: { current: 2, max: 10 },
      vasquez_stress: { current: 3, max: null },
    });
  });

  it('shallow-merges entities, preserving keys not mentioned in applied', () => {
    const currentData: MothershipCampaignState = {
      ...emptyMothershipState(),
      entities: {
        dr_chen: { visible: true, status: 'alive', npcState: 'Stressed' },
        corporate_spy_1: { visible: false, status: 'unknown' },
      },
    };

    const result = applyToCampaignState({
      currentData,
      applied: {
        ...emptyApplied(),
        entities: {
          dr_chen: { visible: true, status: 'dead', npcState: 'Stressed' },
        },
      },
    });

    expect(result.entities).toEqual({
      dr_chen: { visible: true, status: 'dead', npcState: 'Stressed' },
      corporate_spy_1: { visible: false, status: 'unknown' },
    });
  });

  it('carries schemaVersion through unchanged', () => {
    const currentData: MothershipCampaignState = {
      ...emptyMothershipState(),
      schemaVersion: 1,
    };

    const result = applyToCampaignState({
      currentData,
      applied: emptyApplied(),
    });

    expect(result.schemaVersion).toBe(1);
  });
});
