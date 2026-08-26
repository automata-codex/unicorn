import type { StructuralVerdict } from './types';

/**
 * The shared body of a **stub checker** — a check that exists so its tag
 * exists, and grades nothing.
 *
 * Two tags need this today, `MISSING-DELTA` and `ROLL-RESULT-INVERSION`,
 * both surfaced by the 2026-08-16 playtest (adventure `5c34991b`). The turns
 * that provoke them were captured as fixtures against that adventure while
 * it was still in the database; designing the two checkers is separate work,
 * and blocking capture on it risked losing the seedable state to the next
 * `docker compose down -v`.
 *
 * **This function should never run.** `assertNoStubCheckers`
 * (`eval/preflight.ts`) refuses a run before the harness session is created
 * when any selected fixture carries a stub, so nothing reaches a stub
 * checker by the ordinary path. What is here is the answer to "and if it
 * somehow did".
 *
 * `NOT_APPLICABLE` rather than `PASSED` is that answer, and the distinction
 * is the one `StructuralOutcome` was written to preserve: a stub that
 * returned `PASSED` would report 1.00 on a failure mode nothing is looking
 * for — the same shape of blind spot `ADR-0096` closed for
 * `system-rolled-player-action`, where the tag read 1.00 (20/20) on a run
 * containing six violations. Defense in depth against a future caller that
 * reaches a checker without going through the run path, not the mechanism
 * anyone should be relying on.
 *
 * The fixtures carrying these tags author `applies: true`, because the
 * `applicability` entry describes the *scenario* and those scenarios do
 * provoke the failure. Nothing reads it while the tag is stubbed; authoring
 * it honestly means the entry is already right on the day a real checker
 * replaces this one.
 *
 * `actualCode` is set so exclusion aggregation groups every rep of every
 * such fixture under one stable key rather than fragmenting per tag text.
 */
export function checkUnimplemented(tag: string): StructuralVerdict {
  return {
    outcome: 'NOT_APPLICABLE',
    actual:
      `the "${tag}" checker is a stub — the tag exists so its fixtures could ` +
      'be captured, and no rule has been implemented to grade them yet',
    actualCode: 'checker-unimplemented',
  };
}
