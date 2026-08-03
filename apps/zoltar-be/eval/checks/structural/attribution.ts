import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

/**
 * Binds a roll or request to the acting entity by the Warden's own naming
 * convention: purpose text leads with the acting entity's name ("Alvarez
 * rifle damage if hit"). `startsWith`, not `includes`, so a roll that merely
 * *mentions* the player as a target ("Contractor rifle damage to Alvarez if
 * hit lands") is correctly excluded — it doesn't start with the player's
 * name, only contains it.
 *
 * **This is a known prose dependency, and the only one left in the
 * structural checks.** `decisions.md`'s dividing line — a structural check
 * may read event and state structure but may not classify prose — is
 * violated here by necessity, not by choice: nothing in `game_events`
 * records *who acted*. `dice_roll` carries `actorType: 'gm' | 'player'`, but
 * every Warden-side roll is `'gm'` whether it represents an NPC's action or
 * the player's, which is precisely the distinction these checks exist to
 * make. The structural fix is an `actingEntityId` on the roll payload
 * (already anticipated in `eval/checks/registry.ts`); until that exists,
 * the leading-name convention is the only signal available.
 *
 * Because it is prose, it fails the way prose matching always fails here —
 * silently, by not matching, which reads as "the player's action doesn't
 * appear in this turn." `unbindableVerdict` below exists so that failure
 * mode reports as undecided instead of as a pass.
 */
export function isAttributedTo(purpose: string, playerEntity: string): boolean {
  return purpose.toLowerCase().startsWith(playerEntity.toLowerCase());
}

function rollPurpose(roll: TurnExecutionResult['gameEvents'][number]): string {
  return (roll.payload as DiceRollEventPayload).purpose ?? '';
}

/**
 * The guard against `isAttributedTo` failing silently.
 *
 * A checker reaches this point having found nothing bound to `playerEntity`.
 * Two different situations produce that, and they are not
 * interchangeable:
 *
 * 1. **The turn contains no rolls or pending requests at all.** Nothing was
 *    resolved system-side because nothing was resolved at all — a structural
 *    fact, independent of any prose. The caller may report it however its
 *    own assertion reads; this function returns `null` and stays out of the
 *    way.
 *
 * 2. **The turn contains rolls or requests, none of which bound.** They may
 *    genuinely all belong to NPCs, or one of them may be the player's own
 *    action phrased in a way the leading-name convention missed. Those two
 *    readings are indistinguishable from the data, and they carry opposite
 *    verdicts — a pass, or exactly the violation the check exists to catch.
 *    Returning a pass here is the false-pass shape that has already bitten
 *    `system-rolled-player-action` once (a system-rolled to-hit its
 *    damage-only matcher didn't recognize) and `unsurfaced-check` before
 *    that. So this reports `NOT_APPLICABLE` — undecided, excluded from the
 *    denominator, and named — rather than guessing.
 *
 * Costing a denominator is the point, not a side effect: a rep whose verdict
 * rests on a prose match having failed is not evidence, and counting it as
 * one is how a rate reaches 1.00 without the behaviour improving.
 */
export function unbindableVerdict(
  result: TurnExecutionResult,
  playerEntity: string,
): StructuralVerdict | null {
  // Only `dice_roll` events are considered. A `dice_request` needs no prose
  // binding at all — it is player-facing by construction (see
  // `system-rolled-player-action.ts`), so its presence is structural
  // evidence a caller can act on directly rather than an ambiguity.
  const unboundRolls = result.gameEvents
    .filter((e) => e.eventType === 'dice_roll')
    .filter((roll) => !isAttributedTo(rollPurpose(roll), playerEntity));

  if (unboundRolls.length === 0) return null;

  const candidates = unboundRolls.map((r) => `dice_roll "${rollPurpose(r)}"`);

  return {
    outcome: 'NOT_APPLICABLE',
    actual:
      `no dice_roll binds to ${playerEntity} by the leading-name convention and no ` +
      `dice_request was surfaced, but ${candidates.length} system-side roll(s) are ` +
      `present that cannot be attributed to any entity structurally: ${candidates.join('; ')}. ` +
      `They may all belong to NPCs, or one may be ${playerEntity}'s own action phrased ` +
      'without a leading name — the turn data cannot distinguish those, and they carry ' +
      'opposite verdicts. Undecided rather than guessed; needs `actingEntityId` on the ' +
      'roll payload to resolve.',
    // Every interpolation above is per-rep-variable (the Warden generates
    // this text fresh each rep), so exclusion aggregation groups on this
    // fixture-constant key instead — see `StructuralVerdict.actualCode`.
    actualCode: `no roll binds to ${playerEntity} and no dice_request was surfaced, but unattributable system-side rolls are present`,
  };
}
