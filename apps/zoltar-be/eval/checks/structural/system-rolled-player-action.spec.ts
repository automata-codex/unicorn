import { describe, expect, it } from 'vitest';

import { checkSystemRolledPlayerAction } from './system-rolled-player-action';
import {
  fakeDiceRequest,
  fakeDiceRoll,
  fakeTurnExecutionResult,
} from './test-helpers';

describe('checkSystemRolledPlayerAction', () => {
  it('passes when the first dice_roll carries roll_source=player_entered', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'player attack roll',
          rollSource: 'player_entered',
        }),
      ],
    });

    expect(checkSystemRolledPlayerAction(result).passed).toBe(true);
  });

  it('fails when the first dice_roll is system-generated with no pending dice_request (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'player attack roll',
          rollSource: 'system_generated',
        }),
      ],
      diceRequests: [],
    });

    const verdict = checkSystemRolledPlayerAction(result);
    expect(verdict.passed).toBe(false);
    expect(verdict.actual).toMatch(/system_generated/);
  });

  it('passes when the first dice_roll is system-generated but a separate dice_request is pending', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'NPC reaction roll',
          rollSource: 'system_generated',
        }),
      ],
      diceRequests: [
        fakeDiceRequest({ notation: '1d10', purpose: 'Fear save' }),
      ],
    });

    expect(checkSystemRolledPlayerAction(result).passed).toBe(true);
  });

  it('passes when there are no dice_roll events and no pending dice_request (boundary)', () => {
    const result = fakeTurnExecutionResult();

    expect(checkSystemRolledPlayerAction(result).passed).toBe(true);
  });

  it('passes when there are no dice_roll events but a dice_request is pending', () => {
    const result = fakeTurnExecutionResult({
      diceRequests: [
        fakeDiceRequest({ notation: '1d10', purpose: 'Fear save' }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result);
    expect(verdict.passed).toBe(true);
    expect(verdict.actual).toMatch(/deferred to the player/);
  });
});
