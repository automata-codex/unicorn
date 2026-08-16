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
    characterState: {},
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
        resourcePools: { dr_chen: { hp: { current: 5, max: 10 } } },
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
        resourcePools: { dr_chen: { hp: { current: 5, max: 10 } } },
      };
      const snapshot = structuredClone(priorCampaignState);

      applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: {
          ...emptyApplied(),
          resourcePools: { dr_chen: { hp: { current: 2, max: 10 } } },
        },
        npcStates: {},
      });

      expect(priorCampaignState).toEqual(snapshot);
    });

    it('merges resourcePools, preserving owners not mentioned in applied', () => {
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        resourcePools: {
          dr_chen: { hp: { current: 5, max: 10 } },
          vasquez: { stress: { current: 3, max: null } },
        },
      };

      const { newCampaignState } = applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: {
          ...emptyApplied(),
          resourcePools: { dr_chen: { hp: { current: 2, max: 10 } } },
        },
        npcStates: {},
      });

      expect(newCampaignState.resourcePools).toEqual({
        dr_chen: { hp: { current: 2, max: 10 } },
        vasquez: { stress: { current: 3, max: null } },
      });
    });

    it('writing one pool leaves that owner’s other pools intact', () => {
      // The deep-merge regression this nesting introduces. A shallow spread
      // over the owner key replaces the owner's entire pool set with whichever
      // single pool the turn wrote — ten pools become one, silently.
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        resourcePools: {
          dr_chen: {
            hp: { current: 18, max: 20 },
            wounds: { current: 0, max: 2 },
            stress: { current: 4, max: null },
            strength: { current: 35, max: 35 },
            speed: { current: 30, max: 30 },
            intellect: { current: 45, max: 45 },
            combat: { current: 33, max: 33 },
            sanity: { current: 25, max: 25 },
            fear: { current: 20, max: 20 },
            body: { current: 28, max: 28 },
            credits: { current: 120, max: null },
          },
        },
      };

      const { newCampaignState } = applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: {
          ...emptyApplied(),
          resourcePools: { dr_chen: { hp: { current: 12, max: 20 } } },
        },
        npcStates: {},
      });

      expect(newCampaignState.resourcePools.dr_chen).toEqual({
        ...priorCampaignState.resourcePools.dr_chen,
        hp: { current: 12, max: 20 },
      });
      expect(Object.keys(newCampaignState.resourcePools.dr_chen)).toHaveLength(
        11,
      );
    });

    it('adds a pool to an owner that has none yet', () => {
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        resourcePools: { dr_chen: { hp: { current: 5, max: 10 } } },
      };

      const { newCampaignState } = applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: {
          ...emptyApplied(),
          resourcePools: {
            _scenario: { hull_breach_timer: { current: 5, max: 5 } },
          },
        },
        npcStates: {},
      });

      expect(newCampaignState.resourcePools).toEqual({
        dr_chen: { hp: { current: 5, max: 10 } },
        _scenario: { hull_breach_timer: { current: 5, max: 5 } },
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

    it('carries characterState through a turn untouched', () => {
      // Nothing writes it until Part 4. The requirement on this commit is that
      // a turn does not silently *lose* it — which is exactly what a fold that
      // rebuilds the state object from named fields does by omission.
      const priorCampaignState: MothershipCampaignState = {
        ...emptyMothershipState(),
        resourcePools: { dr_chen: { hp: { current: 5, max: 10 } } },
        characterState: {
          dr_chen: {
            conditions: [{ condition: 'frightened', parameter: 'the vent' }],
            skills: [{ skill: 'Firearms', tier: 'trained' }],
            equipment: [{ item: 'Revolver', charges: 12 }],
            wornArmor: null,
            minimumStress: 3,
            bleeding: 2,
            pendingDeathSave: 4,
          },
        },
      };

      const { newCampaignState } = applyValidatedTurn({
        priorCampaignState,
        priorGmContextBlob: {},
        applied: {
          ...emptyApplied(),
          resourcePools: { dr_chen: { hp: { current: 2, max: 10 } } },
        },
        npcStates: {},
      });

      expect(newCampaignState.characterState).toEqual(
        priorCampaignState.characterState,
      );
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
