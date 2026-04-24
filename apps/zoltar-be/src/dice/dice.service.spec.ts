import { DiceNotationError } from '@uv/game-systems';
import { describe, expect, it } from 'vitest';

import { DiceInvocationError, DiceService } from './dice.service';

describe('DiceService.rollForGm', () => {
  it('executes a valid notation and returns a structured result', () => {
    const service = new DiceService();
    const result = service.rollForGm({
      notation: '1d100',
      purpose: 'Panic check',
    });
    expect(result.notation).toBe('1d100');
    expect(result.results.length).toBe(1);
    expect(result.results[0]).toBeGreaterThanOrEqual(1);
    expect(result.results[0]).toBeLessThanOrEqual(100);
    expect(result.modifier).toBe(0);
    expect(result.total).toBe(result.results[0]);
  });

  it('applies a modifier to the total', () => {
    const service = new DiceService();
    const result = service.rollForGm({
      notation: '2d6+3',
      purpose: 'Damage',
    });
    expect(result.modifier).toBe(3);
    const sum = result.results.reduce((a, b) => a + b, 0);
    expect(result.total).toBe(sum + 3);
  });

  it('translates DiceNotationError into DiceInvocationError', () => {
    const service = new DiceService();
    let thrown: unknown;
    try {
      service.rollForGm({ notation: 'not-a-notation', purpose: 'x' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DiceInvocationError);
    expect(thrown).not.toBeInstanceOf(DiceNotationError);
    expect((thrown as Error).message).toContain('Invalid dice notation');
  });

  it('translates an unsupported die size into DiceInvocationError', () => {
    const service = new DiceService();
    expect(() => service.rollForGm({ notation: '1d7', purpose: 'x' })).toThrow(
      DiceInvocationError,
    );
  });

  it('translates an out-of-range count into DiceInvocationError', () => {
    const service = new DiceService();
    expect(() => service.rollForGm({ notation: '0d6', purpose: 'x' })).toThrow(
      DiceInvocationError,
    );
  });
});
