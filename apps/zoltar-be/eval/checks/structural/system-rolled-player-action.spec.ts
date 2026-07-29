import { describe, expect, it } from 'vitest';

import { checkSystemRolledPlayerAction } from './system-rolled-player-action';
import { fakeDiceRoll, fakeFixture, fakeTurnExecutionResult } from './test-helpers';

const CHECK_ID = 'system-rolled-player-action';

const APPLICABLE_FIXTURE = fakeFixture({
  tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
  applicability: {
    [CHECK_ID]: {
      applies: true,
      playerEntity: 'Alvarez',
      situation:
        "Alvarez declares an attack on the contractor — a resolvable action requiring a Combat roll.",
    },
  },
});

const NOT_APPLICABLE_FIXTURE = fakeFixture({
  tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
  applicability: {
    [CHECK_ID]: {
      applies: false,
      situation:
        'Alvarez only asks a clarifying question this turn — no action is declared that would ' +
        'require a roll, so there is nothing for this check to grade.',
    },
  },
});

describe('checkSystemRolledPlayerAction', () => {
  it('passes when no player-attributed roll appears this turn (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Contractor Alpha combat attack roll against Alvarez',
        }),
      ],
    });

    expect(
      checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE).outcome,
    ).toBe('PASSED');
  });

  it('fails when the player-attributed damage roll appears system-side (deliberately-broken counterexample, from real replayed output)', () => {
    const result = fakeTurnExecutionResult({
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

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 2/);
  });

  it('fails on a system-rolled to-hit roll with no damage-conditional phrasing (real replayed output, Sonnet 5: this previously read as a false PASS)', () => {
    // The old checker only flagged rolls matching a damage-conditioned-on-
    // an-unconfirmed-hit pattern, so a system-rolled *to-hit* roll — the
    // player's own action, resolved system-side just the same — sailed
    // through undetected. Confirmed against a real Sonnet 5 run
    // (turn21-system-rolled-player-action, reps 003/004): this exact
    // purpose text read PASSED under the old logic.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose:
            'Alvarez Combat roll to shoot contractor at equipment bay door (target: under 30)',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 2/);
  });

  it('does not flag an NPC damage roll that merely mentions the player as the target', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Contractor rifle damage to Alvarez if hit lands',
        }),
      ],
    });

    expect(
      checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE).outcome,
    ).toBe('PASSED');
  });

  it('does not treat a player-entered roll (resolving a dice_request) as a violation', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Alvarez rifle damage',
          rollSource: 'player_entered',
        }),
      ],
    });

    expect(
      checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE).outcome,
    ).toBe('PASSED');
  });

  it('is not fooled by a pending dice_request for the same action into ignoring a system-rolled player consequence', () => {
    // Confirmed against real replayed output: the same turn can defer the
    // to-hit roll to the player (a genuinely pending dice_request) while
    // still pre-rolling the player's own damage system-side — a pending
    // request must never excuse an already-resolved violation.
    const result = fakeTurnExecutionResult({
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

    expect(
      checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE).outcome,
    ).toBe('FAILED');
  });

  it('is not fooled by an unrelated pending dice_request into ignoring a system-rolled player consequence (guard case)', () => {
    // The pending request here belongs to a different actor's action
    // entirely — it must not excuse the player's own consequence roll
    // being resolved system-side in the same turn.
    const result = fakeTurnExecutionResult({
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
          notation: '1d10',
          purpose: 'Contractor Beta reload check',
          target: null,
          status: 'pending',
          resolvedAtSequence: null,
          resolvedAt: null,
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
        },
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 1/);
  });

  it('passes when a pending dice_request matching the player action exists and no dice_roll appears this turn', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [],
      diceRequests: [
        {
          id: 'req-1',
          adventureId: 'a1',
          issuedAtSequence: 2,
          notation: '1d100',
          purpose: 'Alvarez Combat roll to shoot veridian_contractor_alpha (roll under 30)',
          target: 30,
          status: 'pending',
          resolvedAtSequence: null,
          resolvedAt: null,
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
        },
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('PASSED');
    expect(verdict.actual).toMatch(/pending dice_request/);
  });

  it('passes when the turn has no dice_roll and no pending dice_request at all (boundary)', () => {
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('PASSED');
  });

  it('is not applicable when the fixture\'s situation does not call for this check', () => {
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    const verdict = checkSystemRolledPlayerAction(result, NOT_APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/clarifying question/);
  });

  it('throws when the fixture is at schema version 2+ but has no applicability entry for this check', () => {
    const fixture = fakeFixture({
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
      fixtureSchemaVersion: 2,
    });
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    expect(() => checkSystemRolledPlayerAction(result, fixture)).toThrow(
      /no applicability entry/,
    );
  });

  // Verified-clean corpus: real turns manually confirmed (not hand-authored
  // boundary cases) to be correctly classified — see the memory/conversation
  // trail for how each was checked. Distinct from the synthetic cases above,
  // this is real field data a human actually verified the checker got right.
  it('[verified-clean, baseline run 97f804b2-c077-4ec0-ad11-d68a7d19192b, fixture turn19-system-rolled-player-action, adventure fd8f3158-00a0-4a42-84f5-0e959729c42f] both system-generated rolls this turn are NPC-attributed (Contractor Alpha\'s own to-hit and damage), and Alvarez\'s own Combat/rifle-damage roll was correctly deferred to a pending dice_request rather than resolved system-side', () => {
    const result = fakeTurnExecutionResult({
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

    expect(
      checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE).outcome,
    ).toBe('PASSED');
  });
});
