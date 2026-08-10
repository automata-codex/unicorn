import { describe, expect, it } from 'vitest';

import { checkOutOfOrderResolution } from './out-of-order-resolution';
import {
  fakeDiceRequest,
  fakeDiceRoll,
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

const CHECK_ID = 'out-of-order-resolution';

const APPLICABLE_FIXTURE = fakeFixture({
  tag: 'OUT-OF-ORDER-RESOLUTION',
  applicability: {
    [CHECK_ID]: {
      applies: true,
      playerEntity: 'Alvarez',
      situation:
        'Alvarez declares an attack requiring a to-hit roll to resolve before any damage roll.',
    },
  },
});

const NOT_APPLICABLE_FIXTURE = fakeFixture({
  tag: 'OUT-OF-ORDER-RESOLUTION',
  applicability: {
    [CHECK_ID]: {
      applies: false,
      situation:
        'Alvarez only asks a clarifying question this turn — no action is declared that would ' +
        'trigger a resolution roll, so there is no ordering for this check to grade.',
    },
  },
});

/** The deferred Combat to-hit every real rep of turn19/turn21 ends on —
 * 1d100 against a target, issued at the turn's `gm_response` and left
 * pending for the player. */
function pendingCombatGate(
  purpose = 'Alvarez Combat roll to shoot contractor at door',
) {
  return fakeDiceRequest({
    notation: '1d100',
    purpose,
    target: 30,
    status: 'pending',
    issuedAtSequence: 6,
  });
}

describe('checkOutOfOrderResolution', () => {
  it('passes when a gate is pending and nothing was resolved for the player ahead of it', () => {
    // Shape of turn19 rep 003/004/007/010 under 4.6: the to-hit is deferred,
    // and the only rolls resolved in-turn belong to NPCs.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Contractor Alpha returning fire at Alvarez',
          notation: '1d100',
        }),
      ],
      diceRequests: [pendingCombatGate()],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('PASSED');
    expect(verdict.actualCode).toBeDefined();
  });

  it('fails when a consequence is resolved for the player while their gate is still pending', () => {
    // The canonical violation, from turn19 rep 001: rifle damage rolled
    // system-side at sequence 4 while the Combat to-hit it depends on is
    // deferred to the player and still pending when the turn ends.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Contractor Alpha returning fire at Alvarez',
          notation: '1d100',
        }),
        fakeDiceRoll({
          sequenceNumber: 4,
          purpose: 'Alvarez rifle damage if her attack hits',
          notation: '1d10',
        }),
      ],
      diceRequests: [pendingCombatGate()],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/Alvarez rifle damage/);
  });

  it('catches a pre-rolled consequence that never says "if hit"', () => {
    // The reason the regex had to go. `CONDITIONAL_DAMAGE_PATTERN` required
    // damage-conditional phrasing, so a Warden doing exactly the same wrong
    // thing without the tell passed. Structure sees no difference between
    // the two, which is the point.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Alvarez rifle damage',
          notation: '1d10',
        }),
      ],
      diceRequests: [pendingCombatGate()],
    });

    expect(checkOutOfOrderResolution(result, APPLICABLE_FIXTURE).outcome).toBe(
      'FAILED',
    );
  });

  it('does not fail on an NPC damage roll phrased conditionally (regression: four false FAILs on turn19)', () => {
    // "Contractor rifle damage if hit" matched `CONDITIONAL_DAMAGE_PATTERN`
    // and failed the turn, even though an NPC's damage is not gated by the
    // player's pending request in any way. This fired on 4 of turn19's 10
    // reps under 4.6 and is most of why that fixture read 0/9.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Contractor rifle damage if hit',
          notation: '1d10',
        }),
      ],
      diceRequests: [pendingCombatGate()],
    });

    expect(checkOutOfOrderResolution(result, APPLICABLE_FIXTURE).outcome).toBe(
      'PASSED',
    );
  });

  it('binds the gate structurally, not by name — a request that never says "Alvarez" still counts', () => {
    // Same lesson as `system-rolled-player-action`: a `dice_request` is
    // player-facing by construction, and a request addressed *to* the player
    // has no reason to name them. Real purpose text from turn19 rep 002.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
      ],
      diceRequests: [
        pendingCombatGate(
          'Combat roll to shoot contractor at equipment bay door — roll under 30 to hit',
        ),
      ],
    });

    expect(checkOutOfOrderResolution(result, APPLICABLE_FIXTURE).outcome).toBe(
      'PASSED',
    );
  });

  it('is undecided when in-turn rolls declare no gate at all', () => {
    // turn21 rep 005 as it looked before M7.5, and how a pre-M7.5 frozen
    // artifact still looks under `eval:rescore`: no `gatedByRollId` anywhere,
    // so no roll claims to depend on another and there is no ordering to
    // adjudicate. Sequence order shows what happened first, not what
    // depended on what.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Alvarez Combat roll to hit',
          notation: '1d100',
        }),
        fakeDiceRoll({
          sequenceNumber: 3,
          purpose: 'Alvarez rifle damage',
          notation: '1d10',
        }),
      ],
      diceRequests: [],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/gatedByRollId/);
    expect(verdict.actualCode).toBeDefined();
  });

  it('passes when an in-turn consequence follows the roll it names as its gate', () => {
    // The shape M7.5's `gatedByRollId` made decidable: to-hit at sequence 2,
    // damage at 3 declaring roll_1 as its gate. Correct ordering, read off
    // two sequence numbers and a reference with nothing inferred from
    // wording.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          rollId: 'roll_1',
          purpose: 'Contractor rifle attack',
          notation: '1d100',
          actingEntityId: 'corporate_spy_1',
        }),
        fakeDiceRoll({
          sequenceNumber: 3,
          rollId: 'roll_2',
          purpose: 'Contractor rifle damage',
          notation: '1d10',
          actingEntityId: 'corporate_spy_1',
          gatedByRollId: 'roll_1',
        }),
      ],
      diceRequests: [],
    });

    expect(checkOutOfOrderResolution(result, APPLICABLE_FIXTURE).outcome).toBe(
      'PASSED',
    );
  });

  it('fails when an in-turn consequence precedes the roll it names as its gate', () => {
    // The same two events in the other order — damage at sequence 2 gated by
    // a to-hit that does not resolve until 3. Indistinguishable from the
    // passing case above by anything except the dependency, which is exactly
    // why sequence numbers alone could never decide this.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          rollId: 'roll_2',
          purpose: 'Contractor rifle damage',
          notation: '1d10',
          actingEntityId: 'corporate_spy_1',
          gatedByRollId: 'roll_1',
        }),
        fakeDiceRoll({
          sequenceNumber: 3,
          rollId: 'roll_1',
          purpose: 'Contractor rifle attack',
          notation: '1d100',
          actingEntityId: 'corporate_spy_1',
        }),
      ],
      diceRequests: [],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/rolled before the roll it depended on/);
  });

  it('is undecided, never a pass, when a gatedByRollId resolves to nothing', () => {
    // The tool loop rejects a dangling reference before it can be persisted,
    // so this should be unreachable in practice. Pinned anyway: a hand-
    // authored fixture or a future schema change could produce one, and
    // treating an unresolvable link as "no violation found" is the false-pass
    // shape this checker has been rebuilt twice to avoid.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          rollId: 'roll_1',
          purpose: 'Contractor rifle damage',
          notation: '1d10',
          actingEntityId: 'corporate_spy_1',
          gatedByRollId: 'roll_9',
        }),
      ],
      diceRequests: [],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/names no roll in this turn/);
  });

  it('guards the negative assertion: a turn that rolls nothing and defers nothing is undecided, not a pass', () => {
    // "No consequence rolled ahead of its gate" is satisfied by absence, so
    // without this a Warden that simply stopped issuing gating requests
    // would climb to 1.00 by doing less. No pending gate, no verdict.
    const verdict = checkOutOfOrderResolution(
      fakeTurnExecutionResult({ gameEvents: [], diceRequests: [] }),
      APPLICABLE_FIXTURE,
    );

    expect(verdict.outcome).toBe('NOT_APPLICABLE');
  });

  it("fails when a dice_roll precedes the turn's own player_action", () => {
    // Independent of any gate — pure sequence numbers, an invariant of the
    // write path rather than a claim about dependencies.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Alvarez rifle damage',
          notation: '1d10',
        }),
        fakeGameEvent({ sequenceNumber: 2, eventType: 'player_action' }),
      ],
      diceRequests: [pendingCombatGate()],
    });

    const verdict = checkOutOfOrderResolution(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/before this turn's player_action/);
  });

  it('[known limitation] flags a player roll that is properly ordered but unlinkable to the gate', () => {
    // turn21 rep 009 under 4.6, and a deliberate record of a wrong verdict.
    // Alvarez's stress check is triggered by NPC fire that already resolved
    // earlier in the turn, so it is correctly ordered — but it is
    // GM-initiated, carries no `requestId`, and sits after the gate in
    // sequence, exactly like a pre-rolled damage roll. Only `gatedByRollId`
    // separates them.
    //
    // Costs 1 of 18 decided reps on the frozen 4.6 run. Left unpatched on
    // purpose: the available discriminators are notation (1d10 vs 1d100) and
    // purpose wording, and reaching for either re-imports the failure that
    // produced `CONDITIONAL_DAMAGE_PATTERN`. This test exists so the
    // behaviour is pinned and visible rather than mistaken for correct — if
    // `gatedByRollId` ever lands, it should flip to PASSED.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose: 'Contractor Alpha return fire on Alvarez',
          notation: '1d100',
        }),
        fakeDiceRoll({
          sequenceNumber: 8,
          purpose:
            'Alvarez stress/panic check from taking fire (stress 0, threshold 3)',
          notation: '1d100',
        }),
      ],
      diceRequests: [
        pendingCombatGate(
          'Alvarez Combat attack roll - must roll under 30 to hit',
        ),
      ],
    });

    expect(checkOutOfOrderResolution(result, APPLICABLE_FIXTURE).outcome).toBe(
      'FAILED',
    );
  });

  it("is not applicable when the fixture's situation does not call for this check", () => {
    const verdict = checkOutOfOrderResolution(
      fakeTurnExecutionResult({ diceRequests: [pendingCombatGate()] }),
      NOT_APPLICABLE_FIXTURE,
    );

    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/only asks a clarifying question/);
  });

  it('throws when the fixture is at schema version 2+ but has no applicability entry for this check', () => {
    const fixture = fakeFixture({ tag: 'OUT-OF-ORDER-RESOLUTION' });

    expect(() =>
      checkOutOfOrderResolution(fakeTurnExecutionResult(), fixture),
    ).toThrow(/has no applicability entry/);
  });
});
