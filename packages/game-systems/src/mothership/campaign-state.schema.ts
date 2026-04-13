import { z } from 'zod';

import {
  EntitySchema,
  FlagSchema,
  ResourcePoolSchema,
  ScenarioStateEntrySchema,
} from '../shared';

export const MothershipCampaignStateSchema = z.object({
  schemaVersion: z.literal(1),

  // Flat map keyed as {entity_id}_{pool_name}: dr_chen_hp, vasquez_stress.
  // HP and all numeric resources live here — not on the entity record.
  resourcePools: z.record(z.string(), ResourcePoolSchema).default({}),

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
  entities: {},
  flags: {},
  scenarioState: {},
  worldFacts: {},
});
