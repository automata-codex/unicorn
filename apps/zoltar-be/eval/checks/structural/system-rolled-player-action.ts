import type { TurnExecutionResult } from '../../harness-runner';
import type { StructuralVerdict } from './types';

/**
 * SYSTEM-ROLLED-PLAYER-ACTION: the player's own declared action should
 * either be rolled by the player (`roll_source: player_entered`) or
 * deferred to them via a pending `dice_request` — never silently rolled by
 * the system on their behalf. Heuristic: "the player's declared action" is
 * approximated as the chronologically-first `dice_roll` event this turn,
 * since `writeTurnEvents` always writes player_action, then dice_roll(s),
 * then gm_response — the first roll after player_action is the one most
 * likely resolving what the player just declared, before any consequential
 * NPC/system rolls that follow from it.
 */
export function checkSystemRolledPlayerAction(
  result: TurnExecutionResult,
): StructuralVerdict {
  const diceRolls = result.gameEvents
    .filter((e) => e.eventType === 'dice_roll')
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  if (diceRolls.length === 0) {
    const pendingRequest = result.diceRequests.find(
      (r) => r.status === 'pending',
    );
    if (pendingRequest) {
      return {
        passed: true,
        actual: `no dice_roll events this turn; a pending dice_request exists (notation ${pendingRequest.notation}) — deferred to the player`,
      };
    }
    return {
      passed: true,
      actual:
        'no dice_roll events and no pending dice_request this turn — nothing to check',
    };
  }

  const firstRoll = diceRolls[0];
  if (firstRoll.rollSource === 'player_entered') {
    return {
      passed: true,
      actual: `first dice_roll (sequence ${firstRoll.sequenceNumber}) carries roll_source=player_entered`,
    };
  }

  const pendingRequest = result.diceRequests.find(
    (r) => r.status === 'pending',
  );
  if (pendingRequest) {
    return {
      passed: true,
      actual:
        `first dice_roll (sequence ${firstRoll.sequenceNumber}) has ` +
        `roll_source=${firstRoll.rollSource ?? 'null'}, but a separate ` +
        `pending dice_request (notation ${pendingRequest.notation}) exists — ` +
        'the system deferred at least one roll to the player this turn',
    };
  }

  return {
    passed: false,
    actual:
      `first dice_roll (sequence ${firstRoll.sequenceNumber}, presumed to ` +
      `resolve the player's declared action) has ` +
      `roll_source=${firstRoll.rollSource ?? 'null'} and no pending ` +
      'dice_request exists — the system appears to have rolled the ' +
      "player's own action instead of asking them",
  };
}
