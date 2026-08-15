import type { MothershipCharacterSheet } from './character-sheet.schema';

export type ResourcePool = { current: number; max: number | null };

/** `resourcePools[owner][poolName]` — one owner's worth of pools. */
export type OwnedResourcePools = Record<string, Record<string, ResourcePool>>;

/**
 * Derives the resource pools the Mothership campaign state must carry for a
 * player character: HP and stress. Returned nested under the character's
 * entity id, matching `campaign_state.data.resourcePools`. Called at character
 * creation time so the pools exist before synthesis runs — synthesis is not
 * expected to re-derive them.
 *
 * The full ten-pool derivation (stats and saves as pools, wounds, credits,
 * class adjustments) lands in M7.6 Part 2; this is the nesting change only.
 */
export function deriveMothershipCharacterResourcePools(
  sheet: MothershipCharacterSheet,
): OwnedResourcePools {
  return {
    [sheet.entityId]: {
      hp: { current: sheet.maxHp, max: sheet.maxHp },
      stress: { current: 0, max: sheet.maxStress },
    },
  };
}
