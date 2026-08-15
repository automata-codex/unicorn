import { describe, expect, it } from 'vitest';

import { checkCarryoverArithmetic } from './carryover-arithmetic';
import {
  fakeDiceRoll,
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

import type { TurnExecutionResult } from '../../turn-result';

const fixture = fakeFixture({ tag: 'CARRYOVER-ARITHMETIC' });

interface PoolChange {
  owner: string;
  pool: string;
  delta: number;
  reason?: string;
  damageType?: string;
}

/**
 * A turn that proposed `changes` and left `alvarez.hp` at `endCurrent` of
 * `hpMax`. `campaignState` is the POST-turn state, which is what the harness
 * captures, so the checker reconstructs the starting value by unwinding the
 * deltas — the property the in-order fold guarantees.
 */
function turnWith(
  changes: PoolChange[],
  pools: Record<string, { current: number; max: number | null }>,
  damageRolled?: number,
): TurnExecutionResult {
  return fakeTurnExecutionResult({
    gameEvents: [
      ...(damageRolled === undefined
        ? []
        : [
            fakeDiceRoll({
              sequenceNumber: 1,
              purpose: 'Gunshot damage',
              rollType: 'damage',
              actingEntityId: 'alvarez',
              total: damageRolled,
            }),
          ]),
      fakeGameEvent({
        sequenceNumber: 2,
        eventType: 'gm_response',
        payload: { stateChanges: { resourcePools: changes } },
      }),
    ],
    campaignState: { resourcePools: { alvarez: pools } },
  });
}

const damage = (delta: number): PoolChange => ({
  owner: 'alvarez',
  pool: 'hp',
  delta,
  reason: 'gunshot',
  damageType: 'gunshot',
});
const reset = (delta: number): PoolChange => ({
  owner: 'alvarez',
  pool: 'hp',
  delta,
  reason: 'reset to Maximum minus carryover',
});
const wound = (): PoolChange => ({
  owner: 'alvarez',
  pool: 'wounds',
  delta: 1,
  reason: 'reached 0 Health',
});

describe('checkCarryoverArithmetic', () => {
  it('passes a chain that resets to Maximum minus carryover', () => {
    // 10 Health, hit for 14: carryover 4, so Health resets to 20 - 4 = 16.
    //
    // The damage *delta* is -10, not -14: `hp.min` is 0 since Part 1, so the
    // validator rejects anything below the floor and the four points of
    // carryover are nowhere in the pool change. They are in the roll, which
    // is why this check reads both.
    const verdict = checkCarryoverArithmetic(
      turnWith(
        [damage(-10), wound(), reset(16)],
        {
          hp: { current: 16, max: 20 },
        },
        14,
      ),
      fixture,
    );
    expect(verdict.outcome).toBe('PASSED');
    expect(verdict.actual).toContain('carryover 4');
  });

  it('passes a chain with no carryover at all', () => {
    // 10 Health, hit for exactly 10: nothing carries, full reset.
    const verdict = checkCarryoverArithmetic(
      turnWith(
        [damage(-10), wound(), reset(20)],
        {
          hp: { current: 20, max: 20 },
        },
        10,
      ),
      fixture,
    );
    expect(verdict.outcome).toBe('PASSED');
    expect(verdict.actual).toContain('carryover 0');
  });

  it('fails a reset that discards the carryover', () => {
    // The likeliest error: reset to full Maximum and forget the excess.
    const verdict = checkCarryoverArithmetic(
      turnWith(
        [damage(-10), wound(), reset(20)],
        {
          hp: { current: 20, max: 20 },
        },
        14,
      ),
      fixture,
    );
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toContain('should reset to 16');
  });

  it('fails a reset that applies the carryover twice', () => {
    const verdict = checkCarryoverArithmetic(
      turnWith(
        [damage(-10), wound(), reset(12)],
        {
          hp: { current: 12, max: 20 },
        },
        14,
      ),
      fixture,
    );
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toContain('should reset to 16');
  });

  it('fails when a chain ran but no damage roll is attributed', () => {
    // The carryover has no input to check against, which is a gap worth
    // surfacing rather than a pass — a wounds chain with no damage roll means
    // the Warden decided the damage itself.
    const verdict = checkCarryoverArithmetic(
      turnWith([damage(-10), wound(), reset(16)], {
        hp: { current: 16, max: 20 },
      }),
      fixture,
    );
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toContain('no damage roll');
  });

  it('is not applicable to ordinary damage with no wound', () => {
    const verdict = checkCarryoverArithmetic(
      turnWith([damage(-4)], { hp: { current: 16, max: 20 } }, 4),
      fixture,
    );
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actualCode).toBe('no-chain');
  });

  it('is not applicable when a wound was taken but Health never reset', () => {
    // One hp entry is not a chain: there is no reset to check.
    const verdict = checkCarryoverArithmetic(
      turnWith([damage(-10), wound()], { hp: { current: 0, max: 20 } }, 10),
      fixture,
    );
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
  });

  it('is not applicable to a pre-M7.6 artifact, permanently', () => {
    // The compatibility branch (§6.1, the `rollType` precedent). Frozen runs
    // carried `resourcePools` as a map keyed by pool name, and a turn that
    // could not express a chain cannot have got its arithmetic wrong.
    const verdict = checkCarryoverArithmetic(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeGameEvent({
            sequenceNumber: 2,
            eventType: 'gm_response',
            payload: {
              stateChanges: { resourcePools: { alvarez_hp: { delta: -4 } } },
            },
          }),
        ],
      }),
      fixture,
    );
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actualCode).toBe('no-pool-array');
  });

  it('grades the correction when one fired, not the rejected original', () => {
    const verdict = checkCarryoverArithmetic(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({
            sequenceNumber: 1,
            purpose: 'Gunshot damage',
            rollType: 'damage',
            actingEntityId: 'alvarez',
            total: 14,
          }),
          fakeGameEvent({
            sequenceNumber: 2,
            eventType: 'gm_response',
            payload: {
              stateChanges: {
                resourcePools: [damage(-10), wound(), reset(20)],
              },
            },
          }),
          fakeGameEvent({
            sequenceNumber: 3,
            eventType: 'correction',
            payload: {
              stateChanges: {
                resourcePools: [damage(-10), wound(), reset(16)],
              },
            },
          }),
        ],
        campaignState: {
          resourcePools: { alvarez: { hp: { current: 16, max: 20 } } },
        },
      }),
      fixture,
    );
    expect(verdict.outcome).toBe('PASSED');
  });

  it('fails when hp carries no ceiling to reset against', () => {
    const verdict = checkCarryoverArithmetic(
      turnWith(
        [damage(-10), wound(), reset(16)],
        {
          hp: { current: 16, max: null },
        },
        14,
      ),
      fixture,
    );
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toContain('no ceiling');
  });

  it('checks each wounded character separately', () => {
    const verdict = checkCarryoverArithmetic(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({
            sequenceNumber: 1,
            purpose: 'Gunshot damage',
            rollType: 'damage',
            actingEntityId: 'alvarez',
            total: 14,
          }),
          fakeDiceRoll({
            sequenceNumber: 1,
            purpose: 'Blast damage',
            rollType: 'damage',
            actingEntityId: 'medic',
            total: 12,
          }),
          fakeGameEvent({
            sequenceNumber: 2,
            eventType: 'gm_response',
            payload: {
              stateChanges: {
                resourcePools: [
                  damage(-10),
                  wound(),
                  reset(16),
                  { owner: 'medic', pool: 'hp', delta: -12, reason: 'blast' },
                  { owner: 'medic', pool: 'wounds', delta: 1, reason: 'zero' },
                  { owner: 'medic', pool: 'hp', delta: 15, reason: 'reset' },
                ],
              },
            },
          }),
        ],
        campaignState: {
          resourcePools: {
            alvarez: { hp: { current: 16, max: 20 } },
            medic: { hp: { current: 15, max: 15 } },
          },
        },
      }),
      fixture,
    );
    // The medic started at 12, took 12, carryover 0, and reset to 15 of 15.
    // Alvarez's chain is correct too, so both pass.
    expect(verdict.outcome).toBe('PASSED');
    expect(verdict.actual).toContain('alvarez');
    expect(verdict.actual).toContain('medic');
  });
});
