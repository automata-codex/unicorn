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
    resourcePools: mergeResourcePools(
      priorCampaignState.resourcePools,
      applied.resourcePools,
    ),
    // Carried forward verbatim. Nothing writes `characterState` until M7.6
    // Part 4 adds `stateChanges.characterState`, so the only requirement on
    // this commit is that a turn does not silently *lose* it — which a fold
    // that rebuilds the state object from named fields would do by omission.
    characterState: priorCampaignState.characterState,
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

/**
 * Merges validated pool writes into prior state **one owner deep**.
 *
 * A shallow spread was correct while pools were a flat map keyed by a
 * composite `{entity}_{pool}` string: every key was a whole pool. Nested,
 * each key is an owner's *entire* pool set, so a shallow spread replaces all
 * ten of a character's pools with whichever one the turn happened to write —
 * `{ hp: … }` clobbering stress, wounds, and every stat and save.
 *
 * This is also replay's fold step (`replay/reconstruct-state.ts`), so the bug
 * would be faithfully reproduced by replay rather than caught by it.
 */
function mergeResourcePools(
  prior: MothershipCampaignState['resourcePools'],
  applied: MothershipCampaignState['resourcePools'],
): MothershipCampaignState['resourcePools'] {
  const merged: MothershipCampaignState['resourcePools'] = { ...prior };
  for (const [owner, pools] of Object.entries(applied)) {
    merged[owner] = { ...(merged[owner] ?? {}), ...pools };
  }
  return merged;
}
