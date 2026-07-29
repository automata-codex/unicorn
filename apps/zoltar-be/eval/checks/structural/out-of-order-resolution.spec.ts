import { describe, expect, it } from 'vitest';

import { checkOutOfOrderResolution } from './out-of-order-resolution';
import {
  fakeDiceRoll,
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

const CHECK_ID = 'out-of-order-resolution';

const APPLICABLE_FIXTURE = fakeFixture({
  tag: 'OUT-OF-ORDER-RESOLUTION',
  applicability: {
    [CHECK_ID]: {
      applies: true,
      playerEntity: 'Alvarez',
      situation:
        'Alvarez declares an attack requiring a to-hit roll to resolve before any damage roll.',
    },
  },
});

const NOT_APPLICABLE_FIXTURE = fakeFixture({
  tag: 'OUT-OF-ORDER-RESOLUTION',
  applicability: {
    [CHECK_ID]: {
      applies: false,
      situation:
        'Alvarez only asks a clarifying question this turn — no action is declared that would ' +
        'trigger a resolution roll, so there is no ordering for this check to grade.',
    },
  },
});

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

    expect(checkOutOfOrderResolution(result, APPLICABLE_FIXTURE).outcome).toBe(
      'PASSED',
    );
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

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 2/);
    expect(verdict.actual).toMatch(/not been confirmed yet/);
  });

  it('fails on "if player hits" (conjugated/plural form), from real replayed output (deliberately-broken counterexample)', () => {
    // Real case, turn19-out-of-order-resolution: CONDITIONAL_DAMAGE_PATTERN
    // used a bare `hit` alternative instead of `hits?` — `\bhit\b` never
    // matches inside "hits" (no word boundary between "t" and "s"), so this
    // roll's damage was silently missed even though its sibling roll on the
    // same turn ("Contractor rifle damage if hit") was correctly flagged.
    // This is the more severe of the two: Alvarez's own rifle damage,
    // pre-rolled and stated as "already rolled" while her own Combat/to-hit
    // roll is still an open, unresolved dice_request.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 3,
          purpose: 'Contractor rifle damage if hit',
        }),
        fakeDiceRoll({
          sequenceNumber: 4,
          purpose: 'Alvarez rifle damage if player hits',
        }),
      ],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 3/);
    expect(verdict.actual).toMatch(/sequence 4/);
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

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
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

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/before this turn's player_action/);
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

    expect(checkOutOfOrderResolution(result, APPLICABLE_FIXTURE).outcome).toBe(
      'PASSED',
    );
  });

  it("is not applicable when no dice_roll appears and the player's gating roll was deferred to a pending dice_request — the ordering evidence is on a following turn this fixture does not contain", () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
      ],
      diceRequests: [
        {
          id: 'req-1',
          adventureId: 'a1',
          issuedAtSequence: 2,
          notation: '1d100',
          purpose: 'Alvarez Combat roll to hit veridian_contractor_alpha',
          target: 30,
          status: 'pending',
          resolvedAtSequence: null,
          resolvedAt: null,
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
        },
      ],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/following turn/);
    expect(verdict.actual).not.toMatch(/no dice_roll events this turn/);
  });

  it('is not applicable when the turn has no dice_roll and no pending dice_request at all (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
      ],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/nothing to order/);
  });

  it("is not applicable when the fixture's situation does not call for this check", () => {
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    const verdict = checkOutOfOrderResolution(result, NOT_APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/clarifying question/);
  });

  it('throws when the fixture is at schema version 2+ but has no applicability entry for this check', () => {
    const fixture = fakeFixture({
      tag: 'OUT-OF-ORDER-RESOLUTION',
      fixtureSchemaVersion: 2,
    });
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    expect(() => checkOutOfOrderResolution(result, fixture)).toThrow(
      /no applicability entry/,
    );
  });
});
