import { describe, expect, it } from 'vitest';

import { CASES } from './cases';
import { loadFixture, parseFixture } from './fixture';

function valid() {
  return {
    id: 'a-fixture',
    tag: 'IGNORED-BY-THIS-SCHEMA',
    playerInput: { type: 'message', content: 'I look around.' },
    seededState: {
      campaignState: { worldFacts: { ship_layout: 'three decks' } },
      gmContextBlob: { playerEntityIds: ['danny'], openingNarration: 'Dark.' },
      messages: [
        { role: 'gm', content: 'Dark.', createdAt: '2026-08-24T21:11:05.056Z' },
        {
          role: 'player',
          content: 'I look around.',
          createdAt: '2026-08-24T21:11:40.000Z',
        },
      ],
      pendingCanon: [],
      pendingDiceRequests: [] as unknown[],
    },
  };
}

describe('parseFixture', () => {
  it('accepts a message fixture and ignores keys it does not use', () => {
    const fixture = parseFixture(valid(), 'a-fixture');
    expect(fixture.id).toBe('a-fixture');
    expect(fixture).not.toHaveProperty('tag');
  });

  it('keeps the rest of the gm context blob', () => {
    const fixture = parseFixture(valid(), 'a-fixture');
    expect(fixture.seededState.gmContextBlob.openingNarration).toBe('Dark.');
  });

  it('rejects a dice-result turn', () => {
    const raw = valid();
    raw.playerInput = { type: 'diceResult', content: '{"results":[4]}' };
    expect(() => parseFixture(raw, 'a-fixture')).toThrow(
      /dice-result cases are not/,
    );
  });

  it('rejects a fixture with a pending dice request', () => {
    const raw = valid();
    raw.seededState.pendingDiceRequests = [{ notation: '1d100' }];
    expect(() => parseFixture(raw, 'a-fixture')).toThrow(
      /pending dice request/,
    );
  });

  it('rejects a fixture that declares no player entity id', () => {
    const base = valid();
    const missing = {
      ...base,
      seededState: { ...base.seededState, gmContextBlob: {} },
    };
    expect(() => parseFixture(missing, 'a-fixture')).toThrow(/playerEntityIds/);

    const empty = valid();
    empty.seededState.gmContextBlob.playerEntityIds = [];
    expect(() => parseFixture(empty, 'a-fixture')).toThrow(/playerEntityIds/);
  });

  it('rejects a message row with an unknown role', () => {
    const raw = valid();
    raw.seededState.messages[0].role = 'narrator';
    expect(() => parseFixture(raw, 'a-fixture')).toThrow(/messages\.0\.role/);
  });
});

describe('the triggering player message', () => {
  const error = /last seeded message must be the player message/;

  it('rejects a history that ends on a different player message', () => {
    const raw = valid();
    raw.seededState.messages[1].content = 'Hello?';
    expect(() => parseFixture(raw, 'a-fixture')).toThrow(error);
  });

  it('rejects a history that ends on a GM message', () => {
    const raw = valid();
    raw.seededState.messages.pop();
    expect(() => parseFixture(raw, 'a-fixture')).toThrow(error);
  });

  it('rejects an empty history', () => {
    const raw = valid();
    raw.seededState.messages = [];
    expect(() => parseFixture(raw, 'a-fixture')).toThrow(error);
  });
});

describe('CASES', () => {
  // A typo in the list should fail here, not at the start of a paid run.
  for (const [question, ids] of Object.entries(CASES)) {
    for (const id of ids) {
      it(`${question}: ${id} loads`, () => {
        expect(loadFixture(id).id).toBe(id);
      });
    }
  }
});

describe('2c0ba938-turn18-berth-corrected', () => {
  // The case is only a test of the two edits if nothing else moved.
  it('differs from the captured turn 18 in messages 26 and 28 only', () => {
    const captured = loadFixture('2c0ba938-turn18-seeded-canon-contradiction');
    const corrected = loadFixture('2c0ba938-turn18-berth-corrected');

    const changed = corrected.seededState.messages.flatMap((message, i) =>
      message.content === captured.seededState.messages[i]?.content ? [] : [i],
    );
    expect(changed).toEqual([26, 28]);
    expect(corrected.seededState.messages[28].content).toContain(
      'along the mid-deck corridor',
    );
    expect(corrected.seededState.messages[28].content).not.toContain(
      'lower deck',
    );

    expect({
      ...corrected,
      id: captured.id,
      seededState: {
        ...corrected.seededState,
        messages: captured.seededState.messages,
      },
    }).toEqual(captured);
  });
});

describe('2c0ba938-turn18-berth-retracted', () => {
  it('is the captured turn 18 with two messages added after message 30', () => {
    const captured = loadFixture('2c0ba938-turn18-seeded-canon-contradiction');
    const retracted = loadFixture('2c0ba938-turn18-berth-retracted');

    const added = retracted.seededState.messages.slice(31, 33);
    expect(added.map((message) => message.role)).toEqual(['player', 'gm']);
    expect(added[1].content).toContain('The crew berths are on mid-deck');

    expect({
      ...retracted,
      id: captured.id,
      seededState: {
        ...retracted.seededState,
        messages: retracted.seededState.messages.toSpliced(31, 2),
      },
    }).toEqual(captured);
  });
});
