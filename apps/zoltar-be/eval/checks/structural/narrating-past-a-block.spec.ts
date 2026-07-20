import { describe, expect, it } from 'vitest';

import { checkNarratingPastABlock } from './narrating-past-a-block';
import {
  fakeDiceRequest,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

describe('checkNarratingPastABlock', () => {
  it('passes when nothing is blocked (no pending dice_request) — boundary', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: { playerText: 'The corridor is quiet.' },
        }),
      ],
    });

    expect(checkNarratingPastABlock(result).passed).toBe(true);
  });

  it('fails when a dice_request is pending but playerText narrates the outcome anyway (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText: 'You swing and the attack succeeds, dealing damage.',
          },
        }),
      ],
      diceRequests: [fakeDiceRequest({ notation: '1d10', purpose: 'to-hit' })],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.passed).toBe(false);
    expect(verdict.actual).toMatch(/resolution language/);
  });

  it('passes when a dice_request is pending and playerText stops at the block point', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: { playerText: 'Roll to see if your attack connects.' },
        }),
      ],
      diceRequests: [fakeDiceRequest({ notation: '1d10', purpose: 'to-hit' })],
    });

    expect(checkNarratingPastABlock(result).passed).toBe(true);
  });

  it('fails on block-acknowledging language even with no pending dice_request (missing-data block, deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText:
              "What's your Instinct score? While you're deciding, here's " +
              'what your body is already doing regardless of the number: ' +
              "the contractor's boot shifts weight.",
          },
        }),
      ],
      // No pending dice_request at all — this turn is blocked on a missing
      // stat value, not a roll. The dice_request-based signal alone would
      // never catch this.
      diceRequests: [],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.passed).toBe(false);
    expect(verdict.actual).toMatch(/acknowledges an unresolved decision/);
  });

  it('does not false-positive on unrelated uses of "while" or "regardless" (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText:
              'While you catch your breath, the corridor stays quiet. ' +
              'Regardless of the noise outside, nothing here has moved.',
          },
        }),
      ],
      diceRequests: [],
    });

    expect(checkNarratingPastABlock(result).passed).toBe(true);
  });

  it('prefers the correction event over the original gm_response when both exist', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: { playerText: 'You hit and deal damage.' },
        }),
        fakeGameEvent({
          sequenceNumber: 4,
          eventType: 'correction',
          payload: { playerText: 'Roll to see if your attack connects.' },
        }),
      ],
      diceRequests: [fakeDiceRequest({ notation: '1d10', purpose: 'to-hit' })],
    });

    expect(checkNarratingPastABlock(result).passed).toBe(true);
  });
});
