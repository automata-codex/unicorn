import {
  emptyMothershipState,
  executeDiceRoll,
  isInvalidReservedPoolOwner,
  MothershipCampaignStateSchema,
  ResourcePoolSchema,
} from '@uv/game-systems';

import type { MothershipCrewRole } from '@uv/game-systems';
import type { SubmitGmContext } from './synthesis.schema';

export class SynthesisWriteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SynthesisWriteValidationError';
  }
}

type ResourcePool = { current: number; max: number | null };
type OwnedResourcePools = Record<string, Record<string, ResourcePool>>;

/**
 * Pre-write validation for `submit_gm_context` input. Enforces invariants the
 * tool-input schema cannot express:
 *
 * 1. `structured.flags.adventure_complete` exists with `value: false`.
 * 2. Every entry in `structured.initialState` is a `{ current, max }` pool.
 * 3. No duplicate entity ids within `structured.entities`.
 *
 * Throws `SynthesisWriteValidationError` on any failure.
 */
export function validateSubmitGmContextForWrite(input: SubmitGmContext): void {
  const completeFlag = input.structured.flags.adventure_complete;
  if (!completeFlag) {
    throw new SynthesisWriteValidationError(
      'structured.flags.adventure_complete is required',
    );
  }
  if (completeFlag.value !== false) {
    throw new SynthesisWriteValidationError(
      'structured.flags.adventure_complete must start as { value: false }',
    );
  }

  // Non-pool entries in initialState are silently skipped — Claude sometimes
  // places string or object values that don't match { current, max }. The
  // buildResourcePools helper filters these out at merge time.

  const seen = new Set<string>();
  for (const entity of input.structured.entities) {
    if (seen.has(entity.id)) {
      throw new SynthesisWriteValidationError(
        `duplicate entity id in structured.entities: ${entity.id}`,
      );
    }
    seen.add(entity.id);
  }
}

/** Identifier namespaces `buildResourcePools` resolves pool prefixes against. */
export type ResourcePoolContext = {
  /** Canonical player entity id, from `character_sheet.data.entityId`. */
  playerEntityId: string;
  /** Entity ids declared in this synthesis payload. */
  knownEntityIds: readonly string[];
};

/**
 * Names of the pools the player character already owns — for a sheet with
 * `entityId: 'lt_alvarez'` and the pools character creation derives, this is
 * `{'hp', 'stress'}`. Used to recognise a second pool of the same kind minted
 * under a different spelling of the player's id.
 *
 * Since M7.6 this is the player owner's key set rather than a prefix scan over
 * flat composite keys — the address carries the owner explicitly, so there is
 * nothing to parse.
 */
function playerPoolNames(
  existingPools: OwnedResourcePools,
  playerEntityId: string,
): Set<string> {
  return new Set(Object.keys(existingPools[playerEntityId] ?? {}));
}

/**
 * Merges resource pools from `initialState` into any pools already present in
 * the existing campaign state. Existing pools always win on conflict — the
 * player's own pools, once seeded by character creation, must never be
 * clobbered by synthesis output.
 *
 * `initialState` is keyed by the `{owner}.{poolName}` address, matching
 * `campaign_state.data.resourcePools`' two levels. Entries whose key is not
 * that shape are skipped rather than guessed at.
 *
 * Preservation alone is not enough to keep one character to one set of pools,
 * and assuming it was is how the M7.5 capture ended up carrying `alvarez.hp`
 * alongside `lt_alvarez.hp`. Preservation only settles a *collision*; the
 * failure mode is the opposite one, where the model spells the player's id
 * differently, collides with nothing, and both spellings persist. So an entry
 * that reads as a player pool — same pool name as one the player already owns
 * — is rejected unless its owner resolves to the player's own id or to an
 * entity this payload declares. Owners that resolve to neither but name no
 * player pool (`_scenario.station_power_reserve`) are scenario-level state and
 * pass through untouched.
 *
 * Returns the merged pools plus any keys dropped, so the caller can log them:
 * a drop here is a signal about model behaviour, not routine filtering.
 *
 * The function is pure; all inputs are plain data and the return is fresh.
 */
export function buildResourcePools(
  existingPools: OwnedResourcePools,
  initialState: Record<string, unknown>,
  context: ResourcePoolContext,
): { pools: OwnedResourcePools; skipped: string[] } {
  const merged: OwnedResourcePools = {};
  for (const [owner, pools] of Object.entries(existingPools)) {
    merged[owner] = { ...pools };
  }
  const skipped: string[] = [];
  const playerPools = playerPoolNames(existingPools, context.playerEntityId);
  const known = new Set([context.playerEntityId, ...context.knownEntityIds]);

  for (const [address, value] of Object.entries(initialState)) {
    const parts = address.split('.');
    if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
      skipped.push(address);
      continue;
    }
    const [owner, poolName] = parts;

    // Reserved owners are the `_`-prefixed namespace, and `_scenario` is the
    // only member. A typo there would otherwise create a silent second bucket
    // that nothing renders under the name the model thought it used.
    if (isInvalidReservedPoolOwner(owner)) {
      skipped.push(address);
      continue;
    }

    if (merged[owner]?.[poolName]) continue; // preserve existing player pools
    const parsed = ResourcePoolSchema.safeParse(value);
    if (!parsed.success) continue; // non-pool entries: see validate* above

    if (!known.has(owner) && playerPools.has(poolName)) {
      skipped.push(address);
      continue;
    }

    (merged[owner] ??= {})[poolName] = parsed.data;
  }
  return { pools: merged, skipped };
}

