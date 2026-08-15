import { z } from 'zod';

export const PoolDefinitionSchema = z.object({
  min: z.number().int().nullable(),
  max: z.number().int().nullable(),
  thresholds: z
    .array(
      z.object({
        value: z.number().int(),
        effect: z.string(),
      }),
    )
    .default([]),
});

export type PoolDefinition = z.infer<typeof PoolDefinitionSchema>;

/**
 * A `PoolDefinition` is the *system-level* rule for a pool of a given name:
 * the floor and ceiling every instance obeys, plus any thresholds that fire on
 * crossing. It is not the instance's own ceiling — that is `ResourcePoolSchema`'s
 * `max`, which is per-character and mutable. Maximum Health is the hp pool's
 * instance `max`; Maximum Wounds is the wounds pool's.
 *
 * Since M7.6 pools are addressed as `resourcePools[owner][poolName]`, so the
 * lookup below is a direct match on the bare pool name. It used to match on a
 * `_hp` / `_stress` suffix because the address was a single composite key.
 */
const FLOOR_AT_ZERO: PoolDefinition = {
  min: 0,
  max: null,
  thresholds: [],
};

const HP_DEFINITION: PoolDefinition = {
  min: 0,
  max: null,
  // The `death_save_required` threshold is the D&D 5e rule, not Mothership's:
  // hitting 0 HP takes a Wound and rolls on the Wounds Table, and only the
  // *last* Wound calls for a Death Save. It is removed in M7.6 Part 5, together
  // with the prompt instructions that replace it. Removing it here would leave
  // a window with neither mechanism.
  thresholds: [{ value: 0, effect: 'death_save_required' }],
};

const STRESS_DEFINITION: PoolDefinition = {
  // `min: 0` is a floor this mechanism can express, not Mothership's actual
  // floor. Mothership floors Stress at *Minimum Stress*, which is per-character
  // and mutable (PSG §20.2) — `PoolDefinition.min` is a system constant and
  // cannot carry it. The real floor is enforced by prompt instruction against
  // the per-character value in campaign state. Do not "fix" this to match the
  // book; the mechanism cannot express the book.
  min: 0,
  // `max: null` for the same reason in the other direction. PSG §20.1 caps
  // Stress at 20, but it does not *reject* the overflow — it converts the
  // excess into a reduction of the most relevant Stat or Save, a cross-pool
  // effect no validator here supports. A `max: 20` would reject the write
  // instead of converting it, which is worse than not expressing the cap.
  max: null,
  thresholds: [],
};

const DEFAULT_DEFINITION: PoolDefinition = {
  min: null,
  max: null,
  thresholds: [],
};

/**
 * The named pools a Mothership player character carries (M7.6 §1.2). Every one
 * has an empty threshold list: none fires a mechanical event on crossing a
 * number. The wounds → Death Save transition is Warden-driven, not a threshold.
 *
 * Pools outside this set — NPC timers, station subsystems, anything synthesis
 * or the Warden mints — fall through to `DEFAULT_DEFINITION` and are
 * unconstrained.
 */
const POOL_DEFINITIONS: Record<string, PoolDefinition> = {
  hp: HP_DEFINITION,
  wounds: FLOOR_AT_ZERO,
  stress: STRESS_DEFINITION,
  strength: FLOOR_AT_ZERO,
  speed: FLOOR_AT_ZERO,
  intellect: FLOOR_AT_ZERO,
  combat: FLOOR_AT_ZERO,
  sanity: FLOOR_AT_ZERO,
  fear: FLOOR_AT_ZERO,
  body: FLOOR_AT_ZERO,
  credits: FLOOR_AT_ZERO,
};

/** The pool names a player character is created with, in display order. */
export const MOTHERSHIP_CHARACTER_POOL_NAMES = [
  'hp',
  'wounds',
  'stress',
  'strength',
  'speed',
  'intellect',
  'combat',
  'sanity',
  'fear',
  'body',
  'credits',
] as const;

export type MothershipCharacterPoolName =
  (typeof MOTHERSHIP_CHARACTER_POOL_NAMES)[number];

export function getMothershipPoolDefinition(poolName: string): PoolDefinition {
  return POOL_DEFINITIONS[poolName] ?? DEFAULT_DEFINITION;
}
