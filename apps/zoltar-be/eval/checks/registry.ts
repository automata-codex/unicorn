import { hashPromptText } from '../../src/wardens/prompt-paths';
import {
  judgedFailureModeTags,
  structuralFailureModeTags,
} from '../fixture.schema';

import { judgeRubrics } from './judged/rubrics';
import { narratingPastABlockGate } from './structural/narrating-past-a-block';

import type { EvalFixture, FailureModeTag } from '../fixture.schema';
import type { TurnExecutionResult } from '../turn-result';
import type { StructuralVerdict } from './structural/types';

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
   * Where this check's `not_applicable` verdicts come from — declared, not
   * inferred, and required so a new check can't quietly omit the answer.
   *
   * - `'fixture'`: from the fixture-authored `applicability[checkId]` entry.
   *   The scenario decides, so the denominator is fixed before the model
   *   runs.
   * - `'artifact'`: from the turn's own output. **This is the hazard label.**
   *   Gating on what the model produced selects on the outcome variable, so
   *   the denominator moves with the behaviour being measured — the exact
   *   bug that made 38 of 40 reps read `not_applicable` across two checks
   *   (see `decisions.md`). Sometimes unavoidable (a check about the shape
   *   of a roll has nothing to gate on until a roll exists), but a rate
   *   built on one should be read alongside its exclusion counts, never
   *   alone.
   * - `'ungated'`: the check reaches pass or fail on every rep and never
   *   reports `not_applicable`, so there is no gate and no selection to
   *   worry about.
   *
   * `'ungated'` rather than `'none'` because an absence-shaped value reads
   * as "not declared yet," which is exactly the ambiguity the required
   * field and its throwing lookup exist to eliminate. And deliberately not
   * `'judged-check'`, which would be a `mode` value on an applicability
   * axis: the two coincide today only by accident, and stop coinciding as
   * soon as `narrating-past-a-block` and `unauditable-mapping` become
   * judged checks that keep an artifact-sourced structural gate.
   */
  applicabilitySource: 'fixture' | 'artifact' | 'ungated';
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
  /**
   * Judged checks only: a structural pre-filter run *before* the judge call.
   * Returns a verdict to settle the rep without asking the model, or `null`
   * to mean "the remaining question is genuinely semantic — go ask."
   *
   * This is how a check spans both modes (`decisions.md`: "A single check
   * may span both"): the structural half answers what structure can answer —
   * deterministically, free, no judge variance — and only the residual
   * reaches the rubric. `mode` stays `'judged'` because that's what
   * `runCheck` dispatches on and what the row records; the gate is an
   * implementation detail of the judged path, not a third mode.
   *
   * A gated verdict sets `judgeInvoked: false` and carries no `rubricHash`,
   * which is what keeps `eval:judge-variance` honest — see
   * `CheckObservation.judgeInvoked`.
   */
  judgeGate?: (
    result: TurnExecutionResult,
    fixture: EvalFixture,
  ) => StructuralVerdict | null;
}

function toCheckId(tag: FailureModeTag): string {
  return tag.toLowerCase();
}

/**
 * The first two checks to read fixture-authored `applicability`
 * (`eval/fixture.schema.ts`) — a fixture below this version never had the
 * field authored, and `runCheck`'s fixture-schema gate (`run-check.ts`)
 * reports `not_applicable` rather than letting the checker guess.
 */
const REQUIRES_FIXTURE_SCHEMA: Partial<Record<string, number>> = {
  'system-rolled-player-action': 2,
  'out-of-order-resolution': 2,
};

/**
 * One entry per check id, hand-declared rather than derived — there is no
 * property of a tag that implies where its applicability comes from, and a
 * default would be a guess at exactly the thing this field exists to state.
 * A check id missing from this map is a hard error at registry build time,
 * so adding a check forces the question to be answered.
 *
 * The two `'fixture'` entries are the checks re-gated onto fixture-authored
 * `applicability`; the `'artifact'` entries gate on the turn's own output
 * and carry the selection hazard named on `EvalCheck.applicabilitySource`;
 * the judged four reach a verdict on every rep and gate on nothing. That
 * last group is `'ungated'`, not "judged" — the overlap with `mode` is
 * coincidental and ends with the first hybrid check.
 */
const APPLICABILITY_SOURCE: Record<string, EvalCheck['applicabilitySource']> = {
  'system-rolled-player-action': 'fixture',
  'out-of-order-resolution': 'fixture',
  'unauditable-mapping': 'artifact',
  // Judged, but with a structural pre-filter that only ever FAILs or
  // falls through — it never reports not_applicable, and the judge
  // reaches a verdict on every rep. See `narrating-past-a-block.ts`
  // for why gating on "is a dice_request pending" would be wrong.
  'narrating-past-a-block': 'ungated',
  'missing-canon-capture': 'artifact',
  'hidden-info-leak': 'ungated',
  'over-resolution': 'ungated',
  'unsurfaced-check': 'ungated',
  'scene-jump': 'ungated',
};

function applicabilitySourceFor(id: string): EvalCheck['applicabilitySource'] {
  const source = APPLICABILITY_SOURCE[id];
  if (!source) {
    throw new Error(
      `check "${id}" has no applicabilitySource declared in registry.ts — ` +
        "state where its not_applicable verdicts come from ('fixture', " +
        "'artifact', or 'ungated') rather than leaving it to be inferred",
    );
  }
  return source;
}

/**
 * Structural pre-filters for judged checks, by check id — see
 * `EvalCheck.judgeGate`. Optional by design: most judged questions have no
 * structural half worth separating out.
 */
const JUDGE_GATES: Partial<Record<string, EvalCheck['judgeGate']>> = {
  'narrating-past-a-block': narratingPastABlockGate,
};

function buildChecks(): Record<string, EvalCheck> {
  const checks: Record<string, EvalCheck> = {};

  for (const tag of structuralFailureModeTags) {
    const id = toCheckId(tag);
    checks[id] = {
      id,
      tag,
      mode: 'structural',
      applicabilitySource: applicabilitySourceFor(id),
      requiresFixtureSchema: REQUIRES_FIXTURE_SCHEMA[id],
    };
  }
  for (const tag of judgedFailureModeTags) {
    const id = toCheckId(tag);
    checks[id] = {
      id,
      tag,
      mode: 'judged',
      applicabilitySource: applicabilitySourceFor(id),
      rubricHash: () => rubricHashFor(id),
      judgeGate: JUDGE_GATES[id],
    };
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
