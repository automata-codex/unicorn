import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

/** Same signal `OUT-OF-ORDER-RESOLUTION` uses: a damage roll phrased as
 * conditional on an unconfirmed hit is a consequence roll for a
 * just-declared action. Here it identifies *which* rolls represent an
 * action's resolution at all, not their timing. */
const CONDITIONAL_DAMAGE_PATTERN =
  /\b(damage|dmg)\b[^.]{0,40}\bif\b[^.]{0,30}\b(hits?|succeeds?|lands?|connects?)\b/i;

/** Naming tokens that mark an entity as clearly NPC-side, so a resource
 * pool prefix containing one of these is never treated as "the player." */
const NPC_TOKEN_PATTERN =
  /\b(contractor|guard|android|unit-?\d+|soldier|mercenary|enemy|hostile|npc)\b/i;

/**
 * Derives candidate player-entity names from `campaignState.resourcePools`
 * keys (`{entity_id}_{pool_name}`, per this repo's naming convention —
 * `alvarez_hp`, `alvarez_armor`). There's no canonical "this is the player
 * character" field anywhere in `TurnExecutionResult` — the harness doesn't
 * seed `character_sheet` rows (see `harness-runner.ts`) — so this is a
 * heuristic: any `_hp`/`_armor`/`_stress`-suffixed pool prefix that doesn't
 * look like an NPC is treated as a player-entity candidate. Real captured
 * data can carry more than one candidate for the same character (e.g. both
 * `alvarez` and `lt_alvarez`) — all candidates are accepted.
 */
function candidatePlayerEntityNames(
  campaignState: Record<string, unknown>,
): string[] {
  const resourcePools =
    (campaignState as { resourcePools?: Record<string, unknown> })
      .resourcePools ?? {};
  const names = new Set<string>();
  for (const key of Object.keys(resourcePools)) {
    const match = key.match(/^(.+?)_(hp|armor|stress)$/i);
    if (!match) continue;
    const candidate = match[1].replace(/_/g, ' ').trim();
    if (!candidate || NPC_TOKEN_PATTERN.test(candidate)) continue;
    names.add(candidate.toLowerCase());
  }
  return [...names];
}

function isPlayerAttributed(
  purpose: string,
  candidateNames: string[],
): boolean {
  const lower = purpose.toLowerCase();
  return candidateNames.some((name) => lower.startsWith(name));
}

/**
 * SYSTEM-ROLLED-PLAYER-ACTION: a roll representing the player's own
 * declared action's consequence (identified via `CONDITIONAL_DAMAGE_PATTERN`
 * + player-entity attribution) should never appear as an already-resolved
 * `dice_roll` event straight from the Warden's tool loop — a well-behaved
 * turn defers it via a `dice_request` instead, resolved in a later turn.
 * Its presence *at all* is the violation; `roll_source` isn't a useful
 * signal here despite the tag's name — every tool-loop roll is
 * unconditionally `system_generated` regardless of which entity it
 * represents, so checking its value can't distinguish "correctly
 * system-rolled NPC action" from "incorrectly system-rolled player action."
 */
export function checkSystemRolledPlayerAction(
  result: TurnExecutionResult,
): StructuralVerdict {
  const diceRolls = result.gameEvents.filter(
    (e) => e.eventType === 'dice_roll',
  );

  if (diceRolls.length === 0) {
    return { outcome: 'NOT_APPLICABLE', actual: 'no dice_roll events this turn' };
  }

  const candidateNames = candidatePlayerEntityNames(result.campaignState);
  if (candidateNames.length === 0) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'no player entity could be identified from campaignState.resourcePools — nothing to check',
    };
  }

  const violations = diceRolls.filter((roll) => {
    const purpose = (roll.payload as DiceRollEventPayload).purpose ?? '';
    return (
      CONDITIONAL_DAMAGE_PATTERN.test(purpose) &&
      isPlayerAttributed(purpose, candidateNames)
    );
  });

  if (violations.length === 0) {
    return {
      outcome: 'PASSED',
      actual: 'no player-attributed consequence roll was resolved system-side this turn',
    };
  }

  return {
    outcome: 'FAILED',
    actual: violations
      .map(
        (r) =>
          `sequence ${r.sequenceNumber}: purpose "${(r.payload as DiceRollEventPayload).purpose}" ` +
          "— the player's own consequence roll was resolved by the system " +
          'instead of deferred to a dice_request',
      )
      .join('; '),
  };
}
