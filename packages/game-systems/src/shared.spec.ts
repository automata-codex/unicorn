import { describe, expect, it } from 'vitest';

import {
  EntitySchema,
  EntityStatusSchema,
  FlagSchema,
  ResourcePoolSchema,
  ScenarioStateEntrySchema,
} from './shared';

describe('ResourcePoolSchema', () => {
  it('accepts integer current and max', () => {
    expect(() => ResourcePoolSchema.parse({ current: 5, max: 10 })).not.toThrow();
  });

  it('accepts null max for unbounded pools', () => {
    expect(() => ResourcePoolSchema.parse({ current: 3, max: null })).not.toThrow();
  });

  it('rejects non-integer current', () => {
    expect(() => ResourcePoolSchema.parse({ current: 2.5, max: 10 })).toThrow();
  });

  it('rejects missing max', () => {
    expect(() => ResourcePoolSchema.parse({ current: 5 })).toThrow();
  });
});

describe('EntityStatusSchema', () => {
  it.each(['alive', 'dead', 'unknown'])('accepts %s', (status) => {
    expect(() => EntityStatusSchema.parse(status)).not.toThrow();
  });

  it('rejects an unknown status value', () => {
    expect(() => EntityStatusSchema.parse('fleeing')).toThrow();
  });
});

describe('EntitySchema', () => {
  it('accepts a minimal entity and defaults status to unknown', () => {
    const result = EntitySchema.parse({ visible: true });
    expect(result.status).toBe('unknown');
    expect(result.npcState).toBeUndefined();
  });

  it('accepts a full entity', () => {
    const result = EntitySchema.parse({
      visible: false,
      status: 'alive',
      npcState: 'Hostile — cornered, low ammo',
    });
    expect(result.status).toBe('alive');
    expect(result.npcState).toBe('Hostile — cornered, low ammo');
  });

  it('rejects missing visible field', () => {
    expect(() => EntitySchema.parse({ status: 'alive' })).toThrow();
  });
});

describe('FlagSchema', () => {
  it('accepts a flag with value and trigger', () => {
    expect(() =>
      FlagSchema.parse({ value: false, trigger: 'Player reaches the bridge.' }),
    ).not.toThrow();
  });

  it('rejects a flag missing trigger', () => {
    expect(() => FlagSchema.parse({ value: true })).toThrow();
  });

  it('rejects a flag with a non-boolean value', () => {
    expect(() => FlagSchema.parse({ value: 'yes', trigger: 'x' })).toThrow();
  });
});

describe('ScenarioStateEntrySchema', () => {
  it('accepts a numeric entry and defaults note to empty string', () => {
    const result = ScenarioStateEntrySchema.parse({ current: 4, max: 4 });
    expect(result.note).toBe('');
  });

  it('accepts null max', () => {
    expect(() =>
      ScenarioStateEntrySchema.parse({ current: 0, max: null }),
    ).not.toThrow();
  });

  it('rejects non-integer current', () => {
    expect(() =>
      ScenarioStateEntrySchema.parse({ current: 1.5, max: 4 }),
    ).toThrow();
  });
});
