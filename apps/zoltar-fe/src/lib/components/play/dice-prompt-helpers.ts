import {
  DiceNotationError,
  executeDiceRoll,
  parseDiceNotation,
} from '@uv/game-systems';

/**
 * A single pending dice prompt as it arrives from the backend. Mirrors
 * `docs/api.md` — the shape returned in `submit_gm_response`'s
 * `diceRequests` array and in the `GET /messages` bootstrap.
 */
export interface DicePromptRequest {
  id: string;
  notation: string;
  purpose: string;
  target: number | null;
}

/**
 * Per-request state held by DicePrompt.svelte. `entries` is the UI's
 * per-die input buffer: `null` when the input is empty, the integer value
 * when it parses successfully. `source` records whether the player rolled
 * manually or used the "Roll for me" affordance — echoed back to the
 * backend on submit so telemetry can distinguish the two.
 */
export interface DicePromptEntry {
  requestId: string;
  notation: string;
  sides: number;
  count: number;
  entries: Array<number | null>;
  source: 'player_entered' | 'system_generated';
}

/**
 * Initialize an empty per-die entry buffer for a pending request. Throws
 * `DiceNotationError` via the shared parser — unexpected at runtime
 * (backend-issued notation is always valid) but surfaced for tests.
 */
export function buildInitialEntry(
  request: DicePromptRequest,
): DicePromptEntry {
  const { count, sides } = parseDiceNotation(request.notation);
  return {
    requestId: request.id,
    notation: request.notation,
    sides,
    count,
    entries: Array(count).fill(null),
    source: 'player_entered',
  };
}

/**
 * Validate a single die input. Returns a discriminated result:
 *   - `{ valid: true, value }` when the raw string parses to an integer
 *     inside `[1, sides]`.
 *   - `{ valid: false, error }` otherwise, with a human-readable message
 *     the form can render as a field error.
 *   - `{ valid: null }` when the input is empty (not yet filled in).
 */
export function validateDieInput(
  raw: string,
  sides: number,
):
  | { valid: true; value: number }
  | { valid: false; error: string }
  | { valid: null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: null };
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, error: 'Enter a whole number' };
  }
  const n = parseInt(trimmed, 10);
  if (n < 1 || n > sides) {
    return { valid: false, error: `Must be between 1 and ${sides}` };
  }
  return { valid: true, value: n };
}

/**
 * `true` when every die in every request has a filled integer value.
 * Submit is gated on this — the form cannot post a partial submission.
 */
export function allFilled(entries: DicePromptEntry[]): boolean {
  if (entries.length === 0) return false;
  return entries.every((e) =>
    e.entries.every((v) => typeof v === 'number'),
  );
}

/**
 * Client-side execution of a dice roll — the "Roll for me" path. Uses the
 * same CSPRNG-backed parser/executor as the backend's `roll_dice` tool so
 * the two paths are byte-identical in distribution. Returns raw face values
 * (no modifier applied — modifiers belong to the backend per the design
 * doc's "raw rolls only" rule).
 */
export function rollForMe(notation: string): number[] {
  return executeDiceRoll(notation).results;
}

export { DiceNotationError };
