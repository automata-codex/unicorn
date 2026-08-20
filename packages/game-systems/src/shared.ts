import { z } from 'zod';

import { MothershipCrewRoleEnum } from './mothership/crew-roles';

export const ResourcePoolSchema = z.object({
  current: z.number().int(),
  max: z.number().int().nullable(),
});

export const EntityStatusSchema = z.enum(['alive', 'dead', 'unknown']);

export const EntitySchema = z.object({
  visible: z.boolean(),
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
