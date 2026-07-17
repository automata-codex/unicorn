import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { TurnExecutionResult } from '../../harness-runner';
import type { StructuralVerdict } from './types';

const TO_HIT_PATTERN = /\bto[- ]?hit\b|\baccuracy\b|\bhit\s+roll\b/i;
const DAMAGE_PATTERN = /\bdamage\b|\bdmg\b/i;

/**
 * `dice_roll` payloads carry no structured "target entity" field — only
 * free-text `purpose` (e.g. "to-hit vs corporate_spy_1"). This repo's entity
 * ids are always snake_case (CLAUDE.md "Naming Conventions": `dr_chen`,
 * `corporate_spy_1`, never hyphens/dots), so a snake_case token in `purpose`
 * is the closest available signal for "which entity is this roll about."
 * Rolls whose purpose carries no such token fall into a shared bucket —
 * best-effort, not a guaranteed-general parser.
 */
const ENTITY_TOKEN_PATTERN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;
const UNATTRIBUTED_BUCKET = '__unattributed__';

function extractEntityToken(purpose: string): string {
  const match = purpose.match(ENTITY_TOKEN_PATTERN);
  return match ? match[0] : UNATTRIBUTED_BUCKET;
}

/**
 * OUT-OF-ORDER-RESOLUTION: a damage roll must not fire before the to-hit
 * roll it depends on has resolved, and no dice_roll may precede the turn's
 * own player_action. `TO_HIT_PATTERN`/`DAMAGE_PATTERN` are heuristic
 * substring classifiers over free-text `purpose` — see spec's
 * OUT-OF-ORDER-RESOLUTION row for the caveat that this can't be a
 * guaranteed-general parser.
 */
export function checkOutOfOrderResolution(
  result: TurnExecutionResult,
): StructuralVerdict {
  const diceRolls = result.gameEvents
    .filter((e) => e.eventType === 'dice_roll')
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const playerAction = result.gameEvents.find(
    (e) => e.eventType === 'player_action',
  );
  if (playerAction) {
    const precedingRolls = diceRolls.filter(
      (r) => r.sequenceNumber < playerAction.sequenceNumber,
    );
    if (precedingRolls.length > 0) {
      return {
        passed: false,
        actual:
          `${precedingRolls.length} dice_roll event(s) occurred before this ` +
          `turn's player_action (sequence ${playerAction.sequenceNumber}): ` +
          `sequence(s) ${precedingRolls.map((r) => r.sequenceNumber).join(', ')}`,
      };
    }
  }

  const byEntity = new Map<string, { toHit: number[]; damage: number[] }>();
  for (const roll of diceRolls) {
    const purpose = (roll.payload as DiceRollEventPayload).purpose ?? '';
    const entity = extractEntityToken(purpose);
    const bucket = byEntity.get(entity) ?? { toHit: [], damage: [] };
    if (TO_HIT_PATTERN.test(purpose)) bucket.toHit.push(roll.sequenceNumber);
    if (DAMAGE_PATTERN.test(purpose)) bucket.damage.push(roll.sequenceNumber);
    byEntity.set(entity, bucket);
  }

  for (const [entity, { toHit, damage }] of byEntity) {
    if (toHit.length === 0 || damage.length === 0) continue;
    const earliestToHit = Math.min(...toHit);
    const earliestDamage = Math.min(...damage);
    if (earliestDamage < earliestToHit) {
      return {
        passed: false,
        actual:
          `for "${entity}": damage roll at sequence ${earliestDamage} ` +
          `occurred before its to-hit roll at sequence ${earliestToHit}`,
      };
    }
  }

  return {
    passed: true,
    actual: `${diceRolls.length} dice_roll event(s) this turn, no damage-before-to-hit ordering violation found`,
  };
}
