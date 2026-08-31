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
 * ## Why it keys on the shape, not on `schema_version`
 *
 * The version column is the *declaration* of what a row holds; this function
 * does not read it, and the distinction is deliberate. Not every read path
 * selects the version — `session.repository.ts` selects `blob` alone — so a
 * version-gated migration would silently no-op wherever a caller had not
 * thought to add the column to a projection, which is the worst available
 * failure: a v1 blob arriving at the prompt builder with `scenarioPremise`
 * undefined and rendering the string "undefined" to the Warden every turn.
 * Keying on the shape is total, and it is the same rule
 * `backfillEntityRevealed` (`eval/harness-runner.ts`) uses for the same kind of
 * problem.
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
 * Retiring this is a later, optional change: a `V21` that rewrites the key in
 * both tables, after which this function can go.
 */

/**
 * The shape `buildGmContextBlob` writes today. Version 1 blobs carry
 * `narrative.location` where version 2 carries `narrative.scenarioPremise`.
 */
export const GM_CONTEXT_SCHEMA_VERSION = 2;

/**
 * Brings a persisted `gm_context` blob up to the current shape.
 *
 * Total and idempotent: a version-2 blob is returned untouched, and a blob
 * carrying **both** keys keeps `scenarioPremise` and drops `location` — that
 * combination should not occur, but resolving it silently in favour of the
 * older key would be a slow way to lose the newer value.
 *
 * Returns the input by reference when nothing changed, so the common path
 * allocates nothing.
 */
export function migrateGmContextBlob<T>(blob: T): T {
  if (typeof blob !== 'object' || blob === null) return blob;

  const narrative = (blob as { narrative?: unknown }).narrative;
  if (typeof narrative !== 'object' || narrative === null) return blob;

  const record = narrative as Record<string, unknown>;
  if (!('location' in record)) return blob;

  const { location, ...rest } = record;
  return {
    ...(blob as Record<string, unknown>),
    narrative:
      'scenarioPremise' in record
        ? rest
        : { ...rest, scenarioPremise: location },
  } as T;
}
