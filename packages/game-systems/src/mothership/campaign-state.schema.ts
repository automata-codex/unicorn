import { z } from 'zod';

import {
  EntitySchema,
  FlagSchema,
  ResourcePoolSchema,
  ScenarioStateEntrySchema,
} from '../shared';
import { MothershipCharacterStateSchema } from './character-state.schema';

/**
 * The reserved owner for pools that belong to no entity — countdown timers,
 * station subsystems, anything the scenario tracks numerically without an
 * entity to hang it on. Leading `_` is what makes the reserved namespace
 * distinguishable from an entity id.
 *
 * `RESERVED_POOL_OWNERS` is the closed set. Write paths reject an owner key
 * that begins with `_` and is not in it, so a typo lands as a rejection rather
 * than a silently-created bucket.
 */
export const SCENARIO_POOL_OWNER = '_scenario';

export const RESERVED_POOL_OWNERS: readonly string[] = [SCENARIO_POOL_OWNER];

/**
 * True when `owner` claims the reserved (`_`-prefixed) namespace without being
 * one of the reserved owners. This is the one narrow identifier assertion M7.6
 * adds; general identifier-format validation is out of scope and is recorded on
 * the roadmap instead.
 */
export function isInvalidReservedPoolOwner(owner: string): boolean {
  return owner.startsWith('_') && !RESERVED_POOL_OWNERS.includes(owner);
}

export const MothershipCampaignStateSchema = z.object({
  schemaVersion: z.literal(1),

  // Two levels: resourcePools[owner][poolName]. `dr_chen.hp`, `vasquez.stress`.
  // HP and all numeric resources live here — not on the entity record.
  //
  // The outer key is an *owner*, not necessarily an entity. Most owners are
  // entity ids (the player's, or an id from `entities`), but a scenario carries
  // numerics that belong to no entity — countdown timers, station subsystems.
  // Those take the reserved owner `_scenario`. Ownership is deliberately
  // unconstrained: a write to an unrecognised owner is not rejected. See
  // `docs/plans/016-…-implementation-plan.md § D1`.
  //
  // Reserved owner keys begin with `_`; entity ids may not. That is what keeps
  // the two namespaces from colliding. The only reserved owner today is
  // `_scenario`, and the write paths reject any other `_`-prefixed owner.
  resourcePools: z
    .record(z.string(), z.record(z.string(), ResourcePoolSchema))
    .default({}),

  // Per-entity state that is neither a pool nor immutable creation data:
  // conditions, skills, equipment, worn armor, minimum stress, bleeding, and a
  // pending Death Save. Keyed by entity id, same as `resourcePools`' outer
  // level — but entities only, never `_scenario`: a scenario has no conditions.
  characterState: z
    .record(z.string(), MothershipCharacterStateSchema)
    .default({}),

  // Entity visibility, status, and narrative NPC state.
  // Positions are NOT stored here — they live in grid_entities.
  entities: z.record(z.string(), EntitySchema).default({}),

  // Flags with their flip conditions bundled together.
  // { adventure_complete: { value: false, trigger: "Player reaches escape pod" } }
  // stateChanges.flagTriggers only carries { flagName: newValue } — trigger is immutable.
  flags: z.record(z.string(), FlagSchema).default({}),

  // Non-entity numeric state: oxygen, reactor power, countdown timers, etc.
  scenarioState: z.record(z.string(), ScenarioStateEntrySchema).default({}),

  // Environmental scratchpad. First-mention details Claude generates on the fly
  // that must be consistent across turns: specific console display text, graffiti content, etc.
  worldFacts: z.record(z.string(), z.string()).default({}),
});

export type MothershipCampaignState = z.infer<
  typeof MothershipCampaignStateSchema
>;

export const emptyMothershipState = (): MothershipCampaignState => ({
  schemaVersion: 1,
  resourcePools: {},
  characterState: {},
  entities: {},
  flags: {},
  scenarioState: {},
  worldFacts: {},
});
