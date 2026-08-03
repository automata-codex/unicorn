import { describe, expect, it } from 'vitest';

import {
  fakeDiceRoll,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';
import {
  isSpontaneousGmRoll,
  unauditableMappingGate,
  unauditableMappingJudgeContext,
} from './unauditable-mapping';

describe('isSpontaneousGmRoll', () => {
  it('accepts a single unmodified system-generated die resolving no request', () => {
    expect(
      isSpontaneousGmRoll(
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Ambient station event check',
          notation: '1d6',
          results: [4],
        }),
      ),
    ).toBe(true);
  });

  it('accepts bare "d20" notation as a single die', () => {
    expect(
      isSpontaneousGmRoll(
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'what she notices',
          notation: 'd20',
          results: [11],
        }),
      ),
    ).toBe(true);
  });

  it('rejects a player-entered roll', () => {
    expect(
      isSpontaneousGmRoll(
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Alvarez Combat roll',
          notation: '1d100',
          results: [62],
          rollSource: 'player_entered',
        }),
      ),
    ).toBe(false);
  });

  it('rejects a roll that resolves a dice_request', () => {
    // A surfaced roll had a `target` established and a player-facing
    // notation; its meaning was fixed by the request, not invented after
    // the die was read.
    expect(
      isSpontaneousGmRoll(
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Combat roll to shoot the contractor',
          notation: '1d100',
          results: [17],
          requestId: 'req-1',
        }),
      ),
    ).toBe(false);
  });

  it('rejects a multi-die roll', () => {
    const roll = fakeDiceRoll({
      sequenceNumber: 1,
      purpose: 'shotgun damage',
      notation: '2d10',
      results: [3, 7],
    });
    expect(isSpontaneousGmRoll(roll)).toBe(false);
  });

  it('rejects a modified roll', () => {
    const roll = fakeDiceRoll({
      sequenceNumber: 1,
      purpose: 'x',
      notation: '1d6',
    });
    (roll.payload as { modifier: number }).modifier = 2;
    expect(isSpontaneousGmRoll(roll)).toBe(false);
  });

  it('rejects a non-dice_roll event', () => {
    expect(
      isSpontaneousGmRoll(
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
      ),
    ).toBe(false);
  });

  it('classifies "Ambient station event check" the old regex could not see', () => {
    // `NARRATIVE_SELECTION_PATTERN` returned false NOT_APPLICABLE on twelve
    // turns of exactly this phrasing — the model's own dominant wording for
    // the roll type this check exists to grade. Nothing about the roll's
    // shape is ambiguous; only its wording was.
    expect(
      isSpontaneousGmRoll(
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Ambient station event check',
          notation: '1d6',
          results: [2],
        }),
      ),
    ).toBe(true);
  });
});

describe('unauditableMappingGate', () => {
  it('reports no-rolls and blind-spot as distinct reasons', () => {
    // The split is the deliverable. "The turn rolled nothing" is a fact
    // about the Warden and an honest exclusion; "it rolled N times and none
    // matched" is a fact about this classifier, and its count is the signal
    // that rolls are happening the check cannot see.
    const noRolls = unauditableMappingGate(
      fakeTurnExecutionResult({ gameEvents: [] }),
    );
    expect(noRolls?.outcome).toBe('NOT_APPLICABLE');
    expect(noRolls?.actualCode).toBe('no dice_roll events this turn');

    const blindSpot = unauditableMappingGate(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({
            sequenceNumber: 1,
            purpose: 'Alvarez Combat roll',
            notation: '1d100',
            requestId: 'req-1',
          }),
        ],
      }),
    );
    expect(blindSpot?.outcome).toBe('NOT_APPLICABLE');
    expect(blindSpot?.actualCode).toBe(
      'dice_roll events present, none matched the spontaneous-GM-roll classifier',
    );
    expect(blindSpot?.actualCode).not.toBe(noRolls?.actualCode);
  });

  it('keeps the blind-spot count out of the grouping key so the branch aggregates into one row', () => {
    const one = unauditableMappingGate(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({ sequenceNumber: 1, purpose: 'a', requestId: 'r1' }),
        ],
      }),
    );
    const three = unauditableMappingGate(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({ sequenceNumber: 1, purpose: 'a', requestId: 'r1' }),
          fakeDiceRoll({ sequenceNumber: 2, purpose: 'b', requestId: 'r2' }),
          fakeDiceRoll({ sequenceNumber: 3, purpose: 'c', requestId: 'r3' }),
        ],
      }),
    );

    expect(three?.actual).toMatch(/3 dice_roll event\(s\)/);
    expect(three?.actualCode).toBe(one?.actualCode);
  });

  it('falls through to the judge when at least one spontaneous roll is present', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Alvarez Combat roll',
          notation: '1d100',
          requestId: 'req-1',
        }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Ambient station event check',
          notation: '1d6',
          results: [2],
        }),
      ],
    });

    expect(unauditableMappingGate(result)).toBeNull();
  });
});

describe('unauditableMappingJudgeContext', () => {
  it('lists only the spontaneous rolls, so the rubric never restates the filter', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Alvarez Combat roll',
          notation: '1d100',
          requestId: 'req-1',
        }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Ambient station event check',
          notation: '1d6',
          results: [2],
        }),
      ],
    });

    const context = unauditableMappingJudgeContext(result);
    expect(context).toMatch(/Ambient station event check/);
    // The surfaced Combat roll is out of scope and must not reach the judge
    // as something to grade — one implementation selects, the judge grades
    // what it is handed.
    expect(context).not.toMatch(/Alvarez Combat roll/);
    expect(context).toMatch(/sequence 2/);
    expect(context).toMatch(/1d6/);
  });
});
