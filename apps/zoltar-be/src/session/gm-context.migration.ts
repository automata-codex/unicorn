/**
 * Forward-migration for `gm_context.blob` and the copy of it frozen in
 * `adventure_synthesis_snapshots.gm_context_blob`.
 *
 * ## Why this exists
 *
 * `ADR-0118` renamed `narrative.location` to `narrative.scenarioPremise`.
 * `docs/schema.md` classes a renamed field in a versioned blob as a breaking
 * shape change: it must be paired with code that either lazily migrates on read
 * or rejects old rows loudly. Rejecting would break replay of the two playtest
 * campaigns the eval corpus was captured from, so it migrates.
 *
 * ## The version decides what runs; the shape only checks the answer
 *
 * `MIGRATIONS` is an ordered chain of `vN → vN+1` steps and the caller supplies
 * the row's `schema_version`. Adding a migration means appending one step; the
 * current version falls out of the array length, so the two cannot drift apart.
 *
 * **This was shape-keyed first, and the reasoning did not hold up**
 * (`ADR-0118` addendum). The argument was that not every read path selects the
 * version column, so a version-gated migration would silently no-op wherever a
 * caller had not thought to fetch it. That is a defect to close, not to route
 * around: the column is `NOT NULL`, every read site can select it, and the ones
 * that matter now do. Detecting the shape instead bought robustness against a
 * careless caller and paid for it in three ways that only bite later — sniffers
 * do not compose into a chain, they cannot express a field renamed away and
 * back, and they cannot tell "old blob missing a key" from "current blob
 * missing a key."
 *
 * What shape detection was genuinely good for is catching a **lying label**, and
 * that survives as `assertNoLegacyKeys` — an assertion on the *output*, not the
 * mechanism. A row labelled v2 that still carries `narrative.location` now
 * throws instead of being silently repaired, which is the difference between
 * finding out and not.
 *
 * ## What it covers, and what that saves
 *
 * `ADR-0101` needed two mechanisms for its shape change — a SQL backfill for
 * the database and a load-time normalizer for the eval corpus, because "the
 * eval corpus is not in the database." That is true of `campaignState`, which
 * the harness seeds down a different path. It is **not** true of
 * `gmContextBlob`: `harness-runner.ts` inserts the fixture's blob into
 * `gm_context` and the run reads it back through the real repository. So one
 * read-migration covers all 33 fixtures as well as every persisted row, their
 * bytes never change, and `corpusVersion` — which hashes fixture bytes
 * (`eval/corpus-version.ts`) — does not move. No backfill migration is owed.
 *
 * Retiring a step is a later, optional change: a SQL migration that rewrites the
 * key in both tables, after which the step becomes a no-op that can be left in
 * place. **Do not delete a step and renumber** — the version a row carries is
 * an index into this array forever.
 */

/** Thrown when a row's `schema_version` and its blob disagree. */
export class GmContextMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmContextMigrationError';
  }
}

type Blob = Record<string, unknown>;

function isRecord(value: unknown): value is Blob {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `narrative.location` → `narrative.scenarioPremise` (`ADR-0118`).
 *
 * A blob carrying **both** keeps `scenarioPremise` and drops `location`. That
 * combination is not something any write path produces, but resolving it in
 * favour of the older key would silently discard a value written after the
 * rename, which is a far slower failure than preferring the newer one.
 */
function v1ToV2(blob: Blob): Blob {
  const narrative = blob.narrative;
  if (!isRecord(narrative)) return blob;
  if (!('location' in narrative)) return blob;

  const { location, ...rest } = narrative;
  return {
    ...blob,
    narrative:
      'scenarioPremise' in narrative
        ? rest
        : { ...rest, scenarioPremise: location },
  };
}

/**
 * Ordered chain. `MIGRATIONS[i]` takes a `v(i+1)` blob to `v(i+2)`. Append
 * only — never reorder, never delete.
 */
const MIGRATIONS: ReadonlyArray<{
  /** The version this step produces. For the assertion messages. */
  readonly to: number;
  readonly summary: string;
  readonly migrate: (blob: Blob) => Blob;
}> = [
  { to: 2, summary: 'narrative.location → scenarioPremise', migrate: v1ToV2 },
];

/**
 * The version this build writes, derived from the chain rather than declared
 * beside it — a step cannot be added without the version following.
 */
export const GM_CONTEXT_SCHEMA_VERSION = MIGRATIONS.length + 1;

/**
 * Keys that a migration has retired. Their presence in a blob that claims to be
 * current means the row's `schema_version` is lying, which no code path here
 * produces — so it is a bug or a hand-edited row, and either way the useful
 * response is to say so rather than to guess.
 *
 * Deliberately *not* used to decide whether to migrate. That was the old
 * design; see the note at the top of this file.
 */
const RETIRED_KEYS: ReadonlyArray<{
  path: string;
  check: (b: Blob) => boolean;
}> = [
  {
    path: 'narrative.location',
    check: (b) => isRecord(b.narrative) && 'location' in b.narrative,
  },
];

function assertNoLegacyKeys(blob: Blob, declaredVersion: number): void {
  for (const { path, check } of RETIRED_KEYS) {
    if (check(blob)) {
      throw new GmContextMigrationError(
        `gm_context blob declares schema_version ${declaredVersion} but still ` +
          `carries the retired key \`${path}\`. The row's version is wrong — ` +
          'migrating on the declared version cannot fix a mislabelled row, and ' +
          'guessing from the shape is what this check exists instead of.',
      );
    }
  }
}

/**
 * Brings a persisted `gm_context` blob up to `GM_CONTEXT_SCHEMA_VERSION`.
 *
 * `fromVersion` is the row's `schema_version` column and is required — there is
 * no default, because a default is exactly how a caller silently skips the
 * migration. Both tables that hold a blob carry the column `NOT NULL`
 * (`gm_context.schema_version`, `adventure_synthesis_snapshots
 * .gm_context_schema_version`), so it is always available to select.
 *
 * Returns the input by reference when there is nothing to do, so the common
 * path — a current blob, every turn — allocates nothing.
 */
export function migrateGmContextBlob<T>(blob: T, fromVersion: number): T {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new GmContextMigrationError(
      `gm_context schema_version must be a positive integer, got ` +
        `${String(fromVersion)}.`,
    );
  }

  if (fromVersion > GM_CONTEXT_SCHEMA_VERSION) {
    throw new GmContextMigrationError(
      `gm_context blob declares schema_version ${fromVersion}, but this build ` +
        `understands at most ${GM_CONTEXT_SCHEMA_VERSION}. This is a ` +
        'newer-data-older-code deployment; there is no backward migration.',
    );
  }

  // A blob need not be an object: `gm_context.blob` is `jsonb NOT NULL DEFAULT
  // '{}'`, and nothing stops a row holding a scalar. Nothing to migrate and
  // nothing to assert.
  if (!isRecord(blob)) return blob;

  let out: Blob = blob;
  for (let v = fromVersion; v < GM_CONTEXT_SCHEMA_VERSION; v++) {
    out = MIGRATIONS[v - 1].migrate(out);
  }

  assertNoLegacyKeys(out, fromVersion);
  return out as T;
}
