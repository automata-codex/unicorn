import { describe, expect, it } from 'vitest';

import { fakeGameEvent, fakeTurnExecutionResult } from './test-helpers';
import { checkToolSyntaxLeak } from './tool-syntax-leak';

function turnWith(events: Parameters<typeof fakeTurnExecutionResult>[0]) {
  return fakeTurnExecutionResult(events);
}

function gmResponse(sequenceNumber: number, playerText: string) {
  return fakeGameEvent({
    sequenceNumber,
    eventType: 'gm_response',
    payload: { playerText },
  });
}

function correction(sequenceNumber: number, playerText: string) {
  return fakeGameEvent({
    sequenceNumber,
    eventType: 'correction',
    payload: { playerText },
  });
}

// The shape the 2026-08-16 playtest lost 39 turns to, trimmed.
const LEAKED =
  'The lever refuses to move.</playerText>\n' +
  '<parameter name="stateChanges">{"resourcePools":[{"owner":"dr_kennedy","pool":"hp","delta":-12}]}</parameter>';

describe('checkToolSyntaxLeak', () => {
  it('passes clean narration', () => {
    const verdict = checkToolSyntaxLeak(
      turnWith({
        gameEvents: [gmResponse(2, 'The reactor housing hums, amber and low.')],
      }),
    );
    expect(verdict.outcome).toBe('PASSED');
  });

  it('fails narration carrying tool-call markup', () => {
    const verdict = checkToolSyntaxLeak(
      turnWith({ gameEvents: [gmResponse(2, LEAKED)] }),
    );
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/raw tool-call syntax/);
    expect(verdict.actual).toContain('</playerText>');
  });

  it('grades the correction, not the superseded original', () => {
    // The player saw the correction. A leak the correction round fixed is
    // not a leak the player was shown.
    const verdict = checkToolSyntaxLeak(
      turnWith({
        gameEvents: [
          gmResponse(2, LEAKED),
          correction(3, 'The lever refuses to move.'),
        ],
      }),
    );
    expect(verdict.outcome).toBe('PASSED');
  });

  it('fails when the correction is the one that leaked', () => {
    const verdict = checkToolSyntaxLeak(
      turnWith({
        gameEvents: [
          gmResponse(2, 'The lever refuses to move.'),
          correction(3, LEAKED),
        ],
      }),
    );
    expect(verdict.outcome).toBe('FAILED');
  });

  it('is not applicable when the turn produced no response event', () => {
    // A `diceResult` submission without auto-advance resolves a roll and
    // writes no gm_response — there is no narration to inspect.
    const verdict = checkToolSyntaxLeak(
      turnWith({
        gameEvents: [
          fakeGameEvent({ sequenceNumber: 2, eventType: 'dice_roll' }),
        ],
      }),
    );
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
  });

  it('treats a missing playerText as clean rather than throwing', () => {
    const verdict = checkToolSyntaxLeak(
      turnWith({
        gameEvents: [
          fakeGameEvent({
            sequenceNumber: 2,
            eventType: 'gm_response',
            payload: {},
          }),
        ],
      }),
    );
    expect(verdict.outcome).toBe('PASSED');
  });

  it('does not fire on narration that merely contains an angle bracket', () => {
    const verdict = checkToolSyntaxLeak(
      turnWith({
        gameEvents: [
          gmResponse(
            2,
            'Her pulse is < 40. The stencil reads <MANUAL OVERRIDE>.',
          ),
        ],
      }),
    );
    expect(verdict.outcome).toBe('PASSED');
  });
});
