/**
 * PROTOTYPE — branch `route-tool`, `docs/eval-findings.md § S76`. Not for
 * merging: the place list is one ship's, written by hand.
 *
 * The backend works out the route between two places and hands the Warden
 * the answer, where every earlier fix handed it facts and left the route to
 * it. No model is involved: two lookups and a comparison.
 */

/** The Halbrecht's `ship_layout` as data. Deck 1 is the top. */
export const HALBRECHT_PLACES = {
  bridge: 1,
  comms_array: 1,
  captains_quarters: 1,
  records_terminal: 1,
  crew_berths: 2,
  mess_hall: 2,
  medbay: 2,
  cryo_bay: 2,
  // The one place `ship_layout` does not name. Turn 14 starts in it.
  mid_deck_corridor: 2,
  cargo_bay: 3,
  engine_room: 3,
  life_support: 3,
  aft_airlock: 3,
} as const satisfies Record<string, 1 | 2 | 3>;

export type PlaceId = keyof typeof HALBRECHT_PLACES;

export const PLACE_IDS = Object.keys(HALBRECHT_PLACES) as [
  PlaceId,
  ...PlaceId[],
];

const DECK_NAMES = { 1: 'upper', 2: 'mid', 3: 'lower' } as const;

const COUNT_WORDS = ['no', 'One', 'Two'] as const;

export function isPlaceId(value: string): value is PlaceId {
  return Object.hasOwn(HALBRECHT_PLACES, value);
}

/** Where a character's position is kept for the prototype: a world fact. */
export function locationKey(entityId: string): string {
  return `${entityId}_location`;
}

function deckLabel(place: PlaceId): string {
  const deck = HALBRECHT_PLACES[place];
  return `deck ${deck}, ${DECK_NAMES[deck]}`;
}

export type PlanMoveResult =
  | { ok: true; from: PlaceId; to: PlaceId; decksCrossed: number; text: string }
  | { ok: false; text: string };

/**
 * The route for one character from where the state has them to `to`. The
 * start is read from the world facts and never taken from the caller, so the
 * Warden cannot supply a wrong one.
 */
export function planMove(input: {
  entityId: string;
  to: string;
  worldFacts: Record<string, string>;
}): PlanMoveResult {
  const { entityId, to, worldFacts } = input;
  const places = PLACE_IDS.join(', ');

  if (!isPlaceId(to)) {
    return {
      ok: false,
      text: `"${to}" is not a place on this ship. The places are: ${places}. Name the one the destination is in.`,
    };
  }

  const from = worldFacts[locationKey(entityId)];
  if (from === undefined) {
    return {
      ok: false,
      text: `No position is recorded for "${entityId}".`,
    };
  }
  if (!isPlaceId(from)) {
    return {
      ok: false,
      text: `The position recorded for "${entityId}" is "${from}", which is not a place on this ship.`,
    };
  }

  const fromDeck = HALBRECHT_PLACES[from];
  const toDeck = HALBRECHT_PLACES[to];
  const where = `${entityId} is in ${from} (${deckLabel(from)}). ${to} is on ${deckLabel(to)}.`;

  if (from === to) {
    return {
      ok: true,
      from,
      to,
      decksCrossed: 0,
      text: `${entityId} is already in ${to} (${deckLabel(to)}). No ladder and no change of deck.`,
    };
  }

  if (fromDeck === toDeck) {
    return {
      ok: true,
      from,
      to,
      decksCrossed: 0,
      text: `${where} Same deck: a walk, with no ladder and no change of deck.`,
    };
  }

  const crossed = Math.abs(toDeck - fromDeck);
  const direction = toDeck > fromDeck ? 'down' : 'up';
  const passes =
    crossed === 1
      ? 'passes no other deck'
      : `passes deck 2 (${DECK_NAMES[2]}) on the way`;
  return {
    ok: true,
    from,
    to,
    decksCrossed: crossed,
    text: `${where} ${COUNT_WORDS[crossed]} deck${crossed === 1 ? '' : 's'} ${direction}, by the ladder shaft. The trip starts on deck ${fromDeck} and ends on deck ${toDeck} and ${passes}.`,
  };
}
