import { describe, expect, it } from 'vitest';

import { fakeDiceRoll, fakeTurnExecutionResult } from './test-helpers';
import { checkUnauditableMapping } from './unauditable-mapping';

describe('checkUnauditableMapping', () => {
  it('passes when a narrative-selection roll states its mapping up front', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose:
            'determine which faction responds: 1-3=guards, 4-6=corporate spy',
        }),
      ],
    });

    expect(checkUnauditableMapping(result).passed).toBe(true);
  });

  it('fails when a narrative-selection roll fires with no stated mapping (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'determine which faction responds',
        }),
      ],
    });

    const verdict = checkUnauditableMapping(result);
    expect(verdict.passed).toBe(false);
    expect(verdict.actual).toMatch(
      /does not state a result-to-meaning mapping/,
    );
  });

  it('passes when the only rolls are pure mechanical resolution (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 1, purpose: 'to-hit vs dr_chen' }),
        fakeDiceRoll({ sequenceNumber: 2, purpose: 'damage vs dr_chen' }),
      ],
    });

    expect(checkUnauditableMapping(result).passed).toBe(true);
  });

  it('passes when there are no dice_roll events at all (boundary)', () => {
    expect(checkUnauditableMapping(fakeTurnExecutionResult()).passed).toBe(
      true,
    );
  });
});
