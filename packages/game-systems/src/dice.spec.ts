import { describe, expect, it } from 'vitest';

import {
  DiceNotationError,
  executeDiceRoll,
  parseDiceNotation,
  webCryptoRandomInt,
} from './dice';

describe('parseDiceNotation', () => {
  it('parses a minimal notation', () => {
    expect(parseDiceNotation('1d100')).toEqual({
      count: 1,
      sides: 100,
      modifier: 0,
    });
  });

  it('parses a positive modifier', () => {
    expect(parseDiceNotation('2d6+3')).toEqual({
      count: 2,
      sides: 6,
      modifier: 3,
    });
  });

  it('parses a negative modifier', () => {
    expect(parseDiceNotation('3d10-2')).toEqual({
      count: 3,
      sides: 10,
      modifier: -2,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseDiceNotation('  1d20  ')).toEqual({
      count: 1,
      sides: 20,
      modifier: 0,
    });
  });

  it('rejects a malformed notation', () => {
    expect(() => parseDiceNotation('d20')).toThrow(DiceNotationError);
  });

  it('rejects notation with a space inside', () => {
    expect(() => parseDiceNotation('1 d20')).toThrow(DiceNotationError);
  });

  it('rejects a zero count', () => {
    expect(() => parseDiceNotation('0d6')).toThrow(DiceNotationError);
  });

  it('rejects a count above 100', () => {
    expect(() => parseDiceNotation('101d6')).toThrow(DiceNotationError);
  });

  it('rejects an unsupported die size', () => {
    expect(() => parseDiceNotation('1d7')).toThrow(DiceNotationError);
  });

  it.each([2, 3, 4, 6, 8, 10, 12, 20, 100])('accepts d%i', (sides) => {
    expect(parseDiceNotation(`1d${sides}`).sides).toBe(sides);
  });
});

describe('executeDiceRoll', () => {
  it('produces reproducible results with an injected randomInt', () => {
    // Counter returns 0, 1, 2, … on successive calls.
    let n = 0;
    const randomInt = (_sides: number) => n++;
    const result = executeDiceRoll('3d6', randomInt);
    expect(result.notation).toBe('3d6');
    // randomInt returns [0, 1, 2], executor adds 1 to each → [1, 2, 3].
    expect(result.results).toEqual([1, 2, 3]);
    expect(result.modifier).toBe(0);
    expect(result.total).toBe(6);
  });

  it('applies a positive modifier to total', () => {
    const randomInt = (_sides: number) => 4; // always returns 4 → die face 5
    const result = executeDiceRoll('2d6+3', randomInt);
    expect(result.results).toEqual([5, 5]);
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(13);
  });

  it('applies a negative modifier to total', () => {
    const randomInt = (_sides: number) => 0; // always returns face 1
    const result = executeDiceRoll('3d10-2', randomInt);
    expect(result.results).toEqual([1, 1, 1]);
    expect(result.modifier).toBe(-2);
    expect(result.total).toBe(1);
  });

  it('surfaces DiceNotationError when notation is invalid', () => {
    expect(() => executeDiceRoll('wat', () => 0)).toThrow(DiceNotationError);
  });

  it('calls randomInt exactly count times', () => {
    let calls = 0;
    const randomInt = (_sides: number) => {
      calls++;
      return 0;
    };
    executeDiceRoll('5d6', randomInt);
    expect(calls).toBe(5);
  });
});

describe('webCryptoRandomInt', () => {
  it('requires a functioning globalThis.crypto.getRandomValues', () => {
    expect(typeof globalThis.crypto?.getRandomValues).toBe('function');
  });

  it('returns values in the half-open interval [0, sides)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = webCryptoRandomInt(100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('hits every bucket across 10,000 d100 draws (statistical sanity)', () => {
    const buckets = new Array(100).fill(0);
    for (let i = 0; i < 10000; i++) {
      buckets[webCryptoRandomInt(100)]++;
    }
    const mean = 10000 / 100;
    // Every bucket hit at least once — catches off-by-one on bounds.
    expect(buckets.every((count) => count > 0)).toBe(true);
    // No bucket more than 3× the mean — catches gross distribution failures.
    expect(Math.max(...buckets)).toBeLessThan(mean * 3);
  });
});
