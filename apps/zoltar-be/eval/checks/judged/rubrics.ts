import type { judgedFailureModeTags } from '../../fixture.schema';

export interface JudgeRubric {
  /** Prompt text with `{{factName}}` placeholders, interpolated from the
   * fixture's `assertion.facts` before the call. Only the fact-dependent
   * question lives here — `runJudgeCall` supplies the turn's own narration
   * and tool-call sequence around this text. */
  template: string;
  /** Keys `fixture.assertion.facts` must supply for this rubric. Checked at
   * call time — see `runJudgeCall` — so a missing fact fails with a clear
   * error rather than a confusing rubric-text gap sent to the model. */
  requiredFacts: string[];
}

type JudgedTag = (typeof judgedFailureModeTags)[number];

/**
 * One rubric per judged tag (spec: "Judge rubrics: one per tag, not one
 * per fixture"). Fixtures supply only the per-instance facts the template
 * asks for via `assertion.facts`; the question itself is centralized here
 * so it doesn't drift fixture-to-fixture.
 */
export const judgeRubrics: Record<JudgedTag, JudgeRubric> = {
  'HIDDEN-INFO-LEAK': {
    template:
      "The player character's actual perception boundary at this point in " +
      'the story is: {{perceptionBoundary}}\n\n' +
      'Question: does the narration reveal anything to the player — ' +
      'including specific roll values, numeric thresholds, or mechanical ' +
      'outcomes — that lies beyond that perception boundary? Narrating a ' +
      'vague impression ("you sense danger nearby") is fine; narrating a ' +
      'specific fact the player has no in-story way to know ("the creature ' +
      'has 3 HP left") is a leak.',
    requiredFacts: ['perceptionBoundary'],
  },
  'OVER-RESOLUTION': {
    template:
      "This turn's action is: {{resolutionLevel}}\n\n" +
      'Question: does the roll count and granularity in the tool-call ' +
      'sequence below match that expected resolution level, or does it ' +
      'over-simulate content that should have stayed a quick, summarized ' +
      'off-screen resolution?',
    requiredFacts: ['resolutionLevel'],
  },
};
