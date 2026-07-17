import { describe, expect, it } from 'vitest';

import { fakeDiceRoll, fakeTurnExecutionResult } from './test-helpers';
import { checkUnsurfacedCheck } from './unsurfaced-check';

describe('checkUnsurfacedCheck', () => {
  it('passes when no rolls gate player-visible content (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 1, purpose: 'to-hit vs dr_chen' }),
      ],
    });

    expect(checkUnsurfacedCheck(result).passed).toBe(true);
  });

  it('fails when a stakes-gating roll resolves system-side with no surfaced dice_request (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'notice the hidden door',
          rollSource: 'system_generated',
        }),
      ],
    });

    const verdict = checkUnsurfacedCheck(result);
    expect(verdict.passed).toBe(false);
    expect(verdict.actual).toMatch(/resolved system-side/);
  });

  it('passes when the stakes-gating roll is player-entered', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'search the room for hidden compartments',
          rollSource: 'player_entered',
        }),
      ],
    });

    expect(checkUnsurfacedCheck(result).passed).toBe(true);
  });

  it('passes when the stakes-gating roll resolves a surfaced dice_request (requestId present)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'spot the ambush',
          rollSource: 'system_generated',
          requestId: 'req-1',
        }),
      ],
    });

    expect(checkUnsurfacedCheck(result).passed).toBe(true);
  });
});
