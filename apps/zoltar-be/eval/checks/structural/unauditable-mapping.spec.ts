import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * `ADR-0105` — `judgeContext` output reaches the judge and is covered by no
 * hash: editing this renderer changes what the grader reads while moving
 * `rubricHash`, `judgeContractHash` and `corpusVersion` not at all. The
 * `ungrounded-contractor-target` spec named this renderer as the one left in
 * that gap since it shipped; plan 023 closes it, because widening the tag's
 * corpus from five fixtures to nine sends four more fixtures' worth of reps
 * through an unguarded renderer.
 *
 * The probe is not invented. All three rolls are transcribed from frozen
 * artifacts this tag already owns:
 *
 * - sequence 2 is `5c34991b-turn01`'s cartographer check, the roll
 *   `rules-extraction-findings.md § S36` reproduces — subject named, mapping
 *   never stated. It failed 10/10 under prompt `6717347d`.
 * - sequence 167 is turn 51 of the 2026-08-24 playtest, captured by plan 023
 *   as `2c0ba938-turn51-unauditable-mapping` — bands enumerated across the
 *   whole die before the roll is read, under prompt `e83e8aaa`.
 * - sequence 44 resolves a `dice_request` and must therefore be **absent**
 *   from the render. Its exclusion is the half of this golden a rubric
 *   rewrite is most likely to lose silently.
 */
describe('unauditableMappingJudgeContext golden (`ADR-0105`)', () => {
  const GOLDEN = join(
    __dirname,
    '..',
    'judged',
    'judge-context-golden',
    'unauditable-mapping.txt',
  );

  it('renders the frozen probe exactly as committed', () => {
    const rendered = unauditableMappingJudgeContext(
      fakeTurnExecutionResult({
        gameEvents: [
          fakeDiceRoll({
            sequenceNumber: 2,
            notation: '1d100',
            results: [92],
            purpose:
              "Cartographer's reaction/instinct check to gauge honesty vs deflection when asked about the rest of the crew",
            actingEntityId: 'deep_space_cartographer',
          }),
          fakeDiceRoll({
            sequenceNumber: 44,
            notation: '1d100',
            results: [48],
            purpose: "Danny's Intellect check with Computers trained",
            requestId: 'req-1',
          }),
          fakeDiceRoll({
            sequenceNumber: 167,
            notation: '1d10',
            results: [7],
            purpose:
              'Since the array repair failed (96, high fail): 1d10 for how bad the news is — 1-3 fixable but needs days/parts they don\'t have, 4-6 the coupling is completely shot and comms are permanently down, 7-8 fixable but the attempt causes a minor mishap/spark/injury, 9-10 the diagnostic reveals something worse (structural, not just comms-related) while they\'re back there',
          }),
        ],
      }),
    );

    expect(existsSync(GOLDEN)).toBe(true);
    expect(rendered).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});
