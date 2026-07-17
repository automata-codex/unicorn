import type { MothershipCampaignState } from '@uv/game-systems';
import type { ValidationResult } from './session.validator';

/**
 * Pure fold step for a single turn: merges validated state-change deltas
 * into campaign state, and Claude's `gmUpdates.npcStates` into
 * `gm_context.blob.narrative.npcAgendas` (Claude wins on key collision).
 * No I/O — callers own reading the prior state/blob and persisting the
 * results. This is also the fold step replay (M7.3) threads forward
 * through the event log turn by turn.
 */
export function applyValidatedTurn(input: {
  priorCampaignState: MothershipCampaignState;
  priorGmContextBlob: Record<string, unknown>;
  applied: ValidationResult['applied'];
  npcStates: Record<string, string>;
}): {
  newCampaignState: MothershipCampaignState;
  newGmContextBlob: Record<string, unknown>;
} {
  const { priorCampaignState, priorGmContextBlob, applied, npcStates } = input;

  const newCampaignState: MothershipCampaignState = {
    schemaVersion: priorCampaignState.schemaVersion,
    resourcePools: {
      ...priorCampaignState.resourcePools,
      ...applied.resourcePools,
    },
    entities: { ...priorCampaignState.entities, ...applied.entities },
    flags: { ...priorCampaignState.flags, ...applied.flags },
    scenarioState: {
      ...priorCampaignState.scenarioState,
      ...applied.scenarioState,
    },
    worldFacts: { ...priorCampaignState.worldFacts, ...applied.worldFacts },
  };

  const priorNarrative =
    (priorGmContextBlob.narrative as Record<string, unknown> | undefined) ?? {};
  const priorAgendas =
    (priorNarrative.npcAgendas as Record<string, string> | undefined) ?? {};

  const newGmContextBlob: Record<string, unknown> = {
    ...priorGmContextBlob,
    narrative: {
      ...priorNarrative,
      npcAgendas: { ...priorAgendas, ...npcStates },
    },
  };

  return { newCampaignState, newGmContextBlob };
}
