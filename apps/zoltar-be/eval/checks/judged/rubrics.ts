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
  /**
   * **The boundary scopes the whole question. Disambiguated 2026-08-23**
   * (`rubricHash` `4cf7fda1` → see the bump note), because the previous
   * wording admitted two defensible readings and a tag whose rate depends on
   * which half a grader weights is not measuring the Warden.
   *
   * Found in spec 020's after-side variance run: `turn24-hidden-info-leak`
   * rep 007 split 1 `fail` / 2 `pass` across three trials of one frozen
   * input, and the three rationales did not disagree about the turn — they
   * disagreed about **scope**. The narration disclosed raw roll totals (43,
   * 73) from Alvarez's *own* firefight, which she is present for, while the
   * fixture's boundary named the Lab B / Delta encounter. One trial applied
   * the broad "specific roll values, numeric thresholds, or mechanical
   * outcomes" prohibition and failed; two read it as scoped to the encounter
   * the boundary names, and passed. Each verdict matched its own reasoning,
   * so this was an ambiguity rather than grader noise.
   *
   * **Resolved toward scope, not because it is the softer reading but
   * because the global one contradicts a sibling check.** `UNSURFACED-CHECK`
   * fails a turn that resolves a player-facing roll *silently*, requiring
   * the `dice_request` be surfaced so the player can roll it themselves. If
   * narrating the value of a roll the player is party to were also a leak,
   * the two checks would demand opposite things on the same turn. The
   * numeric phrases were only ever illustrations of what a beyond-boundary
   * leak looks like; they are restored to that role here.
   */
  'HIDDEN-INFO-LEAK': {
    template:
      "The player character's actual perception boundary at this point in " +
      'the story is: {{perceptionBoundary}}\n\n' +
      'Question: does the narration reveal anything to the player that lies ' +
      'beyond that perception boundary? Narrating a vague impression ("you ' +
      'sense danger nearby") is fine; narrating a specific fact the player ' +
      'has no in-story way to know ("the creature has 3 HP left") is a ' +
      'leak. Specific roll values, numeric thresholds and mechanical ' +
      'outcomes are leaks when they concern something beyond the boundary — ' +
      'a roll resolving an encounter the player cannot perceive, or a ' +
      "hidden entity's stat.\n\n" +
      'The boundary scopes this question entirely. Mechanical detail about ' +
      'something the player character is present for is not a leak, however ' +
      'numeric: this system surfaces player-facing rolls to the player by ' +
      'design, so narrating the total of a roll they made, or one resolving ' +
      'an action they are party to, is correct behaviour. Judge only ' +
      'against the boundary.',
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
  'SEEDED-CANON-CONTRADICTION': {
    template:
      'The block under "Scope of this check" below is the seeded ground truth ' +
      'for this adventure — world facts and, where present, the opening ' +
      'narration. Every value in it was in front of the Warden when it wrote ' +
      'this turn, and all of it is verbatim from the fixture rather than ' +
      'summarised.\n\n' +
      "Question: does this turn's narration assert something that contradicts " +
      'a concrete value in that block?\n\n' +
      'A contradiction is a specific, checkable conflict — the narration ' +
      'places somewhere on a different deck than the layout does, puts a ' +
      'person somewhere the roster does not, or dates an event differently ' +
      'from the opening narration. Grade against the seeded values only. Do ' +
      'not import assumptions about how ships are usually arranged or how ' +
      'long things usually take: the Warden was given one specific setting ' +
      'and this check is about whether it stayed inside it.\n\n' +
      'Three things are explicitly NOT violations.\n' +
      '- **A claim whose referent is not in the block.** If the narration ' +
      'places something the seeded values never locate, there is nothing to ' +
      'contradict and nothing to grade. Do not infer the missing value.\n' +
      '- **A relative claim you would have to know a position to check.** ' +
      '"Two decks from here" is only wrong if you know where "here" is, and ' +
      'nothing in the fixture records where the characters are standing. A ' +
      'separate check owns that question. Grade a distance claim only when ' +
      'the seeded values locate BOTH of its endpoints.\n' +
      '- **New detail consistent with the seeded values.** Inventing a ' +
      'corridor, a hatch or a name the world facts do not mention is normal ' +
      'Warden work, not a contradiction.\n\n' +
      'If the narration makes no assertion about any seeded value at all, ' +
      'that is a pass — but say so explicitly in your rationale, in those ' +
      'terms, rather than reporting that you found no contradiction. The two ' +
      'read identically in the score and only your rationale separates them.',
    requiredFacts: [],
  },
  'UNGROUNDED-CONTRACTOR-TARGET': {
    template:
      'Each roll listed under "Scope of this check" below was made by a ' +
      "Contractor NPC — an entity carrying a crew role. Under this system's " +
      "house rules, such a check resolves as that entity's Instinct, plus the " +
      'tier bonus of one of its mapped skills if and only if the check falls ' +
      "within that skill's domain, and Instinct alone otherwise.\n\n" +
      'The scope block gives you, for each roll, every target it could ' +
      'correctly have used — Instinct alone, and Instinct plus each mapped ' +
      "skill's bonus. Those numbers are computed from the entity's own stored " +
      'dice and role. You do not need to know the role table and should not ' +
      'reason about what a role "ought" to include: the mapped skills listed ' +
      "for a roll are that entity's complete set.\n\n" +
      "Question: for each roll in scope, is the target stated in the roll's " +
      '`purpose` the correct one of those supplied numbers, given what the ' +
      'roll is actually for? A target that is none of them is already wrong ' +
      'before the question of which one applies.\n\n' +
      'Three distinct violations, and any one of them fails:\n' +
      "- A listed skill's domain plainly covers what the roll is for, and the " +
      'stated target is Instinct alone — a bonus that was owed went ' +
      'unapplied.\n' +
      "- No listed skill's domain covers what the roll is for, and the stated " +
      'target is above Instinct alone — a bonus was applied that is not ' +
      'owed.\n' +
      '- The stated target is not any of the supplied numbers — neither ' +
      "Instinct alone nor Instinct plus a listed skill's bonus. This one does " +
      'not depend on the domain question at all: whatever the roll is for, a ' +
      "target that matches nothing on the entity's sheet was not derived from " +
      'it. Fail regardless of how reasonable the number looks.\n\n' +
      'Judge domain membership by what the named skill ordinarily covers, not ' +
      'by whether the entity is plausibly competent: a cargo handler may well ' +
      'be clever, but cleverness is not a mapped skill and earns no bonus. ' +
      'Where a reasonable Warden could read the check either way, do not ' +
      'fail it — this check exists to catch a target that plainly does not ' +
      'follow, not to arbitrate close calls.\n\n' +
      'A purpose that states no target at all is NOT a violation here. That ' +
      "is UNAUDITABLE-MAPPING's question, and failing it in both places " +
      'would count one defect twice. Treat it as a pass for this check.',
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
  /**
   * **The boundary is the player character, not the fiction.
   * Disambiguated 2026-08-24** (`rubricHash` `ba1cff52` → see the bump note),
   * for the same reason and by the same argument as `HIDDEN-INFO-LEAK`'s:
   * the previous wording admitted two defensible readings, and one of them
   * contradicted something else in the system.
   *
   * The old template forbade *"beginning a new NPC encounter"* and never said
   * whether an off-screen thread the player can only **hear** counts as one.
   * Narrow reading — an encounter the PC is *in* — passes those turns; broad
   * reading — any encounter beginning anywhere — fails them. Judges split
   * openly on it: 8 of 9 rationales on `f0753f86__14-39-39Z` and 6 of 10 on
   * `e83e8aaa` flagged the boundary as *borderline*, *ambiguous* or
   * *arguably*, in both directions, including passes. The tag read 0.88,
   * 0.22, 0.30 and 0.50 across four runs, two of which used a byte-identical
   * prompt. It was measuring the coin flip, not the Warden.
   *
   * **Resolved narrow, because the broad reading forbids what the
   * architecture requires.** `CLAUDE.md` and `ADR-0101` have every entity
   * named in the prompt every turn, hidden ones included, *"because the
   * Warden needs their stats to run them off-screen."* A rule that fails the
   * Warden for advancing an off-screen thread would prohibit the behaviour
   * the design exists to enable. That is the same shape as
   * `HIDDEN-INFO-LEAK`'s resolution, where the global reading contradicted
   * `UNSURFACED-CHECK`.
   *
   * **Known consequence:** under this reading `turn24-scene-jump` will
   * likely pass at or near 1.00 and stop discriminating — `ADR-0082`'s "a
   * high rate is a blind rubric, not a pass". That is accepted here because
   * an undiscriminating fixture is honest where a coin flip is not, and
   * because the tag needs a second instance from the M7.7 playtest anyway.
   * The instance to capture is the mode `docs/playtest-scenarios.md`
   * describes — the player leaves ambiguously and the Warden skips the
   * transit — which this fixture never tested.
   */
  'SCENE-JUMP': {
    template:
      "This turn's player action justifies the following scope: {{expectedScope}}\n\n" +
      'Question: does the narration move the player character beyond that ' +
      'scope — relocating them to a new location, drawing them into an ' +
      'encounter they did not choose to enter, or resolving a beat of their ' +
      'own story they have not yet acted on? Narrating the immediate, direct ' +
      "consequences of the stated action, at the location where it's taken, " +
      'is fine; advancing the player character to a decision or event beyond ' +
      'it without them choosing that next move is a violation, even if the ' +
      'prose reads as a natural continuation.\n\n' +
      'The boundary is the player character. Events elsewhere in the fiction ' +
      'may advance on their own, and the player character may see, hear or ' +
      'infer that they have — a distant encounter beginning, a threat acting ' +
      'off-screen, a timer running down. The Warden runs those threads, and ' +
      'narrating them moving is correct behaviour rather than a violation, ' +
      'provided the player character is neither relocated into them nor ' +
      'committed to a response on their behalf. Judge whether the player ' +
      'character was moved, not whether the world was.',
    requiredFacts: ['expectedScope'],
  },
  /**
   * **`requiredFacts: []`, deliberately** — the same call `ADR-0104` makes
   * for `SEEDED-CANON-CONTRADICTION` and for the same reason. Both sides of
   * this comparison are captured data (`seededState.precedingCommittedTurn`),
   * so pinning them into `assertion.facts` would move ground truth into the
   * fixture file by hand and commit every fixture carrying this tag to the
   * current fact set. The `judgeContext` renderer selects them instead.
   */
  'UNREVERSED-RETCON': {
    template:
      'A turn may reverse an outcome an earlier turn already narrated — ' +
      're-adjudicating a roll, correcting a rules error, agreeing with a ' +
      'player who says the arithmetic was wrong. That is legitimate work and ' +
      'is not what this check grades.' +
      '\n\n' +
      'What the backend cannot do is reverse itself. State changes are ' +
      'applied as they are emitted, so a stress point, a flag, a wound or a ' +
      'world fact written for an outcome that no longer exists stays in the ' +
      'world, and every later turn is built on top of it. Reversing the ' +
      'narration does not reverse the state; only another state change does.' +
      '\n\n' +
      'The block under "Scope of this check" gives you the preceding turn — ' +
      'the narration the player was shown, what that turn emitted, and what ' +
      "the backend committed from it. This turn's own emissions are in the " +
      'tool-call sequence above.' +
      '\n\n' +
      'Question: does this turn reverse an outcome the preceding turn ' +
      'narrated without undoing what that turn committed for it?' +
      '\n\n' +
      'Fail if the narration re-adjudicates, retracts or replays a prior ' +
      'outcome differently, AND state the preceding turn committed *because ' +
      'of* that outcome is neither reversed nor offset by this turn. Every ' +
      'kind of committed state counts — resource pools, flags, entities, ' +
      'world facts, character state — not only numeric pools.' +
      '\n\n' +
      '**A turn asserting that nothing was committed is not thereby ' +
      'excused.** Check the committed block rather than taking the claim at ' +
      'face value: a reversal written on the belief that the earlier outcome ' +
      'left no trace is the central instance of this failure, not an ' +
      'exception to it.' +
      '\n\n' +
      'Three things are explicitly NOT violations.' +
      '\n' +
      '- **A turn that reverses nothing.** If the narration does not revisit ' +
      'a prior outcome, there is nothing to grade — say so explicitly in ' +
      'your rationale, in those terms, rather than reporting that you found ' +
      'no unreversed state. The two read identically in the score and only ' +
      'your rationale separates them.' +
      '\n' +
      '- **State committed for reasons the reversal leaves intact.** A flag ' +
      'flipped because the scene moved is not owed a reversal because a roll ' +
      'was re-adjudicated. Grade only what was committed for the outcome ' +
      'being reversed.' +
      '\n' +
      '- **An offset rather than a deletion.** A -1 against an earlier +1 ' +
      'undoes it. The test is whether the world ends up where the new ' +
      'fiction says it should, not which mechanism got it there.',
    requiredFacts: [],
  },
};
