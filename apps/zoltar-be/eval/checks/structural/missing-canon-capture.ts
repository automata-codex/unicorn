import { getWinningResponseEvent } from '../../turn-result';

import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

interface GmResponsePayload {
  playerText: string;
}

/**
 * MISSING-CANON-CAPTURE is the one structural check that also needs a
 * fixture-supplied fact — the expected new detail the turn's narration is
 * supposed to introduce. Structural fixtures have no `facts` field (that's
 * judged-only, per `evalFixtureSchema`), so the detail is parsed out of the
 * fixture's own `check` text via an `expects: ...` marker rather than
 * inventing a new field. e.g.:
 *   "check": "expects: a new worldFacts entry describing the brig's location"
 */
function parseExpectedNewDetail(check: string): string | null {
  const match = check.match(/expects:\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * A fixture author quoting the literal phrase that should appear if the
 * turn introduces the expected detail — e.g. `expects: ... ("hazard
 * multiplier")` — is this fixture library's authoring convention. Reused
 * here as the signal for whether this turn's live, non-deterministic
 * narration actually introduced the detail at all, distinct from whether it
 * captured it durably. No quoted phrase means this signal is unavailable,
 * not that nothing was introduced — callers must treat `null` as "can't
 * tell," not as a negative result.
 *
 * **The phrase has to be one the fixture pins, not one the model might
 * choose.** That is the lesson of the retirement recorded below: a marker on
 * wording the Warden invents fresh each rep gates on a coin flip, and a
 * marker on wording it reads off its own seeded context does not. Both live
 * fixtures are authored the second way — `hazard multiplier` comes from
 * `gmContextBlob.narrative`, `bridge crew` from the player's own question.
 */
function parseIntroductionMarker(check: string): string | null {
  const match = check.match(/["“]([^"”]+)["”]/);
  return match ? match[1].trim() : null;
}

/**
 * Case, whitespace and dash-shape are not meaningful differences between
 * "the narration used the fixture's phrase" and "it didn't". This is
 * load-bearing rather than defensive: `2c0ba938-turn21` authors its marker
 * as `hazard multiplier` and the seeded context the Warden reads it from
 * writes `hazard-multiplier`, so an exact substring match would miss every
 * rep — a hair-trigger on a character no one would consider load-bearing.
 *
 * This is a narrower kind of matching than the prose classifiers removed
 * from the other checks: the phrase is a fixture-authored constant, not a
 * guess at how a model might word something. It is still a prose dependency
 * and is recorded as one on `checkMissingCanonCapture` below.
 */
function normalizeForMarkerMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―\-:_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * MISSING-CANON-CAPTURE: if the turn's expected narration introduces a new
 * spatial/plot-relevant detail, the response must write it somewhere durable
 * — either a new `campaignState.worldFacts` key, or a new `pending_canon`
 * proposal. Compares against `fixture.seededState.campaignState.worldFacts`
 * (the pre-turn snapshot) since `TurnExecutionResult.campaignState` alone is
 * post-turn only and can't show what's *new* without that baseline.
 *
 * ---
 *
 * **Audit, against both frozen runs.** This check was flagged for review on
 * two grounds: its marker-phrase gate is a prose dependency, and it had
 * produced zero verdicts across 20 reps, so nothing about it had been
 * exercised in practice.
 *
 * Both grounds hold, and the conclusion is not the one the other checks
 * reached.
 *
 * *The verdicts are correct.* All 20 reps report `NOT_APPLICABLE` because
 * the marker never appears — and the narration genuinely never introduces
 * the expected detail. Checked directly rather than assumed: normalising
 * case, whitespace and dash shape finds 0 of 20, and even a loose search for
 * "veridian internal" alone finds 0 of 20. The nearby-looking hits are about
 * Lab C's quarantine access restriction and an unlabeled life-sign ping —
 * different subjects entirely. The prose gate is not producing false
 * exclusions here, which is what separates this case from
 * `NARRATIVE_SELECTION_PATTERN` and its relatives.
 *
 * *The grading logic is nonetheless untested.* The `worldFacts`-diff and
 * `pending_canon` branches — the parts that actually decide pass or fail —
 * have never run against real output, because the turn never gets that far.
 * This fixture contributes zero regression coverage for its tag under either
 * model, and the per-rep `NOT_APPLICABLE` text now says so directly.
 *
 * *Deliberately NOT migrated to judged.* Every other prose-dependent check
 * in this milestone moved to a rubric; this one must not, and the reason is
 * the reason it looked broken. A judge asked "did the narration introduce
 * the detail, and if so was it captured" would answer "it didn't" on all 20
 * reps, and — the judge verdict being binary — return 20 passes. An honest
 * zero denominator would become a spurious 1.00, which is strictly worse
 * than the situation being fixed. `NOT_APPLICABLE` is the correct verdict
 * and only the structural path can express it.
 *
 * *The real defect is in the fixture, not the checker.* `turn02` asks about
 * a detail neither model reproduces, so it can never grade anything. Fixing
 * that means recapturing the fixture against a turn whose narration reliably
 * introduces its detail, or authoring the expectation as something other
 * than a literal phrase — fixture work, tracked separately, not a checker
 * change.
 *
 * ---
 *
 * **Resolved 2026-08-27 (M7.7), and the diagnosis went one level deeper.**
 * By then the archive held 16 runs and 157 reps of this check, every one
 * `NOT_APPLICABLE` — both models, every prompt revision. The audit above
 * treats the marker as the problem; it is a symptom. `turn02` asks whether
 * the Warden captured the station layout, and
 * `worldFacts.station_layout_overview` **already seeds that layout** — hub,
 * four radial modules, habitat ring, ladder shaft, Lab C's quarantine. The
 * player asks for a map and the Warden reads the seeded canon back, which is
 * correct behaviour with nothing new to capture. Re-authoring the marker to
 * a phrase that does appear every rep would therefore have failed the turn
 * for not re-writing a fact that was already durable: a manufactured 0.00
 * traded for an honest zero denominator, which is the same bad trade the
 * judged migration was rejected for above.
 *
 * `turn02` is retired rather than repaired — its source adventure
 * (`18be155e`) no longer exists to recapture from — and replaced by two
 * fixtures from `2c0ba938`, one per direction:
 *
 * - `2c0ba938-turn21-missing-canon-capture` is the fail side. The player's
 *   corrected arithmetic opens the insurance file, and what the file holds
 *   lives in `gmContextBlob.narrative` where the player cannot see it, with
 *   nothing about it in `worldFacts`. Narrating it moves a GM secret into
 *   shared canon and owes a durable write; the original turn wrote a flag
 *   and an `npcState`.
 * - `2c0ba938-turn23-missing-canon-capture` is the pass side, and the reason
 *   it exists is the second half of the audit above: the `worldFacts`-diff
 *   branch had never run against real output in 157 reps. The player asks
 *   who the crew are, five of the six are unnamed in the seeded context, and
 *   the original turn wrote `crew_roster` and `insurance_file_copies`.
 *
 * The `pending_canon` branch is still unexercised. `2c0ba938` proposes canon
 * on no turn at all; the only rows in any source adventure are `5c34991b`
 * seq 14 and seq 34, which is where a fixture for it would have to come from.
 */
export function checkMissingCanonCapture(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): StructuralVerdict {
  if (fixture.assertion.mode !== 'structural') {
    throw new Error(
      `checkMissingCanonCapture called with a non-structural fixture "${fixture.id}"`,
    );
  }
  const expectedNewDetail = parseExpectedNewDetail(fixture.assertion.check);
  if (!expectedNewDetail) {
    throw new Error(
      `fixture "${fixture.id}" (tag MISSING-CANON-CAPTURE) must state the ` +
        'expected new detail in its check text via an "expects: ..." marker, ' +
        'e.g. "expects: a new worldFacts entry for the brig location"',
    );
  }

  const priorWorldFacts =
    (
      fixture.seededState.campaignState as {
        worldFacts?: Record<string, unknown>;
      }
    ).worldFacts ?? {};
  const postWorldFacts =
    (result.campaignState as { worldFacts?: Record<string, unknown> })
      .worldFacts ?? {};
  const newWorldFactKeys = Object.keys(postWorldFacts).filter(
    (key) => !(key in priorWorldFacts),
  );

  if (newWorldFactKeys.length > 0) {
    return {
      outcome: 'PASSED',
      actual: `campaignState.worldFacts gained new key(s): ${newWorldFactKeys.join(', ')}`,
    };
  }

  // The *winning* response, not the first `gm_response`. When a correction
  // fires, `writeTurnEvents` writes it after the original and any canon it
  // proposes carries the correction's sequence number — matching on the
  // original would miss those rows and report a capture that happened as a
  // failure to capture. Every other consumer of this turn's narration
  // already uses `getWinningResponseEvent`; this one had drifted.
  const winningEvent = getWinningResponseEvent(result);
  const newCanon = winningEvent
    ? result.pendingCanon.filter(
        (c) => c.sequenceNumber === winningEvent.sequenceNumber,
      )
    : [];

  if (newCanon.length > 0) {
    return {
      outcome: 'PASSED',
      actual: `${newCanon.length} new pending_canon row(s) proposed this turn (sequence ${winningEvent!.sequenceNumber}): ${newCanon.map((c) => c.summary).join('; ')}`,
    };
  }

  const introductionMarker = parseIntroductionMarker(fixture.assertion.check);
  if (introductionMarker) {
    const winningResponse = getWinningResponseEvent(result);
    const playerText = winningResponse
      ? ((winningResponse.payload as GmResponsePayload).playerText ?? '')
      : '';
    if (
      !normalizeForMarkerMatch(playerText).includes(
        normalizeForMarkerMatch(introductionMarker),
      )
    ) {
      return {
        outcome: 'NOT_APPLICABLE',
        actual:
          `expected new detail's marker phrase ("${introductionMarker}") never appears in ` +
          "this turn's playerText — the narration didn't introduce the detail this run, so " +
          'there was nothing to capture. This fixture contributed no regression coverage ' +
          'for MISSING-CANON-CAPTURE on this rep',
        actualCode:
          'narration did not introduce the expected detail — no coverage this rep',
      };
    }
  }

  return {
    outcome: 'FAILED',
    actual:
      `expected new detail ("${expectedNewDetail}") but campaignState.worldFacts ` +
      'is unchanged and no new pending_canon row was proposed this turn',
  };
}
