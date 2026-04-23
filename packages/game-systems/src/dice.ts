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
