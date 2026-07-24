import { describe, expect, it } from 'vitest';

import { checkOutOfOrderResolution } from './out-of-order-resolution';
import {
  fakeDiceRoll,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

describe('checkOutOfOrderResolution', () => {
  it('passes when a to-hit roll resolves with no conditional damage language', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Contractor Alpha combat attack roll against Alvarez',
        }),
        fakeDiceRoll({
          sequenceNumber: 3,
          purpose: 'Contractor Alpha damage — hit confirmed',
        }),
      ],
    });

    expect(checkOutOfOrderResolution(result).outcome).toBe('PASSED');
  });

  it('fails when a damage roll is phrased conditionally on an unconfirmed hit (deliberately-broken counterexample, from real replayed output)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Alvarez rifle damage if combat roll succeeds',
        }),
      ],
    });

    const verdict = checkOutOfOrderResolution(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 2/);
    expect(verdict.actual).toMatch(/not been confirmed yet/);
  });

  it('fails on conditional damage language even with no separate to-hit roll present in the turn (the to-hit is deferred to the player)', () => {
    // Confirmed against real replayed output: the Warden sometimes pre-rolls
    // damage "if combat roll succeeds" while leaving the actual to-hit roll
    // to the player (a pending dice_request), so there's no second roll in
    // this turn's own events to compare against at all.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Contractor weapon damage if hit',
        }),
      ],
      diceRequests: [
        {
          id: 'req-1',
          adventureId: 'a1',
          issuedAtSequence: 1,
          notation: '1d100',
          purpose: 'Alvarez Combat roll to hit',
          target: 30,
          status: 'pending',
          resolvedAtSequence: null,
          resolvedAt: null,
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
        },
      ],
    });

    const verdict = checkOutOfOrderResolution(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 2/);
  });

  it("fails when a dice_roll precedes the turn's own player_action", () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 1, purpose: 'Combat roll for Alvarez' }),
        fakeGameEvent({ sequenceNumber: 2, eventType: 'player_action' }),
      ],
    });

    const verdict = checkOutOfOrderResolution(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/before this turn's player_action/);
  });

  it('is not applicable when there are no dice_roll events at all (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
      ],
    });

    const verdict = checkOutOfOrderResolution(result);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/no dice_roll events/);
  });

  it('does not false-positive on a damage roll with no conditional phrasing (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Contractor Alpha combat attack roll against Alvarez',
        }),
        fakeDiceRoll({
          sequenceNumber: 3,
          purpose: 'Contractor Alpha damage roll, attack landed',
        }),
      ],
    });

    expect(checkOutOfOrderResolution(result).outcome).toBe('PASSED');
  });
});
