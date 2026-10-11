import { describe, expect, it } from 'vitest';

import { planMove } from './session.places';

const at = (place: string) => ({ danny_location: place });

describe('planMove', () => {
  it('says a same-deck trip is a walk', () => {
    const result = planMove({
      entityId: 'danny',
      to: 'crew_berths',
      worldFacts: at('cryo_bay'),
    });
    expect(result).toMatchObject({ ok: true, decksCrossed: 0 });
    expect(result.text).toBe(
      'danny is in cryo_bay (deck 2, mid). crew_berths is on deck 2, mid. Same deck: a walk, with no ladder and no change of deck.',
    );
  });

  it('gives one deck down, passing no other deck', () => {
    const result = planMove({
      entityId: 'danny',
      to: 'cargo_bay',
      worldFacts: at('mid_deck_corridor'),
    });
    expect(result).toMatchObject({ ok: true, decksCrossed: 1 });
    expect(result.text).toBe(
      'danny is in mid_deck_corridor (deck 2, mid). cargo_bay is on deck 3, lower. One deck down, by the ladder shaft. The trip starts on deck 2 and ends on deck 3 and passes no other deck.',
    );
  });

  it('gives two decks up, passing mid-deck', () => {
    const result = planMove({
      entityId: 'danny',
      to: 'bridge',
      worldFacts: at('engine_room'),
    });
    expect(result).toMatchObject({ ok: true, decksCrossed: 2 });
    expect(result.text).toContain('Two decks up, by the ladder shaft.');
    expect(result.text).toContain('passes deck 2 (mid) on the way');
  });

  it('says so when the character is already there', () => {
    const result = planMove({
      entityId: 'danny',
      to: 'bridge',
      worldFacts: at('bridge'),
    });
    expect(result).toMatchObject({ ok: true, decksCrossed: 0 });
    expect(result.text).toContain('already in bridge');
  });

  it('refuses a place that is not on the list, and lists the places', () => {
    const result = planMove({
      entityId: 'danny',
      to: 'maras_berth',
      worldFacts: at('cryo_bay'),
    });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('"maras_berth" is not a place');
    expect(result.text).toContain('crew_berths');
  });

  it('refuses a character with no recorded position', () => {
    const result = planMove({
      entityId: 'mara_odinsen',
      to: 'bridge',
      worldFacts: at('cryo_bay'),
    });
    expect(result).toEqual({
      ok: false,
      text: 'No position is recorded for "mara_odinsen".',
    });
  });

  it('refuses a recorded position that is not a place', () => {
    const result = planMove({
      entityId: 'danny',
      to: 'bridge',
      worldFacts: at('At the cryo bay bulkhead, on mid-deck.'),
    });
    expect(result.ok).toBe(false);
  });
});
