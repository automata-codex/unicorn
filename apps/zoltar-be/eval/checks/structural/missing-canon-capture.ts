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
 * turn introduces the expected detail — e.g. `expects: ... ("RESTRICTED —
 * VERIDIAN INTERNAL")` — is already this fixture library's natural
 * authoring convention (see `turn02-missing-canon-capture.json`). Reused
 * here as the signal for whether this turn's live, non-deterministic
 * narration actually introduced the detail at all, distinct from whether it
 * captured it durably. No quoted phrase means this signal is unavailable,
 * not that nothing was introduced — callers must treat `null` as "can't
 * tell," not as a negative result.
 */
function parseIntroductionMarker(check: string): string | null {
  const match = check.match(/["“]([^"”]+)["”]/);
  return match ? match[1].trim() : null;
}

/**
 * MISSING-CANON-CAPTURE: if the turn's expected narration introduces a new
 * spatial/plot-relevant detail, the response must write it somewhere durable
 * — either a new `campaignState.worldFacts` key, or a new `pending_canon`
 * proposal. Compares against `fixture.seededState.campaignState.worldFacts`
 * (the pre-turn snapshot) since `TurnExecutionResult.campaignState` alone is
 * post-turn only and can't show what's *new* without that baseline.
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

  const gmResponseEvent = result.gameEvents.find(
    (e) => e.eventType === 'gm_response',
  );
  const newCanon = gmResponseEvent
    ? result.pendingCanon.filter(
        (c) => c.sequenceNumber === gmResponseEvent.sequenceNumber,
      )
    : [];

  if (newCanon.length > 0) {
    return {
      outcome: 'PASSED',
      actual: `${newCanon.length} new pending_canon row(s) proposed this turn (sequence ${gmResponseEvent!.sequenceNumber}): ${newCanon.map((c) => c.summary).join('; ')}`,
    };
  }

  const introductionMarker = parseIntroductionMarker(fixture.assertion.check);
  if (introductionMarker) {
    const winningResponse = getWinningResponseEvent(result);
    const playerText = winningResponse
      ? ((winningResponse.payload as GmResponsePayload).playerText ?? '')
      : '';
    if (!playerText.toLowerCase().includes(introductionMarker.toLowerCase())) {
      return {
        outcome: 'NOT_APPLICABLE',
        actual:
          `expected new detail's marker phrase ("${introductionMarker}") never appears in ` +
          "this turn's playerText — the narration didn't introduce the detail this run, so " +
          'there was nothing to capture',
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
