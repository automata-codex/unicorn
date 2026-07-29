import { hashPromptText } from '../../src/wardens/prompt-paths';
import {
  judgedFailureModeTags,
  structuralFailureModeTags,
} from '../fixture.schema';

import { judgeRubrics } from './judged/rubrics';

import type { EvalFixture, FailureModeTag } from '../fixture.schema';

export interface EvalCheck {
  /**
   * The failure-mode tag in lower-kebab, e.g. `'out-of-order-resolution'`.
   * Deliberately does NOT encode `mode` — `UNSURFACED-CHECK` has already
   * migrated structural → judged once in this repo, after a real-run false
   * pass, and `eval:compare` pairs history on `(fixtureId, checkId)`. If the
   * id encoded mode, that migration would silently un-pair every historical
   * comparison for the check.
   */
  id: string;
  tag: FailureModeTag;
  mode: 'structural' | 'judged';
  /**
   * Minimum `fixtureSchemaVersion` this check needs. Nothing declares this
   * today — every check works against v1 fixtures — but the field exists so
   * the first schema-dependent check (anticipated: `rollType` /
   * `gatedByRollId` / `actingEntityId` on `roll_dice`) doesn't produce a
   * wall of false regressions across the existing corpus. Enforced by
   * `runCheck`'s fixture-schema gate.
   */
  requiresFixtureSchema?: number;
  /**
   * Dotted paths into the fixture that must be present. Reserved for the
   * same purpose as `requiresFixtureSchema` when a version bump alone
   * doesn't pin down what's required; not yet consumed by `runCheck` since
   * no check declares it.
   */
  requiredFixtureFields?: string[];
  /** Judged checks only: SHA-256 (8 hex chars) of the rubric template text. */
  rubricHash?: () => string;
}

function toCheckId(tag: FailureModeTag): string {
  return tag.toLowerCase();
}

function buildChecks(): Record<string, EvalCheck> {
  const checks: Record<string, EvalCheck> = {};

  for (const tag of structuralFailureModeTags) {
    const id = toCheckId(tag);
    checks[id] = { id, tag, mode: 'structural' };
  }
  for (const tag of judgedFailureModeTags) {
    const id = toCheckId(tag);
    checks[id] = { id, tag, mode: 'judged', rubricHash: () => rubricHashFor(id) };
  }

  return checks;
}

/**
 * One entry per tag, built from `structuralFailureModeTags` +
 * `judgedFailureModeTags` so those two lists stay the single source of
 * truth for mode.
 */
export const evalChecks: Record<string, EvalCheck> = buildChecks();

/**
 * Today, the one check whose `tag` matches the fixture's — a judged check
 * needs per-fixture `assertion.facts` (`perceptionBoundary`,
 * `expectedScope`, ...) that only exist for the fixture's own tag, so
 * running e.g. `HIDDEN-INFO-LEAK` against a `SCENE-JUMP` fixture has no
 * boundary text to grade against. Returns an array (not a single check) so
 * the row format and every reader are already N-checks-per-fixture-ready;
 * the corpus is what's 1:1 today, not the format.
 */
export function selectChecksForFixture(fixture: EvalFixture): EvalCheck[] {
  const check = evalChecks[toCheckId(fixture.tag)];
  return check ? [check] : [];
}

/**
 * The rubric template text for a judged check — the fact-uninterpolated
 * question, written verbatim to `rubrics/<hash>.txt`.
 */
export function rubricTextFor(checkId: string): string {
  const check = evalChecks[checkId];
  if (!check || check.mode !== 'judged') {
    throw new Error(`"${checkId}" is not a registered judged check`);
  }
  const rubric = judgeRubrics[check.tag as keyof typeof judgeRubrics];
  if (!rubric) {
    throw new Error(`no rubric registered for judged check "${checkId}"`);
  }
  return rubric.template;
}

/**
 * SHA-256 of the rubric **template** (not the fact-interpolated text), 8
 * hex chars — matching `hashPromptText`'s convention. The template, not the
 * interpolated text: the spec keys `rubrics/<rubricHash8>.txt` and
 * `manifest.completedReps[].rubricHashes` by `checkId`, so one hash per
 * rubric, deduped across every fixture that uses it.
 */
export function rubricHashFor(checkId: string): string {
  return hashPromptText(rubricTextFor(checkId));
}
