import {
  emptyMothershipState,
  MothershipCampaignStateSchema,
  ResourcePoolSchema,
} from '@uv/game-systems';

import type { SubmitGmContext } from './synthesis.schema';

export class SynthesisWriteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SynthesisWriteValidationError';
  }
}

type ResourcePool = { current: number; max: number | null };

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
 * Suffixes of the pools the player character already owns — for a sheet with
 * `entityId: 'lt_alvarez'` and the pools character creation derives, this is
 * `{'hp', 'stress'}`. Used to recognise a second pool of the same kind minted
 * under a different spelling of the player's id.
 */
function playerPoolSuffixes(
  existingPools: Record<string, ResourcePool>,
  playerEntityId: string,
): Set<string> {
  const prefix = `${playerEntityId}_`;
  const suffixes = new Set<string>();
  for (const key of Object.keys(existingPools)) {
    if (key.startsWith(prefix)) suffixes.add(key.slice(prefix.length));
  }
  return suffixes;
}

/**
 * Merges resource pools from `initialState` into any pools already present in
 * the existing campaign state. Existing pools always win on key conflict —
 * player HP and stress, once seeded by character creation, must never be
 * clobbered by synthesis output.
 *
 * Key preservation alone is not enough to keep one character to one set of
 * pools, and assuming it was is how the M7.5 capture ended up carrying
 * `alvarez_hp` alongside `lt_alvarez_hp`. Preservation only settles a
 * *collision*; the failure mode is the opposite one, where the model spells the
 * player's id differently, collides with nothing, and both spellings persist.
 * So a key that reads as a player pool — same suffix as one the player already
 * owns — is rejected unless its prefix resolves to the player's own id or to an
 * entity this payload declares. Prefixes that resolve to neither but name no
 * player pool (`station_power_reserve`, `contamination_spread_timer`) are
 * scenario-level state and pass through untouched.
 *
 * Returns the merged pools plus any keys dropped, so the caller can log them:
 * a drop here is a signal about model behaviour, not routine filtering.
 *
 * The function is pure; all inputs are plain data and the return is fresh.
 */
export function buildResourcePools(
  existingPools: Record<string, ResourcePool>,
  initialState: Record<string, unknown>,
  context: ResourcePoolContext,
): { pools: Record<string, ResourcePool>; skipped: string[] } {
  const merged: Record<string, ResourcePool> = { ...existingPools };
  const skipped: string[] = [];
  const suffixes = playerPoolSuffixes(existingPools, context.playerEntityId);
  const known = new Set([context.playerEntityId, ...context.knownEntityIds]);

  for (const [key, value] of Object.entries(initialState)) {
    if (key in merged) continue; // preserve existing player pools
    const parsed = ResourcePoolSchema.safeParse(value);
    if (!parsed.success) continue; // non-pool entries: see validate* above

    const impersonatesPlayer = [...suffixes].some((suffix) => {
      if (!key.endsWith(`_${suffix}`)) return false;
      const prefix = key.slice(0, key.length - suffix.length - 1);
      return prefix.length > 0 && !known.has(prefix);
    });
    if (impersonatesPlayer) {
      skipped.push(key);
      continue;
    }

    merged[key] = parsed.data;
  }
  return { pools: merged, skipped };
}

/**
 * Builds the `entities` map stored under `campaign_state.data.entities` from
 * the synthesis tool input. This is the per-entity visibility and disposition
 * record — positions are stored in `grid_entity`, not here.
 */
export function buildEntityMap(
  entities: SubmitGmContext['structured']['entities'],
): Record<string, { visible: boolean; status: 'unknown' }> {
  const map: Record<string, { visible: boolean; status: 'unknown' }> = {};
  for (const entity of entities) {
    map[entity.id] = { visible: entity.visible, status: 'unknown' };
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
    (base as { resourcePools?: Record<string, ResourcePool> }).resourcePools ??
    {};
  const existingEntities =
    (
      base as {
        entities?: Record<string, { visible: boolean; status: 'unknown' }>;
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