export type BuiltEntity = {
  visible: boolean;
  status: 'unknown';
  crewRole?: MothershipCrewRole;
  instinctRoll?: number[];
};

/**
 * Builds the `entities` map stored under `campaign_state.data.entities` from
 * the synthesis tool input. This is the per-entity visibility and disposition
 * record — positions are stored in `grid_entity`, not here.
 *
 * **This is also where a Contractor's Instinct is rolled** (`ADR-0100`).
 * Synthesis declares the NPC and its role; the dice are thrown here, by the
 * backend, because `SYNTHESIS_TOOLS` carries no `roll_dice` and a number the
 * model supplied would be a fabrication rather than a roll. The dice are stored
 * because nothing can recompute them; the `2d10 + 25 + role adjustment` total
 * and the role's skill chain are derived at read time and stored nowhere.
 *
 * Only `type: 'npc'`. A `threat` has no Instinct and a `feature` is not an
 * actor — `entitySchema`'s enum has no Contractor member and none is being
 * added, so `npc` is the whole of the carrier.
 *
 * **The field list here is exhaustive on purpose and was the bug risk.** This
 * function rebuilds each entity rather than spreading it, so a field added to
 * the tool schema and not added here is dropped silently — which is exactly the
 * failure mode `ADR-0100` rejects a free-text role tag for.
 */
export function buildEntityMap(
  entities: SubmitGmContext['structured']['entities'],
  rollInstinct: () => number[] = () => executeDiceRoll('2d10').results,
): Record<string, BuiltEntity> {
  const map: Record<string, BuiltEntity> = {};
  for (const entity of entities) {
    const built: BuiltEntity = { visible: entity.visible, status: 'unknown' };
    if (entity.type === 'npc') {
      built.instinctRoll = rollInstinct();
      if (entity.crewRole) built.crewRole = entity.crewRole;
    }
    map[entity.id] = built;
  }
  return map;
}

/**
 * Computes the new `campaign_state.data` payload from existing state plus the
 * synthesized GM context. The returned object is validated against
 * `MothershipCampaignStateSchema` before it is returned — a validation failure
 * here indicates a programmer error in this function, not a bad tool input
 * (those are caught by `validateSubmitGmContextForWrite` upstream).
 */
export function buildCampaignStateData(
  existing: Record<string, unknown> | null,
  input: SubmitGmContext,
  playerEntityId: string,
): { data: Record<string, unknown>; skippedPools: string[] } {
  const base = existing ?? emptyMothershipState();
  const existingPools =
    (base as { resourcePools?: OwnedResourcePools }).resourcePools ?? {};
  const existingEntities =
    (
      base as {
        entities?: Record<string, BuiltEntity>;
      }
    ).entities ?? {};
  const existingScenarioState =
    (base as { scenarioState?: Record<string, unknown> }).scenarioState ?? {};
  const existingWorldFacts =
    (base as { worldFacts?: Record<string, string> }).worldFacts ?? {};

  const pools = buildResourcePools(
    existingPools,
    input.structured.initialState,
    {
      playerEntityId,
      knownEntityIds: input.structured.entities.map((e) => e.id),
    },
  );

  const nextData = {
    schemaVersion: 1 as const,
    resourcePools: pools.pools,
    entities: {
      ...existingEntities,
      ...buildEntityMap(input.structured.entities),
    },
    flags: input.structured.flags,
    scenarioState: existingScenarioState,
    worldFacts: {
      ...existingWorldFacts,
      ...(input.structured.worldFacts ?? {}),
    },
  };

  MothershipCampaignStateSchema.parse(nextData);
  return { data: nextData, skippedPools: pools.skipped };
}

/**
 * Builds the `gm_context.blob` payload. `entities` is duplicated here for
 * prompt-assembly convenience; `grid_entity` remains the authoritative store.
 * `structured.flags` is persisted so the session-time snapshot builder can
 * distinguish original flags (their triggers are cached inside this blob)
 * from flags introduced during play (whose triggers must be re-emitted).
 */
export function buildGmContextBlob(
  input: SubmitGmContext,
): Record<string, unknown> {
  return {
    openingNarration: input.openingNarration ?? null,
    narrative: input.narrative,
    entities: input.structured.entities,
    structured: {
      flags: input.structured.flags,
    },
  };
}

/**
 * Extracts the `grid_entity` rows to insert from the synthesis tool input.
 * Entities without a starting position are skipped — they exist in the
 * narrative but enter the grid later via session-play state changes.
 */
export function buildGridEntityRows(input: SubmitGmContext): Array<{
  entityRef: string;
  x: number;
  y: number;
  z: number;
  visible: boolean;
  tags: string[];
}> {
  const rows: Array<{
    entityRef: string;
    x: number;
    y: number;
    z: number;
    visible: boolean;
    tags: string[];
  }> = [];
  for (const entity of input.structured.entities) {
    if (!entity.startingPosition) continue;
    rows.push({
      entityRef: entity.id,
      x: entity.startingPosition.x,
      y: entity.startingPosition.y,
      z: entity.startingPosition.z,
      visible: entity.visible,
      tags: entity.tags,
    });
  }
  return rows;
}
