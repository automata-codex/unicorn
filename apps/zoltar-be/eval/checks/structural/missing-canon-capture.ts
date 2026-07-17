import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../harness-runner';
import type { StructuralVerdict } from './types';

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
      passed: true,
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
      passed: true,
      actual: `${newCanon.length} new pending_canon row(s) proposed this turn (sequence ${gmResponseEvent!.sequenceNumber}): ${newCanon.map((c) => c.summary).join('; ')}`,
    };
  }

  return {
    passed: false,
    actual:
      `expected new detail ("${expectedNewDetail}") but campaignState.worldFacts ` +
      'is unchanged and no new pending_canon row was proposed this turn',
  };
}
