import { describe, expect, it } from 'vitest';

import { narratingPastABlockGate } from './narrating-past-a-block';
import {
  fakeDiceRequest,
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

/** The seeded Instinct request every `turn16` rep inherits — issued by an
 * earlier turn, captured with `target: null`, and resolved by this turn's
 * `diceResult` input. */
const SEEDED_INSTINCT_REQUEST = {
  notation: '1d100',
  purpose:
    'Instinct roll — snap decision under pressure: do you close the door, hold position, or move to the secondary panel before the contractor completes their sweep',
  target: null,
  status: null,
  issuedAtSequence: 67,
};

function fixtureWithSeededRequest() {
  const base = fakeFixture({
    tag: 'NARRATING-PAST-A-BLOCK',
    assertion: {
      mode: 'judged',
      rubric: 'NARRATING-PAST-A-BLOCK',
      facts: { blockDescription: "Alvarez's Instinct score" },
    },
  });
  return {
    ...base,
    seededState: {
      ...base.seededState,
      pendingDiceRequests: [SEEDED_INSTINCT_REQUEST],
    },
  };
}

const PLAIN_FIXTURE = fakeFixture({
  tag: 'NARRATING-PAST-A-BLOCK',
  assertion: {
    mode: 'judged',
    rubric: 'NARRATING-PAST-A-BLOCK',
    facts: { blockDescription: "Alvarez's Combat to-hit roll" },
  },
});

describe('narratingPastABlockGate', () => {
  it('fails a request the turn issued and resolved with no target ever set', () => {
    // `target` is written once at insert and never updated, so a resolved
    // request still carrying `null` means the threshold its success depended
    // on was never established — a Warden self-ruling past a missing-data
    // block instead of waiting for it.
    const result = fakeTurnExecutionResult({
      diceRequests: [
        fakeDiceRequest({
          notation: '1d100',
          purpose: 'Instinct roll — snap decision under pressure',
          target: null,
          status: 'resolved',
          issuedAtSequence: 2,
        }),
      ],
    });

    const verdict = narratingPastABlockGate(result, PLAIN_FIXTURE);
    expect(verdict?.outcome).toBe('FAILED');
    expect(verdict?.actual).toMatch(/no target ever set/);
  });

  it('ignores a seeded request the fixture inherited, even though it resolves with a null target', () => {
    // The regression this gate exists to avoid re-introducing. Every turn16
    // rep in both frozen runs — 20 of 20 — resolves this seeded request, and
    // the uncorrected rule read each one as a self-ruling violation. That is
    // most of why the fixture sat at 0/10 under both models and was recorded
    // as "confidently zero" in docs/eval-methodology.md. The `target: null`
    // was captured by the fixture, not chosen by the Warden under test.
    const result = fakeTurnExecutionResult({
      diceRequests: [
        fakeDiceRequest({
          notation: SEEDED_INSTINCT_REQUEST.notation,
          purpose: SEEDED_INSTINCT_REQUEST.purpose,
          target: null,
          status: 'resolved',
          issuedAtSequence: SEEDED_INSTINCT_REQUEST.issuedAtSequence,
          resolvedAtSequence: 1,
        }),
      ],
    });

    expect(
      narratingPastABlockGate(result, fixtureWithSeededRequest()),
    ).toBeNull();
  });

  it('still fails a fresh null-target request issued alongside an inherited one', () => {
    // The exclusion is per-request, not per-turn: inheriting a seeded
    // request must not buy the turn a free pass on one it issued itself.
    const result = fakeTurnExecutionResult({
      diceRequests: [
        fakeDiceRequest({
          notation: SEEDED_INSTINCT_REQUEST.notation,
          purpose: SEEDED_INSTINCT_REQUEST.purpose,
          target: null,
          status: 'resolved',
          issuedAtSequence: SEEDED_INSTINCT_REQUEST.issuedAtSequence,
        }),
        fakeDiceRequest({
          notation: '1d100',
          purpose: 'Sanity save — the thing in the corridor',
          target: null,
          status: 'resolved',
          issuedAtSequence: 3,
        }),
      ],
    });

    const verdict = narratingPastABlockGate(result, fixtureWithSeededRequest());
    expect(verdict?.outcome).toBe('FAILED');
    expect(verdict?.actual).toMatch(/Sanity save/);
    expect(verdict?.actual).not.toMatch(/Instinct roll/);
  });

  it('falls through to the judge when a request resolved with a target properly set', () => {
    const result = fakeTurnExecutionResult({
      diceRequests: [
        fakeDiceRequest({
          notation: '1d100',
          purpose: 'Combat roll to shoot the contractor',
          target: 30,
          status: 'resolved',
          issuedAtSequence: 2,
        }),
      ],
    });

    expect(narratingPastABlockGate(result, PLAIN_FIXTURE)).toBeNull();
  });

  it('falls through to the judge when a request is still pending', () => {
    // A pending request is the ordinary blocked shape — whether the
    // narration ran past it is exactly the prose question the rubric
    // answers, so the gate must not pre-empt it.
    const result = fakeTurnExecutionResult({
      diceRequests: [
        fakeDiceRequest({
          notation: '1d100',
          purpose: 'Combat roll to shoot the contractor',
          target: 30,
          status: 'pending',
          issuedAtSequence: 4,
        }),
      ],
    });

    expect(narratingPastABlockGate(result, PLAIN_FIXTURE)).toBeNull();
  });

  it('falls through when nothing is blocked at all, rather than reporting not applicable', () => {
    // Gating on "is a dice_request pending" is the tempting structural
    // applicability test and is wrong here: turn16 blocks on missing player
    // data, which has no mechanical representation, and would report
    // not_applicable on 19 of its 20 reps across the frozen runs. The judge
    // decides whether a block existed; a turn with no block is a pass, not
    // an exclusion.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 1,
          eventType: 'gm_response',
          payload: { playerText: 'The corridor is quiet.' },
        }),
      ],
      diceRequests: [],
    });

    expect(narratingPastABlockGate(result, PLAIN_FIXTURE)).toBeNull();
  });
});
