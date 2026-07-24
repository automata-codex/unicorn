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

  it('passes on "if X, you put Y damage" — reclassified: conditional stakes framing is the Warden\'s standard, correct way to present a pending roll, not resolution language', () => {
    // Previously treated as a violation (RESOLUTION_LANGUAGE_PATTERN matched
    // bare "you put"), until real replayed output (turn21-narrating-past-a-block)
    // showed this exact conditional shape — "If you hit, you deal 10 damage"
    // — used correctly on an unresolved dice_request that stayed pending
    // through the rest of the same turn. The "if" governing "you put" here
    // means this was never a genuine violation; the original test's
    // assumption was itself the bug.
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

    expect(checkNarratingPastABlock(result).outcome).toBe('PASSED');
  });

  it('still fails on genuinely declarative "you put X damage" with no conditional framing in its own sentence (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText:
              'Your Combat roll lands under 30. You put 4 damage into Contractor Alpha.',
          },
        }),
      ],
      diceRequests: [fakeDiceRequest({ notation: '1d100', purpose: 'combat' })],
    });

    const verdict = checkNarratingPastABlock(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/resolution language/);
  });

  it('does not let an unrelated "if" in an earlier sentence suppress a genuine violation later in the same response (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText:
              'If anything else happens, note it for later. You put 4 damage into Contractor Alpha.',
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

  // Verified-clean corpus: the real turn that surfaced the false-positive
  // fixed above. Before the fix, RESOLUTION_LANGUAGE_PATTERN matched "you
  // hit"/"you deal" inside "If you hit, you deal 10 damage" — a standard,
  // correct pending-roll prompt, not resolution language — and produced a
  // spurious FAILED. This locks in that the fix holds against the exact
  // real text. Whether this turn deserves a *different* FAILED (concurrent
  // NPC actions resolve with real narrated consequences — Beta's shot
  // "connects," Alvarez takes 7 armour damage — while her own roll stays
  // pending) is a separate, open question this checker doesn't attempt to
  // answer yet.
  it('[verified-clean, baseline run 97f804b2-c077-4ec0-ad11-d68a7d19192b, fixture turn21-narrating-past-a-block, adventure 423f92cc-a5c3-4e69-b3a5-d651de31fbfc] conditional "if you hit, you deal X" framing on a still-pending roll is not resolution language', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 3,
          eventType: 'gm_response',
          payload: {
            playerText:
              'You stay committed. The rack is your world right now — the gap between those two shelving units, the angle, the contractor\'s centre mass on the other side of it. You adjust your position slightly left, open the sight picture, and fire.\n\n' +
              '**Roll your Combat — 1d100, under 30. If you hit, you deal 10 damage.**\n\n' +
              '---\n\n' +
              "While you're rolling — the world doesn't wait.\n\n" +
              'Contractor Alpha, still inside the bay with you, gets their weapon properly braced against the rack frame and fires a controlled burst. 68 against their Combat of 40 — too high, another miss. Rounds punch into the composite wall behind you, punching coin-sized craters in the panelling. Close. Getting closer.\n\n' +
              "Contractor Beta at the doorway is smarter — they don't push into the bay, they post up at the frame and fire from cover. 24 against Combat 40 — that one *connects.*\n\n" +
              'A round clips your left shoulder, not clean — it catches the edge of your armour plate and transfers instead of penetrating, the impact spinning you a quarter turn and slamming you back against the rack. The blow rings through your whole left arm like a struck bell. Your armour plate takes the damage — **7 points off your armour, down to 23/30** — but the force of it is real, and in low gravity the knockback is worse than it should be, your feet lifting slightly before you catch the rack and haul yourself back into position.\n\n' +
              'The rack is moving. That last burst from Alpha walked rounds into the base struts. The whole unit is tilting, grinding slowly against the composite floor in the low gravity, the shelving above you beginning to lean.\n\n' +
              'You have one good shot before it goes over.\n\n' +
              'Alpha is still behind the rack frame. Beta is at the door. Gamma and Delta are stacking — you can hear them, boots and breathing, someone issuing hand signals in silence.\n\n' +
              'The fourth contractor — the quiet one — is still unaccounted for.\n\n' +
              '**Your Combat roll — 1d100, under 30. 10 damage if it lands.**',
          },
        }),
      ],
      diceRequests: [
        fakeDiceRequest({
          notation: '1d100',
          purpose: 'Alvarez attacks Contractor Alpha — roll under Combat 30 to hit',
          target: 30,
          status: 'pending',
        }),
      ],
    });

    expect(checkNarratingPastABlock(result).outcome).toBe('PASSED');
  });
});
