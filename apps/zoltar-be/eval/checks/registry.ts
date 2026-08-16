import { hashPromptText } from '../../src/wardens/prompt-paths';
import {
  judgedFailureModeTags,
  structuralFailureModeTags,
} from '../fixture.schema';

import { judgeRubrics } from './judged/rubrics';
import { narratingPastABlockGate } from './structural/narrating-past-a-block';
import {
  unauditableMappingGate,
  unauditableMappingJudgeContext,
} from './structural/unauditable-mapping';

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
   * Whether this check can run against a fixture whose `tag` is something
   * else, on the strength of a fixture-authored `applicability[checkId]`
   * entry alone — see `selectChecksForFixture`.
   *
   * The load-bearing property is **what the checker reads**, which is a fact
   * about checker code and derivable from nothing else on this interface:
   *
   * - A tag-independent check reads `applicability[checkId]` and the turn
   *   output, and nothing from `fixture.tag` or `fixture.assertion`.
   * - Every other check reads the fixture's own assertion, which only exists
   *   for the fixture's own tag — a judged check needs `assertion.facts`
   *   (`perceptionBoundary`, `expectedScope`, ...), and
   *   `missing-canon-capture` parses `assertion.check` prose. Attaching one
   *   of those to a foreign fixture grades against a boundary text that
   *   describes a different question, or against no text at all.
   *
   * Hand-declared for the same reason `applicabilitySource` is: there is no
   * property of a tag that implies it, and a default would be a guess at
   * exactly the thing the field records.
   *
   * **Why the corpus needs this at all.** `system-rolled-player-action` read
   * 1.00 (20/20) on the `c45a142a` re-baseline while the Warden rolled the
   * player's declared action six times *in that same run* — every occurrence
   * on a `turn24-*` fixture, none of which the check was pointed at, because
   * selection was 1:1 with `tag`. The behaviour was in the artifacts and the
   * checker was not looking. See `docs/rules-extraction-findings.md § S34`.
   */
  tagIndependent?: boolean;
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
  /**
   * Judged checks only: extra prompt text appended to the judge call,
   * typically the subset of events the `judgeGate` already identified as
   * this check's subject.
   *
   * The alternative is a rubric that describes the structural filter in
   * words and asks the model to apply it — a second implementation of the
   * same rule, free to drift from the first, in a check whose entire reason
   * for being rebuilt was that prose descriptions of roll classification
   * don't hold. One implementation selects; the judge grades what it hands
   * over.
   */
  judgeContext?: (result: TurnExecutionResult, fixture: EvalFixture) => string;
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
 * `system-rolled-player-action` is the one check re-gated purely onto
 * fixture-authored `applicability`; the `'artifact'` entries gate on the
 * turn's own output and carry the selection hazard named on
 * `EvalCheck.applicabilitySource`; the judged four reach a verdict on every
 * rep and gate on nothing. That last group is `'ungated'`, not "judged" —
 * the overlap with `mode` is coincidental and ends with the first hybrid
 * check.
 *
 * **`out-of-order-resolution` is the first hybrid, and it is declared by its
 * weakest link.** It gates on fixture-authored `applicability` *first*, then
 * on the artifact: a turn that leaves no pending `dice_request` and whose
 * rolls declare no `gatedByRollId` has no ordering to adjudicate, and that is
 * a fact about what the Warden did. This entry read `'fixture'` until the
 * 2026-08-09 re-baseline, which was always wrong — the pre-`gatedByRollId`
 * path was artifact-gated too — but it went unnoticed because every rep of
 * every frozen run happened to leave a gate pending. The first run that
 * didn't tripped the report's own "fixture-gated but applicability is 0.70"
 * defect line. Where a check gates on both, declare `'artifact'`: `'fixture'`
 * asserts every rep must agree, and a single artifact-dependent branch makes
 * that false.
 */
