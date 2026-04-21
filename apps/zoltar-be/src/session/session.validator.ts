import {
  EntityStatusSchema,
  type MothershipCampaignState,
  type PoolDefinition,
} from '@uv/game-systems';
import { z } from 'zod';

import type { SubmitGmResponse } from './session.schema';

type EntityStatus = z.infer<typeof EntityStatusSchema>;

export interface ValidationRejection {
  path: string;
  reason: string;
  received: unknown;
}

export interface ThresholdCrossing {
  pool: string;
  finalValue: number;
  effect: string;
}

export interface ValidationResult {
  applied: {
    resourcePools: Record<string, { current: number; max: number | null }>;
    entities: Record<
      string,
      { visible: boolean; status: EntityStatus; npcState?: string }
    >;
    flags: Record<string, { value: boolean; trigger: string }>;
    scenarioState: Record<
      string,
      { current: number; max: number | null; note: string }
    >;
    worldFacts: Record<string, string>;
  };
  rejections: ValidationRejection[];
  thresholds: ThresholdCrossing[];
}

export function validateStateChanges(input: {
  proposed: SubmitGmResponse['stateChanges'];
  currentData: MothershipCampaignState;
  poolDef: (poolName: string) => PoolDefinition;
}): ValidationResult {
  const result: ValidationResult = {
    applied: {
      resourcePools: {},
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    },
    rejections: [],
    thresholds: [],
  };

  const proposed = input.proposed ?? {};

  for (const [poolName, change] of Object.entries(
    proposed.resourcePools ?? {},
  )) {
    applyResourcePool(
      poolName,
      change,
      input.currentData,
      input.poolDef,
      result,
    );
  }

  for (const [entityId, change] of Object.entries(proposed.entities ?? {})) {
    applyEntity(entityId, change, input.currentData, result);
  }

  for (const [flagName, change] of Object.entries(proposed.flags ?? {})) {
    applyFlag(flagName, change, input.currentData, result);
  }

  for (const [key, change] of Object.entries(proposed.scenarioState ?? {})) {
    applyScenarioState(key, change, input.currentData, result);
  }

  for (const [key, value] of Object.entries(proposed.worldFacts ?? {})) {
    result.applied.worldFacts[key] = value;
  }

  return result;
}

function applyResourcePool(
  poolName: string,
  change: { delta: number },
  currentData: MothershipCampaignState,
  poolDef: (poolName: string) => PoolDefinition,
  result: ValidationResult,
): void {
  const existing = currentData.resourcePools[poolName];
  const delta = change.delta;
  const def = poolDef(poolName);

  if (!existing) {
    if (delta > 0) {
      result.applied.resourcePools[poolName] = { current: delta, max: null };
    } else {
      result.rejections.push({
        path: `resourcePools.${poolName}`,
        reason:
          'Pool does not exist — bootstrap with a positive delta before applying damage or spending.',
        received: change,
      });
    }
    return;
  }

  const newCurrent = existing.current + delta;

  if (def.min !== null && newCurrent < def.min) {
    result.rejections.push({
      path: `resourcePools.${poolName}`,
      reason:
        def.min === 0
          ? 'Cannot spend more than available.'
          : `Pool value would drop below minimum (${def.min}).`,
      received: change,
    });
    return;
  }

  if (def.max !== null && newCurrent > def.max) {
    result.rejections.push({
      path: `resourcePools.${poolName}`,
      reason: `Pool value would exceed maximum (${def.max}).`,
      received: change,
    });
    return;
  }

  result.applied.resourcePools[poolName] = {
    current: newCurrent,
    max: existing.max,
  };

  // Thresholds fire only on downward crossings (negative delta). The spec's
  // formal rule in §"Part 2 → resourcePools → 3" lists a symmetric positive-
  // delta case as well, but the spec test list is explicit that HP healed
  // from -1 to +2 does not fire (already past it). The asymmetric reading
  // satisfies the concrete test; no M6 pool carries an upward-violation
  // threshold. Revisit if such a threshold is introduced.
  for (const t of def.thresholds) {
    if (delta < 0 && existing.current >= t.value && newCurrent < t.value) {
      result.thresholds.push({
        pool: poolName,
        finalValue: newCurrent,
        effect: t.effect,
      });
    }
  }
}

function applyEntity(
  entityId: string,
  change: { visible?: boolean; status?: string },
  currentData: MothershipCampaignState,
  result: ValidationResult,
): void {
  if (change.status !== undefined) {
    const parsed = EntityStatusSchema.safeParse(change.status);
    if (!parsed.success) {
      result.rejections.push({
        path: `entities.${entityId}`,
        reason: "status must be 'alive', 'dead', or 'unknown'",
        received: change,
      });
      return;
    }
  }

  const proposedStatus = change.status as EntityStatus | undefined;
  const existing = currentData.entities[entityId];

  if (!existing) {
    result.applied.entities[entityId] = {
      visible: change.visible ?? true,
      status: proposedStatus ?? 'unknown',
    };
    return;
  }

  const merged: { visible: boolean; status: EntityStatus; npcState?: string } =
    {
      visible: change.visible ?? existing.visible,
      status: proposedStatus ?? existing.status,
    };
  if (existing.npcState !== undefined) {
    merged.npcState = existing.npcState;
  }
  result.applied.entities[entityId] = merged;
}

function applyFlag(
  flagName: string,
  change: { value: boolean } | { value: boolean; trigger: string },
  currentData: MothershipCampaignState,
  result: ValidationResult,
): void {
  const existing = currentData.flags[flagName];
  const providedTrigger = 'trigger' in change ? change.trigger : undefined;

  if (!existing) {
    if (providedTrigger === undefined) {
      result.rejections.push({
        path: `flags.${flagName}`,
        reason: 'New flag requires a trigger string.',
        received: change,
      });
      return;
    }
    result.applied.flags[flagName] = {
      value: change.value,
      trigger: providedTrigger,
    };
    return;
  }

  result.applied.flags[flagName] = {
    value: change.value,
    trigger: existing.trigger,
  };
}

function applyScenarioState(
  key: string,
  change: { current: number },
  currentData: MothershipCampaignState,
  result: ValidationResult,
): void {
  const existing = currentData.scenarioState[key];
  if (!existing) {
    result.rejections.push({
      path: `scenarioState.${key}`,
      reason:
        'Scenario state key does not exist — these are defined at synthesis time and cannot be introduced during play.',
      received: change,
    });
    return;
  }
  result.applied.scenarioState[key] = {
    current: change.current,
    max: existing.max,
    note: existing.note,
  };
}
