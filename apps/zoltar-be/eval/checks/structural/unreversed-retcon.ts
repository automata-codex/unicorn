import { getWinningResponseEvent } from '../../turn-result';

import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

/**
 * The preceding committed turn, as this check needs to show it to a judge:
 * what the Warden emitted, what the backend committed, and the narration the
 * player was shown before this turn.
 */
export interface PrecedingCommit {
  sequenceNumber: number;
  stateChanges: Record<string, unknown> | null;
  applied: Record<string, unknown>;
  /**
   * The most recent `gm` message in the seeded window.
   *
   * **Not guaranteed to be the same turn as the deltas**, and the renderer
   * says so rather than asserting a pairing it cannot verify.
   * `precedingCommittedTurn` skips back past any turn that committed nothing
   * (see its capture doc comment), while `messages` carries every narration
   * regardless. The two coincide on every fixture captured so far and would
   * diverge on an adventure with an uncommitted turn in between.
   */
  narration: string | null;
}

/**
 * Whether a `stateChanges` block committed anything at all.
 *
 * `gmPayloadFor` persists `r.stateChanges ?? null`, so a turn that changed
 * nothing writes `null` — but a turn can also write `{"flags": {}}`, which
 * parses as an object and commits nothing. Both are "nothing for a reversal
 * to leave standing", and treating only the first as empty would send the
 * second to a paid judge call with an empty scope block.
 */
function committedSomething(
  stateChanges: Record<string, unknown> | null,
): boolean {
  if (!stateChanges) return false;
  return Object.values(stateChanges).some((value) => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return true;
  });
}

export function precedingCommitFor(
  fixture: EvalFixture,
): PrecedingCommit | null {
  const preceding = fixture.seededState.precedingCommittedTurn;
  if (!preceding) return null;

  let narration: string | null = null;
  for (const message of fixture.seededState.messages) {
    const row = message as { role?: unknown; content?: unknown };
    if (row.role === 'gm' && typeof row.content === 'string') {
      narration = row.content;
    }
  }

  return {
    sequenceNumber: preceding.sequenceNumber,
    stateChanges: preceding.stateChanges,
    applied: preceding.applied,
    narration,
  };
}

/**
 * `UNREVERSED-RETCON`'s structural pre-filter. Settles the exclusions
 * structure can settle; whether this turn actually reverses what the
 * preceding one narrated is the rubric's question.
 *
 * **What this gate deliberately does not decide**, for the same reason
 * `seededCanonContradictionGate` cannot: a judged check has no route to
 * `not_applicable` except through this function, and deciding whether a
 * narration reverses a prior outcome means reading the narration. A turn that
 * reverses nothing therefore scores as a pass, and the rubric requires the
 * judge to say so in those terms so the artifacts stay separable.
 *
 * The two exclusions below are both fixture-shaped rather than
 * Warden-shaped — they depend on what was captured, not on what the model
 * chose — with the exception of the no-`gm_response` branch, which is a turn
 * that did not happen. That mix is why the check is declared `'artifact'` in
 * the registry under the weakest-link rule: `'ungated'` would assert a
 * `not_applicable` is impossible, and it is not.
 */
export function unreversedRetconGate(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): StructuralVerdict | null {
  if (!getWinningResponseEvent(result)) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'no gm_response or correction event this turn — the Warden narrated nothing, ' +
        'so there is no reversal to grade',
      actualCode: 'no gm_response event this turn',
    };
  }

  const preceding = precedingCommitFor(fixture);
  if (!preceding) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'this fixture captures no preceding committed turn, so there is no earlier ' +
        'outcome to reverse and no committed state a reversal could leave standing. ' +
        'A fixture-shaped exclusion rather than a Warden-shaped one: it will report ' +
        'this on every rep',
      actualCode: 'fixture captures no preceding committed turn',
    };
  }

  if (!committedSomething(preceding.stateChanges)) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        `the preceding turn (sequence ${preceding.sequenceNumber}) committed no state, ` +
        'so a reversal of it has nothing to leave standing. A fixture-shaped ' +
        'exclusion rather than a Warden-shaped one: it will report this on every rep',
      actualCode: 'preceding turn committed no state',
    };
  }

  return null;
}

/**
 * Deterministic JSON, keys sorted at every level.
 *
 * Sorted rather than left in capture order for the reason
 * `seededCanonContradictionJudgeContext` sorts its `worldFacts` keys: the
 * rendered text is a judge-visible surface, and two captures of the same
 * adventure must produce the same one. `JSON.stringify` would otherwise
 * preserve whatever key order the jsonb round-trip happened to yield.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

/** `applied` with its empty top-level sections dropped. */
function nonEmptyApplied(applied: Record<string, unknown>): unknown {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(applied)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      !Array.isArray(value) &&
      typeof value === 'object' &&
      Object.keys(value as Record<string, unknown>).length === 0
    ) {
      continue;
    }
    kept[key] = value;
  }
  return kept;
}

/**
 * The preceding committed turn, rendered for the judge prompt.
 *
 * **This exists because the judge is otherwise blind to it.** `runJudgeCall`
 * assembles the rubric, *this* turn's `playerText`, a dump of *this* turn's
 * events, and this block. Everything before the turn under grading — the
 * narration being reversed, the deltas it committed — is outside that window
 * entirely, and a rubric asking "did this turn undo what the last one
 * committed" without supplying what the last one committed is asking the model
 * to invent it.
 *
 * **Selection, not authorship** (`ADR-0105`'s corollary). Every value here
 * comes verbatim from `fixture.seededState`, which `corpusVersion` hashes:
 * the emitted deltas with their `reason` text, the committed values, and the
 * prior narration. Nothing is computed — in particular the *prior value* of a
 * changed pool is left as the difference between the two blocks rather than
 * being worked out here and asserted, because an arithmetic slip in this
 * renderer would reach the judge as ground truth carrying no identity.
 *
 * The three-section shape mirrors what the check has to compare: what the
 * fiction said, what the Warden emitted for it, and what the backend actually
 * holds.
 */
export function unreversedRetconJudgeContext(
  _result: TurnExecutionResult,
  fixture: EvalFixture,
): string {
  const preceding = precedingCommitFor(fixture);
  if (!preceding) {
    // Unreachable through `runCheck` — the gate settles this case before the
    // judge is reached — but a renderer that returned a misleading block here
    // would be worse than one that says it has nothing.
    return 'This fixture captures no preceding committed turn.';
  }

  const sections: string[] = [
    'The turn immediately before this one, verbatim from the fixture. This is ' +
      'what the player had already been shown, and what the backend had already ' +
      'committed, when the turn you are grading was written.',
  ];

  if (preceding.narration) {
    sections.push(
      '--- the narration the player was shown before this turn ---\n' +
        preceding.narration,
    );
  }

  sections.push(
    `--- what that turn emitted (gm_response at sequence ${preceding.sequenceNumber}) ---\n` +
      stableJson(preceding.stateChanges),
  );

  sections.push(
    '--- what the backend committed from it (resulting values) ---\n' +
      stableJson(nonEmptyApplied(preceding.applied)),
  );

  return sections.join('\n\n');
}
