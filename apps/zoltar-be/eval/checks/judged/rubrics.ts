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
  'UNEXPLAINED-DELTA': {
    template:
      'Every resource pool change this turn carries a `reason` — a short ' +
      'statement of why the number moved. The tool schema requires the ' +
      'field, so it is always present; the question is whether it is true.' +
      '\n\n' +
      'Question: for each pool change listed in the tool-call sequence ' +
      'below, does its `reason` name something that actually happened in ' +
      "this turn's narration or its rolls? Fail if a reason describes an " +
      'event the turn did not contain, attributes damage to a source that ' +
      'was not involved, or restates the mechanical change without saying ' +
      'what caused it ("hp decreased by 4", "stress adjustment"). A ' +
      'plausible-but-wrong reason is worse than a vague one, because it ' +
      'reads as provenance.',
    requiredFacts: [],
  },
  'MISSING-DELTA': {
    template:
      'A turn may narrate a change to the world — a flag flipping, a pool ' +
      'moving, a condition landing — and must carry that change in ' +
      '`stateChanges` for the backend to apply. Narration alone changes ' +
      'nothing: the next turn is built from state, so a change that was ' +
      'described and not emitted is simply lost, and the Warden will later ' +
      'read a world in which it never happened.' +
      '\n\n' +
      'Question: does this turn describe a state change it did not emit? ' +
      'Fail if the narration or the notes assert that something has changed ' +
      '— "the beacon is now active", "she finally admits it", "the flag is ' +
      'flipping now" — with no corresponding entry in the tool call. ' +
      '**A turn that notices its own earlier omission and still does not ' +
      'write the change is the same failure, not an excuse for it.**' +
      '\n\n' +
      'Do not fail a turn for describing something that is *about* to ' +
      'happen, for foreshadowing, or for a change the fiction leaves ' +
      'genuinely ambiguous. The test is whether the turn treats the change ' +
      'as already true.',
    requiredFacts: [],
  },
  'ROLL-RESULT-INVERSION': {
    template:
      'Mothership Stat Checks and Saves are **roll-under**: the roll ' +
      'succeeds when it comes in LOWER than the target, and fails when it ' +
      'is equal or higher. A 90-99 always fails whatever the target. Panic ' +
      'Checks invert this and are the one exception — the Panic Die must ' +
      'come in GREATER than current Stress to avoid the Panic Table.' +
      '\n\n' +
      'Question: does this turn adjudicate any roll backwards? Fail if the ' +
      'narration treats a roll at or above its target as a success, treats ' +
      'a roll under its target as a failure, or applies the Panic Check ' +
      'direction to an ordinary Check or Save (or the reverse).' +
      '\n\n' +
      '**Grade the narration the player was shown, not the notes.** A turn ' +
      'that narrates the inversion and then catches it in its own notes ' +
      'has still shown the player a wrong outcome, and deferring the ' +
      'correction to a later turn does not undo it. Judge what reached the ' +
      'player.' +
      '\n\n' +
      'If the turn contains no roll whose target and outcome are both ' +
      'stated, there is nothing to invert — say so rather than guessing at ' +
      'an implied target.',
    requiredFacts: [],
  },
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
