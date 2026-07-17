import { describe, expect, it } from 'vitest';

import { checkOutOfOrderResolution } from './out-of-order-resolution';
import {
  fakeDiceRoll,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

describe('checkOutOfOrderResolution', () => {
  it('passes when to-hit resolves before damage for the same entity', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'to-hit vs corporate_spy_1',
        }),
        fakeDiceRoll({
          sequenceNumber: 3,
          purpose: 'damage vs corporate_spy_1',
        }),
      ],
    });

    expect(checkOutOfOrderResolution(result).passed).toBe(true);
  });

  it('fails when damage fires before its to-hit roll resolves (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'damage vs corporate_spy_1',
        }),
        fakeDiceRoll({
          sequenceNumber: 3,
          purpose: 'to-hit vs corporate_spy_1',
        }),
      ],
    });

    const verdict = checkOutOfOrderResolution(result);
    expect(verdict.passed).toBe(false);
    expect(verdict.actual).toMatch(/corporate_spy_1/);
    expect(verdict.actual).toMatch(/sequence 2/);
  });

  it("fails when a dice_roll precedes the turn's own player_action", () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 1, purpose: 'to-hit vs dr_chen' }),
        fakeGameEvent({ sequenceNumber: 2, eventType: 'player_action' }),
      ],
    });

    const verdict = checkOutOfOrderResolution(result);
    expect(verdict.passed).toBe(false);
    expect(verdict.actual).toMatch(/before this turn's player_action/);
  });

  it('passes when there are no dice_roll events at all (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
      ],
    });

    const verdict = checkOutOfOrderResolution(result);
    expect(verdict.passed).toBe(true);
  });

  it('does not flag damage/to-hit rolls for different entities against each other', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({ sequenceNumber: 2, purpose: 'damage vs dr_chen' }),
        fakeDiceRoll({
          sequenceNumber: 3,
          purpose: 'to-hit vs corporate_spy_1',
        }),
      ],
    });

    expect(checkOutOfOrderResolution(result).passed).toBe(true);
  });
});
