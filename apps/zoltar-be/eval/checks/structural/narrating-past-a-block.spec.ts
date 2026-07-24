import { describe, expect, it } from 'vitest';

import { checkNarratingPastABlock } from './narrating-past-a-block';
import {
  fakeDiceRequest,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

describe('checkNarratingPastABlock', () => {
  it('is not applicable when nothing is blocked (no pending dice_request) — boundary', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: { playerText: 'The corridor is quiet.' },
        }),
      ],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/nothing blocked/);
  });

  it('is not applicable when a dice_request is pending but no gm_response/correction event exists yet (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [],
      diceRequests: [fakeDiceRequest({ notation: '1d10', purpose: 'to-hit' })],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/no gm_response\/correction event exists/);
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
    expect(verdict.outcome).toBe('FAILED');
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

    expect(checkNarratingPastABlock(result).outcome).toBe('PASSED');
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
    expect(verdict.outcome).toBe('FAILED');
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

    expect(checkNarratingPastABlock(result).outcome).toBe('NOT_APPLICABLE');
  });

  it('fails on bare "regardless:" continuation language with no "while" or "regardless of", from real replayed output (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText:
              "Roll your Combat (1d100, under 30). The world's side of this " +
              'exchange has already resolved — here’s what happens ' +
              "regardless: Contractor Alpha's return burst misses again.",
          },
        }),
      ],
      diceRequests: [fakeDiceRequest({ notation: '1d100', purpose: 'combat' })],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/acknowledges an unresolved decision/);
  });

  it('fails on "you put X damage" resolution language, from real replayed output (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText:
              'If your Combat roll lands under 30, you put 4 damage into ' +
              'Contractor Alpha.',
          },
        }),
      ],
      diceRequests: [fakeDiceRequest({ notation: '1d100', purpose: 'combat' })],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/resolution language/);
  });

  it('is not applicable for unrelated "regardless of X" phrasing lacking a number/score/result anchor, with nothing else blocked (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText:
              'The reading holds steady regardless of the interference, ' +
              'a fact worth noting for later.',
          },
        }),
      ],
      diceRequests: [],
    });

    expect(checkNarratingPastABlock(result).outcome).toBe('NOT_APPLICABLE');
  });

  it('fails when a resolved dice_request never had its target set, from real replayed output (deliberately-broken counterexample)', () => {
    // Real case: a pending "Instinct roll" dice_request seeded with
    // target: null (the player's Instinct score was never on file), resolved
    // via a diceResult submission. The Warden's response never claims to be
    // "waiting" (no BLOCK_ACKNOWLEDGING_CONTINUATION_PATTERN match) — it
    // openly rules on the fiction instead — so only the target-null signal
    // catches this, not the language heuristic.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 4,
          eventType: 'gm_response',
          payload: {
            playerText:
              "You haven't given me your Instinct score directly, but I'm " +
              'ruling on the fiction: 62 is a middling result. You hold position.',
          },
        }),
      ],
      diceRequests: [
        fakeDiceRequest({
          notation: '1d100',
          purpose: 'Instinct roll — snap decision under pressure',
          status: 'resolved',
          target: null,
        }),
      ],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/no target ever set/);
  });

  it('does not flag a resolved dice_request that had a real target (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 4,
          eventType: 'gm_response',
          payload: { playerText: 'The corridor is quiet.' },
        }),
      ],
      diceRequests: [
        fakeDiceRequest({
          notation: '1d100',
          purpose: 'Combat roll to hit',
          status: 'resolved',
          target: 30,
        }),
      ],
    });

    expect(checkNarratingPastABlock(result).outcome).toBe('NOT_APPLICABLE');
  });

  it('does not flag a resolved null-target roll that is a narrative-selection table, not a stat check (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 4,
          eventType: 'gm_response',
          payload: { playerText: 'The corridor is quiet.' },
        }),
      ],
      diceRequests: [
        fakeDiceRequest({
          notation: '1d6',
          purpose: 'determine which of six ambient events occurs',
          status: 'resolved',
          target: null,
        }),
      ],
    });

    expect(checkNarratingPastABlock(result).outcome).toBe('NOT_APPLICABLE');
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

    expect(checkNarratingPastABlock(result).outcome).toBe('PASSED');
  });

  // Verified-clean corpus (this entry is a verified *violation*, the
  // complementary half): a real turn manually confirmed to be a genuine
  // false negative before the null-target signal above was added — the
  // checker returned NOT_APPLICABLE on this exact data until that fix.
  it('[verified-violation, baseline run 97f804b2-c077-4ec0-ad11-d68a7d19192b, fixture turn16-narrating-past-a-block, adventure 9dcbdbf9-82cf-485c-a5b6-9864c3d6945a] the Warden self-rules on a missing Instinct score and narrates a fully resolved outcome, never obtaining the stat the roll depended on', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 4,
          eventType: 'gm_response',
          payload: {
            playerText:
              "Alvarez's Instinct stat — I'm treating this as a reflexive judgment call, rolling under the stat to succeed. You haven't given me your Instinct score directly, but I'm ruling on the fiction: 62 is a middling result, and the situation has a clear better and worse answer that a trained boarding officer would recognise under pressure.\n\n" +
              'You hold position.\n\n' +
              "It's the right call. Closing the door makes noise. Moving makes noise and puts you in motion if they look. Holding is the only option that gives the contractor nothing new to react to.\n\n" +
              "You press flat against the wall. Control your breathing. The rifle is across your chest, muzzle down, because if it catches the edge of the door frame while the contractor is looking this direction it's over.\n\n" +
              "The boot in the gap doesn't move for four full seconds.\n\n" +
              'Then the contractor turns — you hear it, the shift of weight, the quarter-pivot — and through the door crack you see the tactical vest rotating away from you, toward the ladder shaft. Checking up. Making sure nobody came down and doubled back.\n\n' +
              'Satisfied, apparently, with nothing.\n\n' +
              '*"Clear."* Flat, professional, carrying just enough to reach the hub.\n\n' +
              'The footsteps move away. Back toward the hub. Back toward the other voices, which resume their low clipped exchange a moment later. Someone laughs once — short, humourless, the kind of laugh that means *I knew it was nothing.*\n\n' +
              "You let out a breath you didn't know you were holding.\n\n" +
              '---\n\n' +
              'The equipment bay is yours. You have maybe sixty seconds before they wonder why their sweep took that long, or before the one watching the hub primary panel decides to reposition.\n\n' +
              "The connecting door to the environmental hub's secondary panel is on the starboard wall — eight metres across the bay, between two EVA suit storage lockers. The door has a standard lever handle. No lock indicator visible from here.\n\n" +
              'The secondary airlock corridor branches off the far end of the bay behind you — and through it, distantly, you can hear the low hum of an external power coupling. Their courier. Still docked. Still powered.\n\n' +
              'You need to move. The quarantine seal command is waiting at that secondary panel — environmental isolation, cargo hold, engage lockdown. In that order. UNIT-7\'s voice in your memory, precise and unhurried.\n\n' +
              'You push off the wall and cross the bay.',
          },
        }),
      ],
      diceRequests: [
        {
          id: 'c05c2d52-6764-4be8-8041-90e2759c285b',
          adventureId: '9dcbdbf9-82cf-485c-a5b6-9864c3d6945a',
          issuedAtSequence: 67,
          notation: '1d100',
          purpose:
            'Instinct roll — snap decision under pressure: do you close the door, hold position, or move to the secondary panel before the contractor completes their sweep',
          target: null,
          status: 'resolved',
          resolvedAtSequence: 1,
          resolvedAt: new Date('2026-07-24T14:08:26.187787Z'),
          createdAt: new Date('2026-07-14T12:16:25.279Z'),
        },
      ],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/no target ever set/);
  });
});
