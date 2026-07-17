import {
  emptyMothershipState,
  type MothershipCampaignState,
} from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import { applyValidatedTurn } from './session.applier';

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

describe('applyValidatedTurn', () => {
  describe('campaign state merge', () => {
    it('returns an equivalent state when applied is empty', () => {
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        resourcePools: { dr_chen_hp: { current: 5, max: 10 } },
        worldFacts: { corridor_smell: 'ozone' },
      };

      const { newCampaignState } = applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: emptyApplied(),
        npcStates: {},
      });

      expect(newCampaignState).toEqual(priorCampaignState);
    });

    it('does not mutate the input state', () => {
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        resourcePools: { dr_chen_hp: { current: 5, max: 10 } },
      };
      const snapshot = structuredClone(priorCampaignState);

      applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: {
          ...emptyApplied(),
          resourcePools: { dr_chen_hp: { current: 2, max: 10 } },
        },
        npcStates: {},
      });

      expect(priorCampaignState).toEqual(snapshot);
    });

    it('shallow-merges resourcePools, preserving keys not mentioned in applied', () => {
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        resourcePools: {
          dr_chen_hp: { current: 5, max: 10 },
          vasquez_stress: { current: 3, max: null },
        },
      };

      const { newCampaignState } = applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: {
          ...emptyApplied(),
          resourcePools: { dr_chen_hp: { current: 2, max: 10 } },
        },
        npcStates: {},
      });

      expect(newCampaignState.resourcePools).toEqual({
        dr_chen_hp: { current: 2, max: 10 },
        vasquez_stress: { current: 3, max: null },
      });
    });

    it('shallow-merges entities, preserving keys not mentioned in applied', () => {
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        entities: {
          dr_chen: { visible: true, status: 'alive', npcState: 'Stressed' },
          corporate_spy_1: { visible: false, status: 'unknown' },
        },
      };

      const { newCampaignState } = applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: {
          ...emptyApplied(),
          entities: {
            dr_chen: { visible: true, status: 'dead', npcState: 'Stressed' },
          },
        },
        npcStates: {},
      });

      expect(newCampaignState.entities).toEqual({
        dr_chen: { visible: true, status: 'dead', npcState: 'Stressed' },
        corporate_spy_1: { visible: false, status: 'unknown' },
      });
    });

    it('carries schemaVersion through unchanged', () => {
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        schemaVersion: 1,
      };

      const { newCampaignState } = applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: emptyApplied(),
        npcStates: {},
      });

      expect(newCampaignState.schemaVersion).toBe(1);
    });
  });

  describe('gm_context blob merge', () => {
    function blobWithAgendas(
      npcAgendas: Record<string, string>,
    ): Record<string, unknown> {
      return {
        narrative: {
          location: 'Corridor 7',
          atmosphere: 'Silent',
          npcAgendas,
          hiddenTruth: 'Reactor is primed',
          oracleConnections: 'None',
        },
      };
    }

    it('merges new npcStates keys into existing npcAgendas', () => {
      const priorGmContextBlob = blobWithAgendas({
        dr_chen: 'Initial agenda',
      });

      const { newGmContextBlob } = applyValidatedTurn({
        priorCampaignState: emptyMothershipState(),
        priorGmContextBlob,
        applied: emptyApplied(),
        npcStates: { corporate_spy_1: 'Watch the player' },
      });

      const narrative = newGmContextBlob.narrative as Record<string, unknown>;
      expect(narrative.npcAgendas).toEqual({
        dr_chen: 'Initial agenda',
        corporate_spy_1: 'Watch the player',
      });
    });

    it('overwrites existing npcAgendas on key collision — Claude wins', () => {
      const priorGmContextBlob = blobWithAgendas({
        dr_chen: 'Initial agenda',
        corporate_spy_1: 'Watch the player',
      });

      const { newGmContextBlob } = applyValidatedTurn({
        priorCampaignState: emptyMothershipState(),
        priorGmContextBlob,
        applied: emptyApplied(),
        npcStates: { dr_chen: 'Updated agenda — fleeing' },
      });

      const narrative = newGmContextBlob.narrative as Record<string, unknown>;
      expect(narrative.npcAgendas).toEqual({
        dr_chen: 'Updated agenda — fleeing',
        corporate_spy_1: 'Watch the player',
      });
    });

    it('produces a value-equal blob when npcStates is empty', () => {
      const priorGmContextBlob = blobWithAgendas({
        dr_chen: 'Original agenda',
      });

      const { newGmContextBlob } = applyValidatedTurn({
        priorCampaignState: emptyMothershipState(),
        priorGmContextBlob,
        applied: emptyApplied(),
        npcStates: {},
      });

      expect(newGmContextBlob).toEqual(priorGmContextBlob);
    });

    it('preserves non-narrative fields untouched', () => {
      const priorGmContextBlob: Record<string, unknown> = {
        ...blobWithAgendas({ dr_chen: 'Original agenda' }),
        entities: [{ id: 'dr_chen', type: 'npc', visible: true, tags: [] }],
        structured: { flags: { reactor_primed: { value: true, trigger: '' } } },
      };

      const { newGmContextBlob } = applyValidatedTurn({
        priorCampaignState: emptyMothershipState(),
        priorGmContextBlob,
        applied: emptyApplied(),
        npcStates: { dr_chen: 'Updated agenda' },
      });

      expect(newGmContextBlob.entities).toEqual(priorGmContextBlob.entities);
      expect(newGmContextBlob.structured).toEqual(
        priorGmContextBlob.structured,
      );
    });

    it('preserves narrative fields other than npcAgendas', () => {
      const priorGmContextBlob = blobWithAgendas({
        dr_chen: 'Original agenda',
      });

      const { newGmContextBlob } = applyValidatedTurn({
        priorCampaignState: emptyMothershipState(),
        priorGmContextBlob,
        applied: emptyApplied(),
        npcStates: { dr_chen: 'Updated agenda' },
      });

      const narrative = newGmContextBlob.narrative as Record<string, unknown>;
      expect(narrative.location).toBe('Corridor 7');
      expect(narrative.hiddenTruth).toBe('Reactor is primed');
    });

    it('defaults to an empty npcAgendas map when the prior blob has no narrative', () => {
      const { newGmContextBlob } = applyValidatedTurn({
        priorCampaignState: emptyMothershipState(),
        priorGmContextBlob: {},
        applied: emptyApplied(),
        npcStates: { dr_chen: 'First agenda' },
      });

      const narrative = newGmContextBlob.narrative as Record<string, unknown>;
      expect(narrative.npcAgendas).toEqual({ dr_chen: 'First agenda' });
    });
  });
});
