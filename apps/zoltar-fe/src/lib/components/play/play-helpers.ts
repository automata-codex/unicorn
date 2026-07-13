/**
 * Pure derivation helpers for the Play view. Extracted out of the components
 * so rendering decisions can be tested without mounting Svelte.
 */

import type { MessageWire } from './timeline';

export interface ResourcePool {
  current: number;
  max: number | null;
}

export interface CampaignStateData {
  resourcePools: Record<string, ResourcePool>;
  entities: Record<
    string,
    { visible: boolean; status: string; npcState?: string }
  >;
  flags?: Record<string, { value: boolean; trigger: string }>;
  scenarioState?: Record<string, unknown>;
  worldFacts?: Record<string, string>;
  schemaVersion?: number;
}

export interface ThresholdCrossing {
  pool: string;
  finalValue: number;
  effect: string;
}

export interface CharacterStatus {
  /** `current`/`max`, both integers. `max` comes from the pool record. */
  hp: { current: number; max: number };
  stress: { current: number; max: number };
  /** Free-form NPC-state line; empty string when not set. */
  conditions: string;
}

/**
 * Derives the display-ready status strip fields for a player entity. Falls
 * back to fallback.max when the pool record has `max: null` — HP pools are
 * seeded with a per-character max at character creation, but defensively we
 * handle the null case with the character-sheet value.
 */
export function deriveCharacterStatus(input: {
  state: CampaignStateData;
  playerEntityId: string;
  fallbackMaxHp: number;
  fallbackMaxStress: number;
}): CharacterStatus {
  const { state, playerEntityId, fallbackMaxHp, fallbackMaxStress } = input;
  const hpPool = state.resourcePools[`${playerEntityId}_hp`];
  const stressPool = state.resourcePools[`${playerEntityId}_stress`];
  const entity = state.entities[playerEntityId];

  return {
    hp: {
      current: hpPool?.current ?? fallbackMaxHp,
      max: hpPool?.max ?? fallbackMaxHp,
    },
    stress: {
      current: stressPool?.current ?? 0,
      max: stressPool?.max ?? fallbackMaxStress,
    },
    conditions: entity?.npcState ?? '',
  };
}

/**
 * When the player sends a message and the turn has not yet completed, the
 * status strip should optimistically reflect nothing yet — but once the
 * response arrives, the backend's `applied.resourcePools` is the source of
 * truth. This helper merges applied deltas into a `CharacterStatus` object
 * so the component doesn't have to re-query `campaign_state` between turns.
 */
export function applyStatusDelta(input: {
  previous: CharacterStatus;
  playerEntityId: string;
  applied: {
    resourcePools?: Record<string, ResourcePool>;
    entities?: Record<
      string,
      { visible: boolean; status: string; npcState?: string }
    >;
  };
}): CharacterStatus {
  const { previous, playerEntityId, applied } = input;
  const appliedHp = applied.resourcePools?.[`${playerEntityId}_hp`];
  const appliedStress = applied.resourcePools?.[`${playerEntityId}_stress`];
  const appliedEntity = applied.entities?.[playerEntityId];

  return {
    hp: appliedHp
      ? { current: appliedHp.current, max: appliedHp.max ?? previous.hp.max }
      : previous.hp,
    stress: appliedStress
      ? {
          current: appliedStress.current,
          max: appliedStress.max ?? previous.stress.max,
        }
      : previous.stress,
    conditions: appliedEntity?.npcState ?? previous.conditions,
  };
}

/**
 * Renders a ThresholdCrossing as a single human-readable line. The pool name
 * prefix is the entity id; strip it and replace underscores with spaces for a
 * display-friendly label. "`dr_chen_hp` at 0" → "Dr Chen HP at 0 — death save
 * required".
 */
export function formatThresholdLine(t: ThresholdCrossing): string {
  const label = t.pool
    .split('_')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
  const effect = t.effect.replace(/_/g, ' ');
  return `${label} at ${t.finalValue} — ${effect}`;
}

/**
 * Maps a POST-messages response HTTP status into a UI-level error code the
 * page component can branch on. 200 returns null (no error).
 */
export type SendErrorCode =
  | 'precondition'
  | 'gm_correction_failed'
  | 'gm_unavailable'
  | 'unknown';

export function classifySendError(input: {
  status: number;
  body?: { error?: string } | null;
}): SendErrorCode | null {
  if (input.status >= 200 && input.status < 300) return null;
  if (input.status === 409) return 'precondition';
  if (input.status === 502) {
    if (input.body?.error === 'gm_correction_failed') {
      return 'gm_correction_failed';
    }
    return 'gm_unavailable';
  }
  return 'unknown';
}

/**
 * Prepends the adventure's opening narration as a synthetic first message,
 * if present. The opening narration is never itself a row in the `message`
 * table (see `AdventureRepository.findById`), so it must always be
 * synthesized client-side and always be the first entry in the visible
 * history — not just on the very first load before any real messages exist.
 *
 * Uses `new Date(0).toISOString()` as its `createdAt` so `mergeTimeline`'s
 * stable sort always places it before any real message or dice-roll
 * timestamp — correctness doesn't depend on array position.
 */
export function seedMessagesWithOpeningNarration(
  bootstrapMessages: MessageWire[],
  openingNarration: string | null | undefined,
): MessageWire[] {
  if (!openingNarration) return bootstrapMessages;
  return [
    {
      id: 'opening',
      role: 'assistant',
      content: openingNarration,
      createdAt: new Date(0).toISOString(),
    },
    ...bootstrapMessages,
  ];
}
