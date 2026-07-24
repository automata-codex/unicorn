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

  // Verified-clean corpus: real turns manually confirmed (not hand-authored
  // boundary cases) to be correctly classified — see the memory/conversation
  // trail for how each was checked. Distinct from the synthetic cases above,
  // this is real field data a human actually verified the checker got right.
  it('[verified-clean, baseline run 97f804b2-c077-4ec0-ad11-d68a7d19192b, fixture turn19-system-rolled-player-action, adventure fd8f3158-00a0-4a42-84f5-0e959729c42f] both system-generated rolls this turn are NPC-attributed (Contractor Alpha\'s own to-hit and damage), and Alvarez\'s own Combat/rifle-damage roll was correctly deferred to a pending dice_request rather than resolved system-side', () => {
    const result = fakeTurnExecutionResult({
      campaignState: {
        resourcePools: {
          alvarez_hp: { max: 20, current: 20 },
          alvarez_armor: { max: 30, current: 30 },
          lt_alvarez_hp: { max: 20, current: 20 },
          alvarez_stress: { max: 3, current: 0 },
          hull_breach_timer: { max: 5, current: 5 },
          lt_alvarez_stress: { max: 3, current: 0 },
          station_power_reserve: { max: 4, current: 4 },
          station_power_integrity: { max: 10, current: 6 },
          android_memory_integrity: { max: 3, current: 3 },
          decommissioned_android_hp: { max: 12, current: 12 },
          contamination_spread_timer: { max: 6, current: 3 },
          signal_pattern_shift_timer: { max: 3, current: 3 },
          veridian_contractor_beta_hp: { max: 15, current: 15 },
          veridian_contractor_alpha_hp: { max: 15, current: 15 },
          veridian_contractor_delta_hp: { max: 15, current: 15 },
          veridian_contractor_gamma_hp: { max: 15, current: 15 },
          burned_out_medic_supply_timer: { max: 6, current: 6 },
        },
      },
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Contractor Alpha returning fire / acquiring target on Alvarez',
          total: 92,
        }),
        fakeDiceRoll({
          sequenceNumber: 3,
          purpose: 'Contractor Alpha damage if hit',
          total: 7,
        }),
      ],
      // Alvarez's own Combat-to-hit (and contingent rifle damage) was
      // surfaced as a pending dice_request, never resolved system-side —
      // the actual gm_response's diceRequests field for this turn.
      diceRequests: [
        {
          id: 'real-req-1',
          adventureId: 'fd8f3158-00a0-4a42-84f5-0e959729c42f',
          issuedAtSequence: 4,
          notation: '1d100',
          purpose: 'Combat roll to shoot the contractor at the equipment bay door',
          target: 30,
          status: 'pending',
          resolvedAtSequence: null,
          resolvedAt: null,
          createdAt: new Date('2026-07-14T12:31:33.719Z'),
        },
      ],
    });

    expect(checkSystemRolledPlayerAction(result).outcome).toBe('PASSED');
  });
});
