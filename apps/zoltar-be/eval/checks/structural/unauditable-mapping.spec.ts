import { describe, expect, it } from 'vitest';

import {
  fakeDiceRoll,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';
import { checkUnauditableMapping } from './unauditable-mapping';

describe('checkUnauditableMapping', () => {
  it('passes when a narrative-selection roll states its mapping up front', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose:
            'determine which faction responds: 1-3=guards, 4-6=corporate spy',
        }),
      ],
    });

    expect(checkUnauditableMapping(result).outcome).toBe('PASSED');
  });

  it('fails when a narrative-selection roll fires with no stated mapping (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose: 'determine which faction responds',
        }),
      ],
    });

    const verdict = checkUnauditableMapping(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(
      /does not state a result-to-meaning mapping/,
    );
  });

  it('fails on "determining which" (progressive tense), from real replayed output (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose:
            'Contractor positioning — determining which contractor(s) are near the ladder shaft vs environmental hub',
        }),
      ],
    });

    expect(checkUnauditableMapping(result).outcome).toBe('FAILED');
  });

  it('fails on GM-improvisation phrasing with no "which/select/decide" keyword at all, from real replayed output (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose:
            'What does Alvarez notice or find at the hub junction — rolling for environmental detail/discovery',
        }),
      ],
    });

    const verdict = checkUnauditableMapping(result);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/sequence 1/);
  });

  it('does not let a bare "check" exclude a narrative-selection roll as mechanical, from real replayed output (deliberately-broken counterexample)', () => {
    // "atmosphere check"/"ambient detail... check" is common real phrasing
    // for narrative-selection rolls — "check" alone must not be treated as
    // proof of mechanical resolution the way "to-hit"/"damage"/"save" are.
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({
          sequenceNumber: 1,
          purpose:
            'Random ambient detail / atmosphere check for what Alvarez notices during the scan',
        }),
      ],
    });

    expect(checkUnauditableMapping(result).outcome).toBe('FAILED');
  });

  it('is not applicable when the only rolls are pure mechanical resolution (boundary)', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeDiceRoll({ sequenceNumber: 1, purpose: 'to-hit vs dr_chen' }),
        fakeDiceRoll({ sequenceNumber: 2, purpose: 'damage vs dr_chen' }),
      ],
    });

    const verdict = checkUnauditableMapping(result);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/no narrative-selection-flavored/);
  });

  it('is not applicable when there are no dice_roll events at all (boundary)', () => {
    expect(
      checkUnauditableMapping(fakeTurnExecutionResult()).outcome,
    ).toBe('NOT_APPLICABLE');
  });

  // Verified-clean corpus (an N/A verification, the third labeled category
  // alongside verified-clean PASSED and verified-violation FAILED): a real
  // turn manually confirmed to be a genuine "nothing to check" replay, not a
  // false pass — this turn resolved a tactical briefing purely through
  // narration (UNIT-7 revealing a route option) with no dice_roll at all, so
  // UNAUDITABLE-MAPPING never got a chance to exercise its target failure
  // mode this run (the original captured turn rolled 1d10 and 1d6 for this
  // same beat with no mapping stated).
  it('[verified-na, baseline run 97f804b2-c077-4ec0-ad11-d68a7d19192b, fixture turn14-unauditable-mapping, adventure 38c685b4-6d8a-4e0a-8455-224ccbc10f0e] a tactical briefing turn resolved purely through narration, with no dice_roll of any kind', () => {
    const result = fakeTurnExecutionResult({
      gameEvents: [
        fakeGameEvent({
          sequenceNumber: 1,
          eventType: 'player_action',
          payload: {
            content:
              "\"I'm going to take care of the environmental systems first, then we'll broadcast. Vasques, you stay here with UNIT-7.\"",
          },
        }),
        fakeGameEvent({
          sequenceNumber: 2,
          eventType: 'gm_response',
          payload: {
            playerText:
              'Vasques nods immediately — the nod of a man who is deeply relieved to have a wall between himself and whatever is downstairs.\n\n' +
              'UNIT-7 says nothing. It simply sets the data chip on the edge of the bench closest to the door — within easy reach, positioned for you to grab it on your way back through. A machine making logistical preparations without being asked.\n\n' +
              'Then:\n\n' +
              '*"Lieutenant."*\n\n' +
              "You're already at the door. You stop.\n\n" +
              '*"The contractors will have thermal imaging capability. Standard corporate response kit."* Its voice is the same low register, the same deliberate modulation. *"The ladder shaft is a single point of entry. If they hear you on the shaft, you will be exposed before you reach the bottom."*\n\n' +
              'It pauses.\n\n' +
              '*"There is an access panel in the equipment bay floor — maintenance crawlspace, runs parallel to the shaft. Slower. Quieter. I use it for hull inspection work. The entry point is in the corridor outside Lab A, behind the grey utility panel on the port wall. It bypasses the shaft entirely and opens into the equipment bay on Deck 0, west of the environmental hub."*\n\n' +
              'A beat.\n\n' +
              '*"The contractors staged near the hub. West puts you behind them."*\n\n' +
              "It doesn't tell you what to do with that. It just gives you the information and stops talking.\n\n" +
              'Vasques is watching you from the far bench, hands clasped, saying nothing. He has the expression of a man who has run out of useful things to contribute and knows it.\n\n' +
              'The corridor outside is quiet.\n\n' +
              "Somewhere below — muffled by the deck plating, felt more than heard — there is the soft sound of movement. Four sets of boots on composite flooring, not trying very hard to be silent. They haven't started up the shaft yet.\n\n" +
              '---\n\n' +
              "**You're in the research wing corridor, outside Lab B. The grey utility panel is a few metres back toward Lab A on the port wall.**\n\n" +
              '**The ladder shaft is at the hub junction — twelve metres ahead of you, past the junction mouth.**\n\n' +
              '**Two routes down. One fast and exposed. One slow and quiet.**\n\n' +
              '**What do you do?**',
          },
        }),
        fakeGameEvent({ sequenceNumber: 3, eventType: 'state_update' }),
      ],
    });

    const verdict = checkUnauditableMapping(result);
    expect(verdict.outcome).toBe('NOT_APPLICABLE');
    expect(verdict.actual).toMatch(/no narrative-selection-flavored/);
  });
});
