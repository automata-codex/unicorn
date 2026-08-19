import { count, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';

import { selectChecksForFixture } from './checks/registry';

import type { Db } from '../src/db/db.provider';
import type { EvalFixture } from './fixture.schema';

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

/**
 * Refuses a run whose selected fixtures carry any **stub** check — one
 * registered so its tag exists, grading nothing (`EvalCheck.stub`).
 *
 * **Deliberately not skippable, and deliberately blunt.** `--skip-preflight`
 * exists for the rules-index assertion, whose subject is the environment and
 * which a self-hoster may legitimately know is fine. This one's subject is
 * the corpus in the repo: there is no state of the world under which running
 * against a stub is correct, so an escape hatch would only ever be used to
 * do the wrong thing quietly.
 *
 * The bluntness is the point and it has a real cost, which is the reason it
 * is stated here rather than discovered. A stub-carrying fixture usually
 * carries working checks too — the universal `tool-syntax-leak` attaches to
 * every fixture, so it always does — and this refuses the whole run rather
 * than dropping the stubbed check and grading the rest. Silently degrading
 * is what produces a report that reads as a measurement of the corpus and
 * is a measurement of part of it; `--fixtures` is the supported way to run
 * the remainder on purpose, and it puts the omission in the command line
 * where a reader of the run can see it.
 *
 * Runs before the harness session is created, so it costs nothing and spends
 * nothing — the whole point is to fail ahead of the first Warden turn rather
 * than after paying for every one of them.
 */
export function assertNoStubCheckers(fixtures: EvalFixture[]): void {
  const offenders: string[] = [];
  const stubs = new Set<string>();

  for (const fixture of fixtures) {
    const stubbed = selectChecksForFixture(fixture)
      .filter((check) => check.stub)
      .map((check) => check.id);
    if (stubbed.length === 0) continue;
    for (const id of stubbed) stubs.add(id);
    offenders.push(`${fixture.id} (${stubbed.sort().join(', ')})`);
  }

  if (offenders.length === 0) return;

  throw new EvalPreflightError(
    `preflight: ${offenders.length} selected fixture(s) carry a stub check, ` +
      'which grades nothing — a run including them would pay for their ' +
      'Warden turns and report the stubbed tag as covered.\n' +
      offenders.map((line) => `  - ${line}`).join('\n') +
      `\nImplement the checker(s) for ${[...stubs].sort().join(', ')} and ` +
      'clear their entry in STUB_CHECK_IDS (eval/checks/registry.ts), or ' +
      'select the remaining fixtures explicitly with --fixtures. This ' +
      'preflight is not skippable: --skip-preflight covers the rules index, ' +
      'not the corpus.',
  );
}
