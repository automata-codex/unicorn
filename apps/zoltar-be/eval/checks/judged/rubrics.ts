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
  'UNSURFACED-CHECK': {
    template:
      "Question: among this turn's dice_roll events below, does any roll " +
      'function as a check that gates content the player perceives or ' +
      'discovers — a perception, awareness, search, or stealth-style roll ' +
      '— regardless of how its purpose text happens to be phrased? If so, ' +
      'was a corresponding dice_request ever surfaced to the player (the ' +
      "roll's requestId set, or a prior dice_request event), giving them " +
      'the option to roll themselves or ask to "roll for me"? Fail if such ' +
      'a roll was instead resolved silently server-side, with no ' +
      'player-facing notation or choice.',
    requiredFacts: [],
  },
  'UNAUDITABLE-MAPPING': {
    template:
      'Each roll listed under "Scope of this check" below was made by the ' +
      'Warden on its own initiative to decide something — it resolves no ' +
      'player-facing dice_request and no fixed mechanic.\n\n' +
      "Question: for each of those rolls, does the roll's own `purpose` text " +
      'state what the possible results mean, across the range the notation ' +
      'can produce, so that the number rolled could be checked against a ' +
      'stated intent afterwards?\n\n' +
      'A purpose that enumerates outcomes over the range is auditable — ' +
      '"1d6 for what she notices: 1-2 nothing, 3-4 distant movement, 5-6 the ' +
      'contractor" — and so is one that states a threshold ("1d10, 7+ and ' +
      'the panel is unlocked"). It does not need to be exhaustive or evenly ' +
      'divided; it needs to fix the meaning before the die is read.\n\n' +
      'A purpose that names only the subject of the roll — "ambient station ' +
      'event check", "atmosphere roll", "what does she find" — is a ' +
      'violation, because the mapping from number to fiction is left ' +
      'entirely to the Warden after it has seen the number, and nothing ' +
      'about the outcome can be audited. Fail if any roll in scope is of ' +
      'this kind.',
    requiredFacts: [],
  },
  'NARRATING-PAST-A-BLOCK': {
    template:
      'This turn is blocked, or may be blocked, on: {{blockDescription}}\n\n' +
      'Question: does the narration continue past that block — narrating the ' +
      'outcome of the blocked action, or advancing the scene in ways that ' +
      'depend on how the block resolves?\n\n' +
      'Two things are explicitly NOT violations, and both have caused false ' +
      'failures here before. Stating the stakes of a pending roll up front ' +
      '("roll Combat; if you hit, that\'s 10 damage") is correct Warden ' +
      'behaviour — it tells the player what is at stake without deciding it. ' +
      'Narrating what the character is committed to *doing* ("you put two ' +
      'rounds into the doorway") describes the declared action, not its ' +
      'outcome, and is fine so long as whether it worked is left open.\n\n' +
      'A violation is the turn settling what the block was supposed to ' +
      'decide: stating or implying the blocked action succeeded or failed, or ' +
      'moving the scene on to consequences that only make sense once it has. ' +
      'If nothing was actually blocked this turn, that is a pass.',
    requiredFacts: ['blockDescription'],
  },
  'SCENE-JUMP': {
    template:
      "This turn's player action justifies the following scope: {{expectedScope}}\n\n" +
      'Question: does the narration advance the story beyond that scope — ' +
      'relocating the player character to a new location, beginning a new ' +
      'NPC encounter, or resolving subsequent plot beats — that the player ' +
      'did not choose to pursue in their stated action? Narrating the ' +
      'immediate, direct consequences of the stated action, at the ' +
      "location where it's taken, is fine; advancing to a decision or " +
      'event beyond it without the player choosing to make that next move ' +
      'is a violation, even if the prose reads as a natural continuation.',
    requiredFacts: ['expectedScope'],
  },
};
