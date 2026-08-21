import { z } from 'zod';

import { MothershipCrewRoleEnum } from './mothership/crew-roles';

export const ResourcePoolSchema = z.object({
  current: z.number().int(),
  max: z.number().int().nullable(),
});

export const EntityStatusSchema = z.enum(['alive', 'dead', 'unknown']);

export const EntitySchema = z.object({
  /**
   * **Line of sight, not discovery** (`ADR-0101`). Whether a player character
   * can perceive this entity *right now* — transient and bidirectional, the
   * goblin ducking behind a column and stepping back out. It is not a record
   * of whether the players know the entity exists; that is `revealed`.
   *
   * The two were one boolean until 2026-08-21, and the 2026-08-16 playtest used
   * it for discovery because nothing said otherwise.
   */
  visible: z.boolean(),

  /**
   * **Discovery, and monotonic** (`ADR-0101`). Whether the players have found
   * out this entity exists at all. Once `true` it never returns to `false` —
   * enforced in `applyEntity`, not by convention, because a gate that can be
   * reopened is not a gate.
   *
   * Required rather than defaulted. A default would let `ASSEMBLY_PROBE` and
   * every future caller acquire a value nobody chose, which is the failure this
   * field exists to correct. Rows predating it are back-filled by
   * `V20__entity_revealed_backfill.sql` with `revealed := visible`; the eval
   * corpus, which lives in JSON on disk rather than the database, is normalized
   * the same way at load time by `seedScratchAdventure`.
   */
  revealed: z.boolean(),

  status: EntityStatusSchema.default('unknown'),
  npcState: z.string().optional(),

  /**
   * The Contractor's crew role, and the dice behind their Instinct
   * (`ADR-0100`). Both optional: `threat` and `feature` entities have neither,
   * and an NPC written before this existed has neither.
   *
   * The roll is stored because nothing can recompute it; the Instinct total and
   * the role's skill chain are derived and stored nowhere.
   */
  crewRole: MothershipCrewRoleEnum.optional(),
  instinctRoll: z.array(z.number().int().min(1)).max(2).optional(),
  // npcState: update whenever NPC disposition or knowledge changes.
  // e.g. "Hostile — witnessed player kill the guard" or "Frightened — cornered, low ammo"
});

export const FlagSchema = z.object({
  value: z.boolean(),
  trigger: z.string(),
  // trigger: in-fiction condition that flips this flag.
  // Set at initialization; does not change. Carried as delta in stateChanges.flagTriggers.
});

export const ScenarioStateEntrySchema = z.object({
  current: z.number().int(),
  max: z.number().int().nullable(),
  note: z.string().default(''),
  // Use for non-entity numeric state: oxygen levels, power grid status, countdown timers, etc.
});
