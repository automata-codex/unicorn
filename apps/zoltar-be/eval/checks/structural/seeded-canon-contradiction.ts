import { getWinningResponseEvent } from '../../turn-result';

import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

/**
 * The seeded values a narration could contradict: every `worldFacts` entry,
 * plus the opening narration.
 *
 * Both, not just `worldFacts`, because `ADR-0104` attests two kinds of
 * referent. The layout contradictions (turns 8, 14, 18) are against
 * `worldFacts.ship_layout`; the timeline contradiction at turn 1 is against
 * the seeded opening narration, which places the mid-deck lighting failure
 * "two nights ago" where the turn says "since day four". A gate reading only
 * `worldFacts` would exclude the timeline subtype as having nothing to
 * contradict, which is exactly wrong.
 */
interface SeededCanon {
  worldFacts: Record<string, string>;
  openingNarration: string | null;
}

export function seededCanonFor(fixture: EvalFixture): SeededCanon {
  const state = fixture.seededState.campaignState as { worldFacts?: unknown };
  const raw = state.worldFacts;

  const worldFacts: Record<string, string> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) {
        worldFacts[key] = value;
      }
    }
  }

  const blob = fixture.seededState.gmContextBlob as {
    openingNarration?: unknown;
  };
  const openingNarration =
    typeof blob.openingNarration === 'string' && blob.openingNarration.length > 0
      ? blob.openingNarration
      : null;

  return { worldFacts, openingNarration };
}

/**
 * SEEDED-CANON-CONTRADICTION's structural pre-filter. Settles the two
 * exclusions structure can settle; whether the narration actually asserts
 * something against the seeded values is the rubric's.
 *
 * **What this gate deliberately does not decide.** `ADR-0104` specifies that
 * "a response making no such claim is `not_applicable`, not a pass," and this
 * gate cannot deliver that. Deciding whether a narration makes a claim about
 * a seeded value means reading the narration, and `decisions.md` bars a
 * structural check from classifying prose — the same rule that sends the rest
 * of this check to a judge. Nor can the judge deliver it: `judge_verdict` is
 * `{rationale, passed}` and `runCheck` maps it `passed ? 'pass' : 'fail'`, so
 * a judged check has no route to `not_applicable` except through this
 * function. A turn that mentions nothing seeded therefore scores as a pass,
 * and the rubric requires the judge to say so in its rationale so the two are
 * at least distinguishable in the artifacts.
 *
 * Closing that properly means a third outcome on `judge_verdict`, which
 * `serializeJudgeContract` hashes — moving `judgeContractHash` for every
 * judged tag and ending comparability with every frozen run. That is a
 * decision about the judge contract, not about this check.
 */
export function seededCanonContradictionGate(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): StructuralVerdict | null {
  if (!getWinningResponseEvent(result)) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'no gm_response or correction event this turn — the Warden narrated nothing, ' +
        'so there is no assertion to compare against seeded state',
      actualCode: 'no gm_response event this turn',
    };
  }

  const canon = seededCanonFor(fixture);
  if (Object.keys(canon.worldFacts).length === 0 && !canon.openingNarration) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'this fixture seeds no worldFacts entries and no opening narration, so it ' +
        'carries no concrete value a narration could contradict. A fixture-shaped ' +
        'exclusion rather than a Warden-shaped one: it will report this on every rep',
      actualCode: 'fixture seeds no worldFacts and no opening narration',
    };
  }

  return null;
}

/**
 * The seeded canon, rendered for the judge prompt.
 *
 * **This exists because the judge is otherwise blind to it.** `runJudgeCall`
 * assembles the rubric, the winning response's `playerText`, a summary of the
 * turn's `gameEvents`, and this block — no `seededState`, no `campaignState`.
 * And `summarizeGameEvents` shows only what the turn *wrote*, so a seeded
 * value the turn never touched appears nowhere at all. A rubric asking "does
 * this contradict the ship layout" without supplying the layout is asking the
 * model to invent one.
 *
 * **Selection, not authorship** (`ADR-0105`'s corollary). Every character
 * rendered here comes verbatim from `fixture.seededState`, which
 * `corpusVersion` hashes, so the injected *data* carries an identity and only
 * this renderer's behaviour needs the committed golden. Paraphrasing or
 * summarising the values would move ground truth into a surface nothing
 * hashes — and would let a summary drift from what the Warden was actually
 * shown, which is the one thing this check compares against.
 */
export function seededCanonContradictionJudgeContext(
  _result: TurnExecutionResult,
  fixture: EvalFixture,
): string {
  const canon = seededCanonFor(fixture);
  const sections: string[] = [
    'The seeded ground truth for this adventure, verbatim from the fixture. The ' +
      'Warden had all of it in front of it when it wrote this turn. Grade the ' +
      'narration against these values and nothing else — do not import assumptions ' +
      'about how ships are usually laid out.',
  ];

  const keys = Object.keys(canon.worldFacts).sort();
  if (keys.length > 0) {
    sections.push(
      '--- world facts ---\n' +
        keys.map((key) => `${key}: ${canon.worldFacts[key]}`).join('\n\n'),
    );
  }

  if (canon.openingNarration) {
    sections.push(`--- opening narration ---\n${canon.openingNarration}`);
  }

  return sections.join('\n\n');
}
