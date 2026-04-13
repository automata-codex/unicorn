import { z } from 'zod';

export const ResourcePoolSchema = z.object({
  current: z.number().int(),
  max: z.number().int().nullable(),
});

export const EntityStatusSchema = z.enum(['alive', 'dead', 'unknown']);

export const EntitySchema = z.object({
  visible: z.boolean(),
  status: EntityStatusSchema.default('unknown'),
  npcState: z.string().optional(),
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
