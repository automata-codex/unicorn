import type { MothershipCharacterSheet } from './character-sheet.schema';

export type ResourcePool = { current: number; max: number | null };

/**
 * Derives the resource pools the Mothership campaign state must carry for a
 * player character: HP and stress. Names follow the canonical
 * `{entity_id}_{pool_name}` convention. Called at character creation time so
 * the pools exist in `campaign_state.data.resourcePools` before synthesis
 * runs — synthesis is not expected to re-derive them.
 */
export function deriveMothershipCharacterResourcePools(
  sheet: MothershipCharacterSheet,
): Record<string, ResourcePool> {
  return {
    [`${sheet.entityId}_hp`]: {
      current: sheet.currentHp,
      max: sheet.maxHp,
    },
    [`${sheet.entityId}_stress`]: {
      current: sheet.stress.current,
      max: sheet.stress.max,
    },
  };
}
