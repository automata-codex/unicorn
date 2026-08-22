import { count, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';

import { findAssemblyGoldenMismatches } from '../src/session/session.assembly';

import { selectChecksForFixture } from './checks/registry';

import type { AssemblyGoldenMismatch } from '../src/session/session.assembly';
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

/**
 * Renders a mismatch list into the preflight message. Separate from the
 * assertion, and exported, for the reason `describeToolCallSyntax`
 * (`src/session/session.tool-syntax.ts`) is: the wording is the load-bearing
 * part and testing it should not require provoking the condition.
 *
 * **Both readings are named deliberately.** A differing golden is ambiguous
 * between a stale workspace build and an uncommitted formatter edit, and the
 * two fixes are opposite — telling someone only one of them sends half of
 * them the wrong way.
 */
export function describeAssemblyGoldenMismatches(
  mismatches: AssemblyGoldenMismatch[],
): string {
  const differing = mismatches.filter((m) => m.reason === 'differs');
  const missing = mismatches.filter((m) => m.reason === 'missing');

  return (
    `preflight: ${mismatches.length} assembly golden(s) do not match what ` +
    'this build renders, so `assemblyHash` would label the run with a value ' +
    'no commit corresponds to.\n' +
    mismatches
      .map((m) => `  - ${m.file} (${m.surface}): ${m.reason}`)
      .join('\n') +
    '\n' +
    (differing.length > 0
      ? "A differing golden means one of two opposite things. Either this " +
        'host\u2019s workspace build is stale \u2014 run `npm run build` at the repo ' +
        'root and try again, which is the case `ADR-0099`\u2019s addendum records ' +
        '\u2014 or a formatter changed and its golden was not committed, in which ' +
        'case `UPDATE_ASSEMBLY_GOLDENS=1 npx vitest run ' +
        'src/session/session.assembly.spec.ts` is right and the diff belongs ' +
        'in review.\n'
      : '') +
    (missing.length > 0
      ? 'A missing golden has never been committed; generate it the same ' +
        'way.\n'
      : '') +
    'This preflight is not skippable: --skip-preflight covers the rules ' +
    'index, not the truth of the run label.'
  );
}

/**
 * Refuses a run whose committed assembly goldens no longer match what the code
 * renders — which means the label about to be written on this run would be
 * false.
 *
 * **The failure this exists for produced a run and nobody could see it.**
 * `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z` recorded
 * `harnessVersion 1458aaf` with `assemblyHash 8e332e38`; that commit produces
 * `6dc28608` against a current workspace build. The eval host was running a
 * `@uv/game-systems` `dist` built before `revealed` existed on `EntitySchema`,
 * and `ASSEMBLY_PROBE.campaignStateData` is built with
 * `MothershipCampaignStateSchema.parse`, so Zod stripped the unknown key and
 * the probe rendered `undiscovered` for entities carrying `revealed: true`.
 *
 * Nothing the Warden read was wrong — the probe feeds the hash and the goldens
 * and is never sent — so the measurement stands and only its label is false.
 * That is what makes it worth refusing rather than warning: a wrong number
 * gets noticed, and a wrong label does not (`ADR-0099`, addendum).
 *
 * **Not skippable, following `assertNoStubCheckers` rather than
 * `assertRulesIndexPopulated`.** The distinction those two already draw is the
 * right one. `--skip-preflight` exists for assertions about *the environment*,
 * which a self-hoster may legitimately know are fine. This one's subject is
 * whether the identity about to be recorded is true, and there is no state of
 * the world under which recording a false one is correct.
 *
 * The message names both readings deliberately: a failing golden is ambiguous
 * between a stale build and an uncommitted formatter edit, and the two fixes
 * are opposite.
 */
export function assertAssemblyGoldensCurrent(): void {
  const mismatches = findAssemblyGoldenMismatches();
  if (mismatches.length === 0) return;
  throw new EvalPreflightError(describeAssemblyGoldenMismatches(mismatches));
}
