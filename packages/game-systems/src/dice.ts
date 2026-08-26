export interface ParsedNotation {
  count: number;
  sides: number;
  modifier: number;
}

export class DiceNotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceNotationError';
  }
}

const NOTATION_REGEX = /^(\d+)d(\d+)([+-]\d+)?$/;
const SUPPORTED_SIDES = [2, 3, 4, 6, 8, 10, 12, 20, 100];

export function parseDiceNotation(notation: string): ParsedNotation {
  const match = notation.trim().match(NOTATION_REGEX);
  if (!match) {
    throw new DiceNotationError(`Invalid dice notation: ${notation}`);
  }
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  if (count <= 0 || count > 100) {
    throw new DiceNotationError(`Dice count out of range (1–100): ${count}`);
  }
  if (!SUPPORTED_SIDES.includes(sides)) {
    throw new DiceNotationError(`Unsupported die sides: d${sides}`);
  }
  return { count, sides, modifier };
}

export interface DiceRollResult {
  notation: string;
  results: number[];
  modifier: number;
  total: number;
}

/**
 * Unbiased integer in [0, sides) drawn from the platform's CSPRNG.
 *
 * Rejection sampling eliminates modulo bias — for any `sides` in the
 * supported set the rejection probability is below 2^-32, so this is a
 * single-iteration loop in expectation.
 */
export function webCryptoRandomInt(sides: number): number {
  const buffer = new Uint32Array(1);
  const maxUnbiased = Math.floor(0x1_0000_0000 / sides) * sides;
  while (true) {
    globalThis.crypto.getRandomValues(buffer);
    if (buffer[0] < maxUnbiased) return buffer[0] % sides;
  }
}

export function executeDiceRoll(
  notation: string,
  randomInt: (sides: number) => number = webCryptoRandomInt,
): DiceRollResult {
  const { count, sides, modifier } = parseDiceNotation(notation);
  const results = Array.from({ length: count }, () => randomInt(sides) + 1);
  const total = results.reduce((a, b) => a + b, 0) + modifier;
  return { notation, results, modifier, total };
}

/**
 * Converts a die result into the row index of a Mothership table.
 *
 * **Every table in the book is indexed from `00`** — Loadouts run `00`–`09`,
 * Trinkets and Patches `00`–`99` — while `executeDiceRoll` returns `1`–`N`
 * (`randomInt(sides) + 1`, above). A raw roll therefore cannot index the table
 * it was rolled for, and the top result has no row at all.
 *
 * **The offset belongs here and not at the roll site.** A creation roll records
 * what the dice showed and nothing may transform it before storage — that is
 * the property the whole `creationRolls` design rests on
 * (`character-sheet.schema.ts`). Subtracting one on the way in would store a
 * number the player never saw on a die, and it would have to be added back to
 * display the roll. So: store as rolled, offset at lookup, in one place.
 *
 * `trinket` and `patch` have carried the same 1-based roll since M7.6 without
 * anything applying an offset, because the player resolves those two tables
 * from their own copy of the book. This establishes the convention rather than
 * repairing a live miscalculation.
 */
export function tableIndexForRoll(die: number): number {
  if (!Number.isInteger(die) || die < 1) {
    throw new DiceNotationError(
      `Table lookups need a die result of 1 or more, got ${die}`,
    );
  }
  return die - 1;
}