const APPLICABILITY_SOURCE: Record<string, EvalCheck['applicabilitySource']> = {
  'system-rolled-player-action': 'fixture',
  'out-of-order-resolution': 'artifact',
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
  // Artifact-gated, and the hazard label applies: a turn that changed no
  // pools has no reason to grade, so the denominator moves with how often
  // the Warden writes state at all. Read alongside its exclusion count.
  'unexplained-delta': 'artifact',
  // Artifact-gated for the same reason and more sharply — a wounds chain is
  // rare, so most reps will be `not_applicable`. That is the honest shape:
  // the check exists to catch a specific arithmetic error, not to produce a
  // rate.
  'carryover-arithmetic': 'artifact',
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
 * Check ids that may be attached to a fixture tagged something else — see
 * `EvalCheck.tagIndependent`.
 *
 * One entry today, and it is the check that was *already* re-gated purely
 * onto fixture-authored `applicability`: everything
 * `system-rolled-player-action` needs about the scenario (does it apply, and
 * who is the player) is stated in `applicability['system-rolled-player-
 * action']`, and everything else it reads comes from the turn output. That
 * re-gating is what makes it portable; the other structural checks are not
 * on this list because they are not portable, not because nobody got to them
 * yet.
 *
 * Deliberately not derived from `applicabilitySource === 'fixture'`. The two
 * coincide today, and they are answering different questions — one is "where
 * do this check's `not_applicable` verdicts come from", the other is "does
 * this check read the fixture's assertion". `out-of-order-resolution` is the
 * case that separates them: it is `'artifact'` because it has an
 * artifact-dependent branch, yet it reads no assertion at all and would be
 * portable on the merits. Adding it here is a corpus decision (which
 * fixtures should carry it) rather than a registry one, and it is not made
 * here.
 */
const TAG_INDEPENDENT_CHECK_IDS: ReadonlySet<string> = new Set([
  'system-rolled-player-action',
]);

/**
 * Structural pre-filters for judged checks, by check id — see
 * `EvalCheck.judgeGate`. Optional by design: most judged questions have no
 * structural half worth separating out.
 */
const JUDGE_GATES: Partial<Record<string, EvalCheck['judgeGate']>> = {
  'narrating-past-a-block': narratingPastABlockGate,
  'unauditable-mapping': unauditableMappingGate,
};

/** Extra judge-prompt context by check id — see `EvalCheck.judgeContext`. */
const JUDGE_CONTEXTS: Partial<Record<string, EvalCheck['judgeContext']>> = {
  'unauditable-mapping': unauditableMappingJudgeContext,
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
      tagIndependent: TAG_INDEPENDENT_CHECK_IDS.has(id) || undefined,
      requiresFixtureSchema: REQUIRES_FIXTURE_SCHEMA[id],
    };
  }
  for (const tag of judgedFailureModeTags) {
    const id = toCheckId(tag);
    // No `tagIndependent` here, and the guard below says why rather than
    // leaving the omission to be read as an oversight.
    if (TAG_INDEPENDENT_CHECK_IDS.has(id)) {
      throw new Error(
        `check "${id}" is listed as tag-independent but is a judged check — ` +
          'a judge call grades against `assertion.facts`, which only exists ' +
          "for the fixture's own tag, so attaching it to a foreign fixture " +
          "would grade one question against another question's boundary text",
      );
    }
    checks[id] = {
      id,
      tag,
      mode: 'judged',
      applicabilitySource: applicabilitySourceFor(id),
      rubricHash: () => rubricHashFor(id),
      judgeGate: JUDGE_GATES[id],
      judgeContext: JUDGE_CONTEXTS[id],
    };
  }

  for (const id of TAG_INDEPENDENT_CHECK_IDS) {
    if (!checks[id]) {
      throw new Error(
        `"${id}" is listed in TAG_INDEPENDENT_CHECK_IDS but is not a ` +
          'registered check — a typo here fails silently at selection time, ' +
          'which is the coverage hole this list exists to close',
      );
    }
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
 * The check matching the fixture's `tag`, plus every **tag-independent**
 * check the fixture authors an `applicability` entry for.
 *
 * The tag check comes first; the rest follow in check-id order so two runs
 * of the same corpus emit rows in the same sequence and diff cleanly.
 *
 * **Selection is by `applicability`, not by tag, for the second group, and
 * that is the point.** A fixture's `tag` records the failure mode it was
 * *captured* to reproduce. It says nothing about which other failure modes
 * its turn is capable of provoking, and a check pointed only at fixtures
 * named after it measures its own corpus rather than the Warden — which is
 * precisely how `system-rolled-player-action` reported 20/20 on a run
 * containing six violations of it (`docs/rules-extraction-findings.md
 * § S34`). Attaching a check is therefore a fixture-authoring act: the
 * author states that the scenario calls for it and names the player entity,
 * and selection follows that declaration.
 *
 * A judged check stays 1:1 with `tag` regardless — it grades against
 * `assertion.facts` (`perceptionBoundary`, `expectedScope`, ...), which only
 * exists for the fixture's own tag, so running `HIDDEN-INFO-LEAK` against a
 * `SCENE-JUMP` fixture has no boundary text to grade against.
 *
 * An `applicability` key naming an unregistered or non-tag-independent check
 * throws rather than being skipped. Silently ignoring it would mean a
 * fixture edit intended to close a coverage hole opens no rows at all and
 * reports nothing — the same shape of failure as the hole itself, arriving
 * through a typo.
 */
export function selectChecksForFixture(fixture: EvalFixture): EvalCheck[] {
  const tagCheck = evalChecks[toCheckId(fixture.tag)];
  const selected = tagCheck ? [tagCheck] : [];

  for (const checkId of Object.keys(fixture.applicability ?? {}).sort()) {
    if (checkId === tagCheck?.id) continue;

    const check = evalChecks[checkId];
    if (!check) {
      throw new Error(
        `fixture "${fixture.id}" declares applicability for "${checkId}", ` +
          'which is not a registered check — check the spelling against ' +
          "`evalChecks`' ids (lower-kebab of the tag)",
      );
    }
    if (!check.tagIndependent) {
      throw new Error(
        `fixture "${fixture.id}" (tag ${fixture.tag}) declares applicability ` +
          `for "${checkId}", which is not tag-independent — that check reads ` +
          "the fixture's own `assertion`, so it can only run on a fixture " +
          'tagged for it. Either capture a fixture tagged ' +
          `${check.tag}, or make the check tag-independent if it genuinely ` +
          'reads no assertion (see `EvalCheck.tagIndependent`)',
      );
    }
    selected.push(check);
  }

  return selected;
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
