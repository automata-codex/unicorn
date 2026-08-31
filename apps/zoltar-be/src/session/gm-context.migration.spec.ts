import { describe, expect, it } from 'vitest';

import {
  GM_CONTEXT_SCHEMA_VERSION,
  migrateGmContextBlob,
} from './gm-context.migration';

describe('migrateGmContextBlob', () => {
  it('renames narrative.location to scenarioPremise on a version-1 blob', () => {
    const migrated = migrateGmContextBlob({
      openingNarration: 'Amber lights pulse.',
      narrative: {
        location: 'Derelict freighter Persephone.',
        atmosphere: 'Dim corridors.',
      },
    });

    expect(migrated.narrative).toEqual({
      scenarioPremise: 'Derelict freighter Persephone.',
      atmosphere: 'Dim corridors.',
    });
    expect(migrated.narrative).not.toHaveProperty('location');
    // Everything outside `narrative` is carried through untouched.
    expect(migrated.openingNarration).toBe('Amber lights pulse.');
  });

  it('returns a version-2 blob by reference, having nothing to do', () => {
    const blob = {
      narrative: { scenarioPremise: 'A relay station gone quiet.' },
      structured: { flags: {} },
    };
    // Identity, not equality: the common path must not clone the blob on
    // every read of every turn.
    expect(migrateGmContextBlob(blob)).toBe(blob);
  });

  /**
   * Should not occur — nothing writes both — but the resolution has to be
   * deterministic rather than incidental, and it has to favour the newer key.
   * Preferring `location` here would silently discard a value written after
   * the rename, which is a much slower failure than a crash.
   */
  it('keeps scenarioPremise and drops location when a blob carries both', () => {
    const migrated = migrateGmContextBlob({
      narrative: { location: 'stale', scenarioPremise: 'current' },
    });

    expect(migrated.narrative).toEqual({ scenarioPremise: 'current' });
  });

  it('is idempotent', () => {
    const once = migrateGmContextBlob({ narrative: { location: 'a' } });
    expect(migrateGmContextBlob(once)).toEqual(once);
  });

  it('leaves other narrative keys alone', () => {
    const migrated = migrateGmContextBlob({
      narrative: {
        location: 'premise',
        npcAgendas: { dr_chen: 'wants out' },
        hiddenTruth: 'the signal came from inside',
        oracleConnections: 'signal ↔ sealed compartment',
      },
    });

    expect(migrated.narrative).toEqual({
      scenarioPremise: 'premise',
      npcAgendas: { dr_chen: 'wants out' },
      hiddenTruth: 'the signal came from inside',
      oracleConnections: 'signal ↔ sealed compartment',
    });
  });

  /**
   * The blob column is `jsonb NOT NULL DEFAULT '{}'`, and
   * `setAdventureFailed` writes `{ error: … }` into it, so a blob with no
   * `narrative` at all is a real row rather than a hypothetical.
   */
  it.each([
    ['an empty blob', {}],
    ['a failure blob', { error: 'synthesis timed out' }],
    ['a blob whose narrative is null', { narrative: null }],
    ['a blob whose narrative is a string', { narrative: 'not an object' }],
  ])('passes through %s unchanged', (_label, blob) => {
    expect(migrateGmContextBlob(blob)).toBe(blob);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not a blob'],
  ])('passes through %s rather than throwing', (_label, value) => {
    expect(migrateGmContextBlob(value)).toBe(value);
  });

  it('declares the version that pairs with this shape', () => {
    // The write paths stamp this; docs/schema.md requires a bump to be paired
    // with migration code, and this is that pairing made checkable.
    expect(GM_CONTEXT_SCHEMA_VERSION).toBe(2);
  });
});
