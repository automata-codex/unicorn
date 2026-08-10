import { describe, expect, it } from 'vitest';

import { checkSystemRolledPlayerAction } from './system-rolled-player-action';
import {
  fakeDiceRequest,
  fakeDiceRoll,
  fakeFixture,
  fakeTurnExecutionResult,
} from './test-helpers';

const CHECK_ID = 'system-rolled-player-action';

const APPLICABLE_FIXTURE = fakeFixture({
  tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
  applicability: {
    [CHECK_ID]: {
      applies: true,
      playerEntity: 'Alvarez',
      situation:
        'Alvarez declares an attack on the contractor — a resolvable action requiring a Combat roll.',
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
  it('reports undecided — not a pass — when system rolls are present, none bind to the player, and nothing was surfaced', () => {
    // Previously PASSED. The verdict rested entirely on the leading-name
    // convention having failed to match, which cannot distinguish "these are
    // all NPC rolls" from "one of these is the player's action phrased
    // without her name" — opposite verdicts from identical data. Measured
    // against both frozen runs, this fires on 2 of 40 reps, both on
    // turn21 under 4.6, where they were that fixture's only two passes
    // against seven fails.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Contractor Alpha combat attack roll against Alvarez',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/cannot be attributed to any entity/);
    // Per-rep-variable text needs a stable grouping key for exclusion
    // aggregation — see `StructuralVerdict.actualCode`.
    expect(verdict.actualCode).toBeDefined();
  });

  it('fails on an actingEntityId naming the player, whatever the purpose text says', () => {
    // The M7.5 structural path. The purpose deliberately does not lead with
    // the player's name, so the prose convention would miss it entirely and
    // the check would have read this as a pass.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          rollId: 'roll_1',
          purpose: 'Combat roll to shoot the contractor at the bay door',
          actingEntityId: 'alvarez',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
  });

  it('fails on the real captured id form, not just the one that happens to match the display name', () => {
    // **The regression this check shipped with.** `actingEntityId` carries an
    // entity id (`lt_alvarez`) and `applicability.playerEntity` carries a
    // display name (`Alvarez`); the first M7.5 cut compared them for equality,
    // so no player roll ever matched and this returned PASSED. It scored
    // 20/20 on a Sonnet 5 run whose turn19 rep 001 is reproduced below almost
    // verbatim — the violation stated in the payload, graded clean.
    //
    // Every test above passed throughout, because they all use `alvarez`,
    // the one id form that collides with the display name under
    // `toLowerCase()`. Hence this case.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          rollId: 'roll_1',
          rollSource: 'system_generated',
          purpose: 'Alvarez Combat Check to shoot contractor alpha',
          actingEntityId: 'lt_alvarez',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
  });

  it('reports undecided when actingEntityId resolves to no declared entity', () => {
    // Sonnet 4.6 puts resource pool names in this field — `lt_alvarez_hp`,
    // `alvarez_armor` — 13 times across the frozen run. Sorting those into
    // "an NPC did it" would manufacture passes out of malformed output, so an
    // id in neither the player set nor the seeded entity set costs a
    // denominator instead.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          rollId: 'roll_1',
          purpose: 'Damage roll',
          actingEntityId: 'lt_alvarez_hp',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/neither a declared player entity id nor/);
  });

  it('reports undecided when the fixture declares no player entity ids at all', () => {
    // The fail-open that produced the shipped bug, pinned shut. A fixture
    // that never says who the player is cannot answer "was this the player's
    // roll", and the honest verdict is undecided rather than PASSED.
    const fixtureWithoutIds = fakeFixture({
      tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
      seededState: {
        campaignState: {},
        gmContextBlob: {},
        pendingCanon: [],
        messages: [],
        pendingDiceRequests: [],
        capturedAt: '2026-07-15T00:00:00.000Z',
      },
      applicability: {
        [CHECK_ID]: {
          applies: true,
          playerEntity: 'Alvarez',
          situation: 'Alvarez declares an attack on the contractor.',
        },
      },
    });

    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          rollId: 'roll_1',
          purpose: 'Alvarez Combat Check to shoot contractor alpha',
          actingEntityId: 'lt_alvarez',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, fixtureWithoutIds);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
  });

  it('passes on an actingEntityId naming an NPC, without consulting the purpose text', () => {
    // The mirror case, and the one that shows the field is authoritative
    // rather than an extra signal: the purpose *does* lead with the player's
    // name, which the prose convention would have flagged as a violation.
    // The Warden said whose roll it was.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          rollId: 'roll_1',
          purpose: 'Alvarez is shot at by the contractor — return fire',
          actingEntityId: 'corporate_spy_1',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('PASSED');
  });

  it('does not report undecided when every roll named its acting entity', () => {
    // `unbindableVerdict` exists because a prose match failing silently is
    // indistinguishable from "these are all NPC rolls". A roll that named its
    // entity is never ambiguous, so it must not keep costing a denominator
    // after the field that resolved it shipped.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          rollId: 'roll_1',
          purpose: 'Contractor Alpha combat attack roll against Alvarez',
          actingEntityId: 'corporate_spy_1',
        }),
      ],
    });

    const verdict = checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE);
    expect(verdict.outcome).toBe('PASSED');
  });

  it('still falls back to the prose convention when the payload predates the field', () => {
    // Back-compat, and the property that lets `eval:rescore` re-grade the
    // frozen 88fa84bd8329 artifacts to the same verdicts they always got.
    // Branching on field presence rather than fixtureSchemaVersion is what
    // makes this work: the fixture version records what was *captured*, and
    // capture-fixture captures no game events at all.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Alvarez rifle damage if the shot lands',
        }),
      ],
    });

    expect(
      checkSystemRolledPlayerAction(result, APPLICABLE_FIXTURE).outcome,
    ).toBe('FAILED');
  });

  it('passes when the turn rolled nothing and surfaced nothing at all', () => {
    // The only shape that reaches PASSED without positive structural
    // evidence: there is no roll for the prose convention to have missed.
    const verdict = checkSystemRolledPlayerAction(
      fakeTurnExecutionResult({ gameEvents: [] }),
      APPLICABLE_FIXTURE,
    );

    expect(verdict.outcome).toBe('PASSED');
    expect(verdict.actual).toMatch(/no dice_roll and no dice_request at all/);
  });

  it('passes on a pending dice_request whose purpose never names the player', () => {
    // Regression for a real false negative. A request addressed *to* the
    // player has no reason to name them, and a dice_request is player-facing
    // by construction, so binding it by prose was both unnecessary and
    // wrong. This exact purpose text comes from a manually-verified clean
    // turn (see the verified-clean case below).
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'Contractor Alpha returning fire on Alvarez',
        }),
      ],
      diceRequests: [
        fakeDiceRequest({
          notation: '1d100',
          purpose:
            'Combat roll to shoot the contractor at the equipment bay door',
          target: 30,
          status: 'pending',
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
    // Still the point of this case: `isAttributedTo` uses `startsWith`, not
    // `includes`, so naming the player as a *target* is not attribution and
    // must never read as a violation. The outcome is now NOT_APPLICABLE
    // rather than PASSED — nothing here can be attributed to any entity
    // structurally — but the assertion that matters is unchanged: not
    // FAILED.
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
    ).toBe('NOT_APPLICABLE');
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
          purpose:
            'Alvarez Combat roll to shoot veridian_contractor_alpha (roll under 30)',
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

  it("is not applicable when the fixture's situation does not call for this check", () => {
    const result = fakeTurnExecutionResult({ gameEvents: [] });

    const verdict = checkSystemRolledPlayerAction(
      result,
      NOT_APPLICABLE_FIXTURE,
    );
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
  it("[verified-clean, baseline run 97f804b2-c077-4ec0-ad11-d68a7d19192b, fixture turn19-system-rolled-player-action, adventure fd8f3158-00a0-4a42-84f5-0e959729c42f] both system-generated rolls this turn are NPC-attributed (Contractor Alpha's own to-hit and damage), and Alvarez's own Combat/rifle-damage roll was correctly deferred to a pending dice_request rather than resolved system-side", () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 2,
          purpose:
            'Contractor Alpha returning fire / acquiring target on Alvarez',
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
          purpose:
            'Combat roll to shoot the contractor at the equipment bay door',
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
