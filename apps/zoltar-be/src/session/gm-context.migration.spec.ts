import { describe, expect, it } from 'vitest';

import {
  GM_CONTEXT_SCHEMA_VERSION,
  GmContextMigrationError,
  migrateGmContextBlob,
} from './gm-context.migration';

describe('migrateGmContextBlob', () => {
  describe('v1 → v2: narrative.location → scenarioPremise', () => {
    it('renames the key on a blob declared v1', () => {
      const migrated = migrateGmContextBlob(
        {
          openingNarration: 'Amber lights pulse.',
          narrative: {
            location: 'Derelict freighter Persephone.',
            atmosphere: 'Dim corridors.',
          },
        },
        1,
      );

      expect(migrated.narrative).toEqual({
        scenarioPremise: 'Derelict freighter Persephone.',
        atmosphere: 'Dim corridors.',
      });
      expect(migrated.narrative).not.toHaveProperty('location');
      expect(migrated.openingNarration).toBe('Amber lights pulse.');
    });

    it('leaves other narrative keys alone', () => {
      const migrated = migrateGmContextBlob(
        {
          narrative: {
            location: 'premise',
            npcAgendas: { dr_chen: 'wants out' },
            hiddenTruth: 'the signal came from inside',
          },
        },
        1,
      );

      expect(migrated.narrative).toEqual({
        scenarioPremise: 'premise',
        npcAgendas: { dr_chen: 'wants out' },
        hiddenTruth: 'the signal came from inside',
      });
    });

    /**
     * Not something any write path produces, but the resolution has to be
     * deterministic and has to favour the newer key: preferring `location`
     * would silently discard a value written after the rename.
     */
    it('keeps scenarioPremise and drops location when a v1 blob has both', () => {
      const migrated = migrateGmContextBlob(
        { narrative: { location: 'stale', scenarioPremise: 'current' } },
        1,
      );

      expect(migrated.narrative).toEqual({ scenarioPremise: 'current' });
    });
  });

  describe('the version decides what runs', () => {
    it('returns a current blob by reference, having nothing to do', () => {
      const blob = {
        narrative: { scenarioPremise: 'A relay station gone quiet.' },
        structured: { flags: {} },
      };
      // Identity, not equality: the common path is every turn of every
      // adventure and must not clone.
      expect(migrateGmContextBlob(blob, GM_CONTEXT_SCHEMA_VERSION)).toBe(blob);
    });

    /**
     * The point of the rework (`ADR-0118` addendum). Under shape-keying this
     * blob would have been silently rewritten because it *looks* old. The
     * version says it is current, so the honest answer is that the row is
     * inconsistent — and saying so is the whole difference between finding out
     * and not.
     */
    it('throws on a blob whose version and shape disagree', () => {
      expect(() =>
        migrateGmContextBlob(
          { narrative: { location: 'should have been migrated' } },
          GM_CONTEXT_SCHEMA_VERSION,
        ),
      ).toThrow(GmContextMigrationError);

      expect(() =>
        migrateGmContextBlob(
          { narrative: { location: 'x' } },
          GM_CONTEXT_SCHEMA_VERSION,
        ),
      ).toThrow(/retired key `narrative\.location`/);
    });

    it('refuses a version from the future rather than guessing', () => {
      expect(() =>
        migrateGmContextBlob({}, GM_CONTEXT_SCHEMA_VERSION + 1),
      ).toThrow(/newer-data-older-code/);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
      ['NaN', Number.NaN],
    ])('refuses a %s version', (_label, version) => {
      expect(() => migrateGmContextBlob({}, version)).toThrow(
        /must be a positive integer/,
      );
    });
  });

  describe('blobs with nothing to migrate', () => {
    /**
     * `gm_context.blob` is `jsonb NOT NULL DEFAULT '{}'` and
     * `setAdventureFailed` writes `{ error: … }` into it, so a blob with no
     * `narrative` is a real row rather than a hypothetical.
     */
    it.each([
      ['an empty blob', {}],
      ['a failure blob', { error: 'synthesis timed out' }],
      ['a null narrative', { narrative: null }],
      ['a string narrative', { narrative: 'not an object' }],
      ['an array narrative', { narrative: [] }],
    ])('passes through %s unchanged', (_label, blob) => {
      expect(migrateGmContextBlob(blob, 1)).toBe(blob);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'not a blob'],
      ['an array', []],
    ])('passes through %s rather than throwing', (_label, value) => {
      expect(migrateGmContextBlob(value, 1)).toBe(value);
    });
  });

  it('is idempotent once a blob is current', () => {
    const once = migrateGmContextBlob({ narrative: { location: 'a' } }, 1);
    expect(migrateGmContextBlob(once, GM_CONTEXT_SCHEMA_VERSION)).toBe(once);
  });

  /**
   * The version is derived from the chain rather than declared beside it, so
   * this is really asserting that exactly one migration exists — which is what
   * the write paths stamp and what `docs/schema.md` requires a bump to be
   * paired with.
   */
  it('derives the current version from the migration chain', () => {
    expect(GM_CONTEXT_SCHEMA_VERSION).toBe(2);
  });
});
