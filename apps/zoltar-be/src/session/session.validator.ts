import {
  EntityStatusSchema,
  isInvalidReservedPoolOwner,
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
    /** `resourcePools[owner][poolName]`, matching campaign state's shape. */
    resourcePools: Record<
      string,
      Record<string, { current: number; max: number | null }>
    >;
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
  /**
   * Identifier namespaces the pool-bootstrap branch resolves prefixes against:
   * the player ids from `character_sheet`, and the entities the snapshot could
   * have shown. Optional so callers that predate it (and the pure unit specs)
   * keep working — an absent set disables the impersonation check rather than
   * rejecting everything, the same asymmetry `roll_dice` uses for an empty
   * known set (`docs/decisions.md § actingEntityId must resolve against a
   * declared identifier set`).
   */
  identifiers?: {
    playerEntityIds: readonly string[];
    knownEntityIds: readonly string[];
  };
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

  for (const [address, change] of Object.entries(
    proposed.resourcePools ?? {},
  )) {
    applyResourcePool(
      address,
      change,
      input.currentData,
      input.poolDef,
      result,
      input.identifiers,
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

/**
 * Splits a `{owner}.{poolName}` payload address. Returns null when the address
 * does not have exactly that shape — a bare `hp` names no owner, and
 * `a.b.c` names no pool this state can address.
 *
 * The tool payload carries the two levels joined by a dot rather than as a
 * nested object because the payload is a map keyed by address; M7.6 Part 4
 * replaces the whole member with an array of self-describing entries and this
 * parse goes away with it.
 */
function parsePoolAddress(
  address: string,
): { owner: string; poolName: string } | null {
  const parts = address.split('.');
  if (parts.length !== 2) return null;
  const [owner, poolName] = parts;
  if (owner.length === 0 || poolName.length === 0) return null;
  return { owner, poolName };
}

/**
 * True when `owner` is a spelling of the player's id that nothing declares,
 * carrying pools of a kind the player already owns — `alvarez.hp` while the
 * sheet says `lt_alvarez`. Scenario-level owners that resolve to nothing but
 * name no player pool (`_scenario.station_power_reserve`) are unaffected.
 *
 * Still two clauses, and both are load-bearing. Nesting removed the string
 * slicing this used to need — the pool-name comparison is now a set
 * intersection — but not the `!known.has(owner)` guard. Dropping to a bare "is
 * the owner a player entity id" test would reject every legitimate NPC pool:
 * `decommissioned_android.hp` names a pool of a kind the player owns, and it
 * survives only because its owner is in `knownEntityIds`.
 */
function impersonatesPlayerPool(
  owner: string,
  poolName: string,
  currentData: MothershipCampaignState,
  identifiers: {
    playerEntityIds: readonly string[];
    knownEntityIds: readonly string[];
  },
): boolean {
  const known = new Set([
    ...identifiers.playerEntityIds,
    ...identifiers.knownEntityIds,
  ]);
  if (known.has(owner)) return false;
  return identifiers.playerEntityIds.some((playerId) =>
    Object.hasOwn(currentData.resourcePools[playerId] ?? {}, poolName),
  );
}

function applyResourcePool(
  address: string,
  change: { delta: number },
  currentData: MothershipCampaignState,
  poolDef: (poolName: string) => PoolDefinition,
  result: ValidationResult,
  identifiers?: {
    playerEntityIds: readonly string[];
    knownEntityIds: readonly string[];
  },
): void {
  const parsed = parsePoolAddress(address);
  if (!parsed) {
    result.rejections.push({
      path: `resourcePools.${address}`,
      reason:
        'Pool address must be "{owner}.{poolName}" — the owning entity id, a ' +
        'dot, then the bare pool name. "dr_chen.hp", not "dr_chen_hp".',
      received: change,
    });
    return;
  }
  const { owner, poolName } = parsed;

  if (isInvalidReservedPoolOwner(owner)) {
    result.rejections.push({
      path: `resourcePools.${owner}.${poolName}`,
      reason:
        `Owner "${owner}" claims the reserved leading-underscore namespace. ` +
        'The only reserved owner is "_scenario", for pools belonging to no ' +
        'entity. Entity ids never begin with an underscore.',
      received: change,
    });
    return;
  }

  const existing = currentData.resourcePools[owner]?.[poolName];
  const delta = change.delta;
  const def = poolDef(poolName);

  if (!existing) {
    if (
      identifiers &&
      identifiers.playerEntityIds.length > 0 &&
      impersonatesPlayerPool(owner, poolName, currentData, identifiers)
    ) {
      // Bootstrapping this would give one character two pools of the same kind
      // under two spellings of their id — the defect that made the M7.5
      // capture's `actingEntityId` values unresolvable. Named ids in the
      // reason so the model corrects in-loop rather than retrying blind.
      result.rejections.push({
        path: `resourcePools.${owner}.${poolName}`,
        reason:
          `Owner "${owner}" does not resolve to a known entity, and the ` +
          `player character already has a "${poolName}" pool. The player's ` +
          `entity id is ${identifiers.playerEntityIds.join(' or ')} — use ` +
          `that exact spelling as the owner.`,
        received: change,
      });
      return;
    }
    if (delta > 0) {
      recordApplied(result, owner, poolName, { current: delta, max: null });
    } else {
      result.rejections.push({
        path: `resourcePools.${owner}.${poolName}`,
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
      path: `resourcePools.${owner}.${poolName}`,
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
      path: `resourcePools.${owner}.${poolName}`,
      reason: `Pool value would exceed maximum (${def.max}).`,
      received: change,
    });
    return;
  }

  recordApplied(result, owner, poolName, {
    current: newCurrent,
    max: existing.max,
  });

  // Thresholds fire only on downward crossings (negative delta). The spec's
  // formal rule in §"Part 2 → resourcePools → 3" lists a symmetric positive-
  // delta case as well, but the spec test list is explicit that HP healed
  // from -1 to +2 does not fire (already past it). The asymmetric reading
  // satisfies the concrete test; no M6 pool carries an upward-violation
  // threshold. Revisit if such a threshold is introduced.
  for (const t of def.thresholds) {
    if (delta < 0 && existing.current >= t.value && newCurrent < t.value) {
      result.thresholds.push({
        pool: `${owner}.${poolName}`,
        finalValue: newCurrent,
        effect: t.effect,
      });
    }
  }
}

function recordApplied(
  result: ValidationResult,
  owner: string,
  poolName: string,
  pool: { current: number; max: number | null },
): void {
  const forOwner = (result.applied.resourcePools[owner] ??= {});
  forOwner[poolName] = pool;
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
