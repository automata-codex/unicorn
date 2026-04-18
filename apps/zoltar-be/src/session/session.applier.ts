import type { MothershipCampaignState } from '@uv/game-systems';

import type { ValidationResult } from './session.validator';

export function applyToCampaignState(input: {
  currentData: MothershipCampaignState;
  applied: ValidationResult['applied'];
}): MothershipCampaignState {
  const { currentData, applied } = input;
  return {
    schemaVersion: currentData.schemaVersion,
    resourcePools: { ...currentData.resourcePools, ...applied.resourcePools },
    entities: { ...currentData.entities, ...applied.entities },
    flags: { ...currentData.flags, ...applied.flags },
    scenarioState: { ...currentData.scenarioState, ...applied.scenarioState },
    worldFacts: { ...currentData.worldFacts, ...applied.worldFacts },
  };
}
