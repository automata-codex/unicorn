import { describe, expect, it } from 'vitest';

import { checkSystemRolledPlayerAction } from './system-rolled-player-action';
import { fakeDiceRoll, fakeTurnExecutionResult } from './test-helpers';

const CAMPAIGN_STATE_WITH_PLAYER = {
  resourcePools: {
    alvarez_hp: { current: 10, max: 20 },
    alvarez_armor: { current: 5, max: 10 },
    veridian_contractor_alpha_hp: { current: 8, max: 15 },
  },
};

describe('checkSystemRolledPlayerAction', () => {
  it('passes when no player-attributed consequence roll appears this turn (boundary)', () => {
    const result = fakeTurnExecutionResult({
      campaignState: CAMPAIGN_STATE_WITH_PLAYER,
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Contractor Alpha combat attack roll against Alvarez',
        }),
      ],
    });

    expect(checkSystemRolledPlayerAction(result).outcome).toBe('PASSED');
  });

  it('fails when the player-attributed damage roll appears system-side (deliberately-broken counterexample, from real replayed output)', () => {
    const result = fakeTurnExecutionResult({
      campaignState: CAMPAIGN_STATE_WITH_PLAYER,
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Contractor Alpha combat attack roll against Alvarez',
        }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Alvarez rifle damage if her attack hits',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 2/);
  });

  it('does not flag an NPC damage roll that merely mentions the player as the target', () => {
    const result = fakeTurnExecutionResult({
      campaignState: CAMPAIGN_STATE_WITH_PLAYER,
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Contractor rifle damage to Alvarez if hit lands',
        }),
      ],
    });

    expect(checkSystemRolledPlayerAction(result).outcome).toBe('PASSED');
  });

  it('is not fooled by an unrelated pending dice_request into ignoring a system-rolled player consequence', () => {
    // Confirmed against real replayed output: the same turn can defer the
    // to-hit roll to the player (a genuinely pending dice_request) while
    // still pre-rolling the player's own damage system-side — the pending
    // request for a *different* roll must not excuse this.
    const result = fakeTurnExecutionResult({
      campaignState: CAMPAIGN_STATE_WITH_PLAYER,
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Alvarez rifle damage if hit',
        }),
      ],
      diceRequests: [
        {
          id: 'req-1',
          adventureId: 'a1',
          issuedAtSequence: 1,
          notation: '1d100',
          purpose: 'Alvarez shoots contractor Alpha — roll under Combat to hit',
          target: 30,
          status: 'pending',
          resolvedAtSequence: null,
          resolvedAt: null,
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
        },
      ],
    });

    expect(checkSystemRolledPlayerAction(result).outcome).toBe('FAILED');
  });

  it('is not applicable when there are no dice_roll events at all (boundary)', () => {
    const result = fakeTurnExecutionResult({
      campaignState: CAMPAIGN_STATE_WITH_PLAYER,
      gameEvents: [],
    });

    const verdict = checkSystemRolledPlayerAction(result);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/no dice_roll events/);
  });

  it('is not applicable when no player entity can be identified from campaignState (boundary)', () => {
    const result = fakeTurnExecutionResult({
      campaignState: {},
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Alvarez rifle damage if hit',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/no player entity could be identified/);
  });
});
