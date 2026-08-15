import { count, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';

import type { Db } from '../src/db/db.provider';

export class EvalPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalPreflightError';
  }
}

/**
 * Asserts the rules index is populated for `systemSlug` before a run starts.
 *
 * **The failure mode this exists for is silence.** M7.6 is the first milestone
 * whose *mechanical correctness* depends on `rules_lookup` returning a
 * specific table row rather than on the Warden reasoning from prose: the
 * Wounds Table is TKG content and does not ship in this repo, so it reaches
 * the Warden only through the self-hoster's own ingested PDF. Against an empty
 * index, `rules_lookup` returns nothing, the Warden cannot read the table, and
 * every Wounds fixture fails — for infrastructure reasons that are
 * indistinguishable from Warden failures in the scores.
 *
 * That is precisely the shape `eval-methodology.md § Two kinds of corpus bump`
 * names as the thing to avoid: a harness defect that "silently produces
 * numbers that look fine and mean nothing". Nothing checked this before.
 *
 * Cheap, and it generalises past this milestone — every retrieval-dependent
 * check has the same exposure.
 *
 * Known concretely: the PSG is ingested in local dev and **not** on the
 * enceladus host where the harness runs (D6).
 */
export async function assertRulesIndexPopulated(
  db: Db,
  systemSlug = 'mothership',
): Promise<void> {
  const [system] = await db
    .select({ id: schema.gameSystems.id })
    .from(schema.gameSystems)
    .where(eq(schema.gameSystems.slug, systemSlug))
    .limit(1);

  if (!system) {
    throw new EvalPreflightError(
      `preflight: no game_system row with slug "${systemSlug}". Seed the ` +
        'system before running the harness.',
    );
  }

  const [row] = await db
    .select({ n: count() })
    .from(schema.rulesChunks)
    .where(eq(schema.rulesChunks.systemId, system.id));

  if ((row?.n ?? 0) === 0) {
    throw new EvalPreflightError(
      `preflight: rules_chunk is empty for system "${systemSlug}". ` +
        'rules_lookup would return nothing for every query, and any fixture ' +
        'whose correctness depends on retrieval — the Wounds Table above all ' +
        '— would fail for infrastructure reasons indistinguishable from ' +
        'Warden failures in the scores. Ingest the rulebook on this host ' +
        'before running the harness, or pass --skip-preflight if you have ' +
        'deliberately scoped the run to fixtures that need no retrieval.',
    );
  }
}
