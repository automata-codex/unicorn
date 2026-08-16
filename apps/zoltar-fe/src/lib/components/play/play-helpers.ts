/**
 * Pure derivation helpers for the Play view. Extracted out of the components
 * so rendering decisions can be tested without mounting Svelte.
 */

import type { MessageWire } from './timeline';

export interface ResourcePool {
  current: number;
  max: number | null;
}

/** `resourcePools[owner][poolName]`, matching the backend's campaign state. */
export type OwnedResourcePools = Record<string, Record<string, ResourcePool>>;

export interface CampaignStateData {
  resourcePools: OwnedResourcePools;
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
  hp: { current: number; max: number | null };
  /**
   * No ceiling. Mothership caps Stress at 20 as a *system* constant that
   * converts overflow into a Stat reduction rather than rejecting it, so the
   * pool carries `max: null` and there is no bar to fill.
   */
  stress: { current: number };
  wounds: { current: number; max: number | null };
  /** Free-form NPC-state line; empty string when not set. */
  conditions: string;
}

/**
 * Derives the display-ready status strip fields for a player entity, entirely
 * from the nested pools.
 *
 * **The character-sheet fallbacks are gone.** They existed to cover a pool
 * with `max: null`, sourced from `maxHp` / `maxStress` on the sheet — fields
 * M7.6 removed, because they were a second copy of the pool ceiling and free
 * to disagree with it. After Part 2 the hp and wounds pools always carry a
 * max, and a missing pool now renders as missing rather than as a plausible
 * number from a stale source.
 */
export function deriveCharacterStatus(input: {
  state: CampaignStateData;
  playerEntityId: string;
}): CharacterStatus {
  const { state, playerEntityId } = input;
  const pools = state.resourcePools[playerEntityId] ?? {};
  const entity = state.entities[playerEntityId];

  return {
    hp: { current: pools.hp?.current ?? 0, max: pools.hp?.max ?? null },
    stress: { current: pools.stress?.current ?? 0 },
    wounds: {
      current: pools.wounds?.current ?? 0,
      max: pools.wounds?.max ?? null,
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
    resourcePools?: OwnedResourcePools;
    entities?: Record<
      string,
      { visible: boolean; status: string; npcState?: string }
    >;
  };
}): CharacterStatus {
  const { previous, playerEntityId, applied } = input;
  const appliedPools = applied.resourcePools?.[playerEntityId];
  const appliedHp = appliedPools?.hp;
  const appliedStress = appliedPools?.stress;
  const appliedWounds = appliedPools?.wounds;
  const appliedEntity = applied.entities?.[playerEntityId];

  return {
    hp: appliedHp
      ? { current: appliedHp.current, max: appliedHp.max ?? previous.hp.max }
      : previous.hp,
    stress: appliedStress
      ? { current: appliedStress.current }
      : previous.stress,
    wounds: appliedWounds
      ? {
          current: appliedWounds.current,
          max: appliedWounds.max ?? previous.wounds.max,
        }
      : previous.wounds,
    conditions: appliedEntity?.npcState ?? previous.conditions,
  };
}

/**
 * Renders a ThresholdCrossing as a single human-readable line. `t.pool` is the
 * two-level address `{owner}.{poolName}`; both halves are underscore-separated
 * identifiers, so the label is every chunk of both, title-cased.
 * "`dr_chen.hp` at 0" → "Dr Chen Hp at 0 — death save required".
 */
export function formatThresholdLine(t: ThresholdCrossing): string {
  const label = t.pool
    .split('.')
    .flatMap((part) => part.split('_'))
    .filter((chunk) => chunk.length > 0)
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
      // Not a turn. Turn 1 begins at the player's first action, and the
      // review report's numbering starts there too — labelling this "Turn 1"
      // would shift every later note by one.
      turnNumber: null,
    },
    ...bootstrapMessages,
  ];
}

/**
 * Stamp a completed turn's ordinal onto the player message that initiated it.
 *
 * `postNarrative` appends the player's message optimistically, before the
 * server has run the turn — and the turn number only exists once the turn is
 * written, so that message renders unlabelled until this runs.
 *
 * Only the *trailing* run of unnumbered player messages is stamped, and only
 * back as far as the first numbered message. Two reasons, both real:
 * - A dice auto-advance turn has no player message at all. Without the
 *   trailing-only rule it would reach back and mislabel the previous turn's
 *   message.
 * - A turn that failed leaves its optimistic message in the log, unnumbered.
 *   When the player retries, both that message and the retry belong to the
 *   turn that finally succeeded — which is exactly how the backend numbers
 *   the orphaned rows it finds on reload
 *   (`SessionRepository.listMessagesWithTurnNumber`). Stamping the whole
 *   trailing run keeps the optimistic view and the reloaded view identical.
 */
export function stampPendingPlayerTurn(
  messages: MessageWire[],
  turnNumber: number,
): MessageWire[] {
  let firstPending = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.turnNumber !== null) break;
    if (m.role !== 'user') break;
    firstPending = i;
  }
  if (firstPending === messages.length) return messages;
  return messages.map((m, i) => (i >= firstPending ? { ...m, turnNumber } : m));
}
