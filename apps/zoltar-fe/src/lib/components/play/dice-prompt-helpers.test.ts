import { describe, expect, it } from 'vitest';

import {
  allFilled,
  buildInitialEntry,
  rollForMe,
  validateDieInput,
} from './dice-prompt-helpers';

describe('buildInitialEntry', () => {
  it('returns count empty slots for a single-die notation', () => {
    const entry = buildInitialEntry({
      id: 'req-1',
      notation: '1d100',
      purpose: 'Panic',
      target: null,
    });
    expect(entry.count).toBe(1);
    expect(entry.sides).toBe(100);
    expect(entry.entries).toEqual([null]);
    expect(entry.source).toBe('player_entered');
  });

  it('returns count empty slots for a multi-die notation', () => {
    const entry = buildInitialEntry({
      id: 'req-1',
      notation: '3d6',
      purpose: 'Damage',
      target: null,
    });
    expect(entry.count).toBe(3);
    expect(entry.sides).toBe(6);
    expect(entry.entries).toEqual([null, null, null]);
  });

  it('carries the request id and notation through', () => {
    const entry = buildInitialEntry({
      id: 'abc',
      notation: '2d6+1',
      purpose: 'x',
      target: 7,
    });
    expect(entry.requestId).toBe('abc');
    expect(entry.notation).toBe('2d6+1');
  });
});

describe('validateDieInput', () => {
  it('returns valid: null for empty input', () => {
    expect(validateDieInput('', 100)).toEqual({ valid: null });
    expect(validateDieInput('   ', 100)).toEqual({ valid: null });
  });

  it('accepts an integer inside the range', () => {
    expect(validateDieInput('34', 100)).toEqual({ valid: true, value: 34 });
    expect(validateDieInput('1', 100)).toEqual({ valid: true, value: 1 });
    expect(validateDieInput('100', 100)).toEqual({ valid: true, value: 100 });
  });

  it('rejects zero and negative values', () => {
    expect(validateDieInput('0', 100).valid).toBe(false);
    expect(validateDieInput('-5', 100).valid).toBe(false);
  });

  it('rejects values above the die size', () => {
    const result = validateDieInput('101', 100);
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.error).toMatch(/between 1 and 100/);
    }
  });

  it('rejects non-integer shapes (decimals, text)', () => {
    expect(validateDieInput('1.5', 100).valid).toBe(false);
    expect(validateDieInput('abc', 100).valid).toBe(false);
    expect(validateDieInput('1a', 100).valid).toBe(false);
  });

  it('honors custom die sizes', () => {
    expect(validateDieInput('6', 6)).toEqual({ valid: true, value: 6 });
    expect(validateDieInput('7', 6).valid).toBe(false);
  });
});

describe('allFilled', () => {
  it('returns false when the entry list is empty', () => {
    expect(allFilled([])).toBe(false);
  });

  it('returns false when any die is still null', () => {
    const entry = buildInitialEntry({
      id: 'r',
      notation: '2d6',
      purpose: 'x',
      target: null,
    });
    entry.entries = [3, null];
    expect(allFilled([entry])).toBe(false);
  });

  it('returns true when every die across every request is filled', () => {
    const e1 = buildInitialEntry({
      id: 'r1',
      notation: '1d100',
      purpose: 'x',
      target: null,
    });
    const e2 = buildInitialEntry({
      id: 'r2',
      notation: '2d6',
      purpose: 'y',
      target: null,
    });
    e1.entries = [42];
    e2.entries = [3, 5];
    expect(allFilled([e1, e2])).toBe(true);
  });
});

describe('rollForMe', () => {
  it('returns an array of integers with the right length for the notation', () => {
    const results = rollForMe('3d6');
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });

  it('produces d100 results in [1, 100]', () => {
    const results = rollForMe('1d100');
    expect(results).toHaveLength(1);
    expect(results[0]).toBeGreaterThanOrEqual(1);
    expect(results[0]).toBeLessThanOrEqual(100);
  });
});
