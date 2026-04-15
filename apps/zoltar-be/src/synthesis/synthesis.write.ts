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
export function validateSubmitGmContextForWrite(
  input: SubmitGmContext,
): void {
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

  for (const [key, value] of Object.entries(input.structured.initialState)) {
    const parsed = ResourcePoolSchema.safeParse(value);
    if (!parsed.success) {
      throw new SynthesisWriteValidationError(
        `structured.initialState.${key} is not a valid resource pool`,
      );
    }
  }

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

/**
 * Merges resource pools from `initialState` into any pools already present in
 * the existing campaign state. Existing pools always win on key conflict —
 * player HP and stress, once seeded by character creation, must never be
 * clobbered by synthesis output.
 *
 * The function is pure; all inputs are plain data and the return is a fresh
 * object.
 */
export function buildResourcePools(
  existingPools: Record<string, ResourcePool>,
  initialState: Record<string, unknown>,
): Record<string, ResourcePool> {
  const merged: Record<string, ResourcePool> = { ...existingPools };
  for (const [key, value] of Object.entries(initialState)) {
    if (key in merged) continue; // preserve existing player pools
    const parsed = ResourcePoolSchema.safeParse(value);
    if (parsed.success) {
      merged[key] = parsed.data;
    }
  }
  return merged;
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
): Record<string, unknown> {
  const base = existing ?? emptyMothershipState();
  const existingPools =
    ((base as { resourcePools?: Record<string, ResourcePool> }).resourcePools) ??
    {};
  const existingEntities =
    ((base as { entities?: Record<string, { visible: boolean; status: 'unknown' }> }).entities) ??
    {};
  const existingScenarioState =
    ((base as { scenarioState?: Record<string, unknown> }).scenarioState) ?? {};
  const existingWorldFacts =
    ((base as { worldFacts?: Record<string, string> }).worldFacts) ?? {};

  const nextData = {
    schemaVersion: 1 as const,
    resourcePools: buildResourcePools(
      existingPools,
      input.structured.initialState,
    ),
    entities: { ...existingEntities, ...buildEntityMap(input.structured.entities) },
    flags: input.structured.flags,
    scenarioState: existingScenarioState,
    worldFacts: existingWorldFacts,
  };

  MothershipCampaignStateSchema.parse(nextData);
  return nextData;
}

/**
 * Builds the `gm_context.blob` payload. `entities` is duplicated here for
 * prompt-assembly convenience; `grid_entity` remains the authoritative store.
 */
export function buildGmContextBlob(
  input: SubmitGmContext,
): Record<string, unknown> {
  return {
    openingNarration: input.openingNarration ?? null,
    narrative: input.narrative,
    entities: input.structured.entities,
  };
}

/**
 * Extracts the `grid_entity` rows to insert from the synthesis tool input.
 * Entities without a starting position are skipped — they exist in the
 * narrative but enter the grid later via session-play state changes.
 */
export function buildGridEntityRows(
  input: SubmitGmContext,
): Array<{
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
