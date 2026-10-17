# Playtest Scenarios

A checklist of specific situations worth deliberately steering toward during
manual Zoltar playtests — not just playing naturally, but probing moments
known to have tripped up the Warden before, so a suspected recurring failure
mode gets confirmed (or ruled out) faster than waiting for it to come up
organically. Findings here feed the same taxonomy-report process M7.1/M7.4
already use — a scenario that reproduces gets logged, tagged, and eventually
becomes (or reinforces) an eval fixture.

Each entry: what to do, what to watch for, and where it came from. Entries added
for a capture-driven playtest also carry **Capture:** — the roadmap bullet the
turn would close if it reproduces.

---

## Hypothetical/planning questions before commitment

Ask the Warden a "what if I did X" question without committing to X — e.g.
"how exposed would I be if I charged the door?", "what happens if I open
this hatch?" — phrased as planning or reconnaissance, not as a declared
action.

**Watch for:** does the response pre-roll or disclose a specific
consequence roll, threshold, or numeric outcome before the player has
actually committed to the action? A correct response gives
difficulty/exposure framing only ("that's a real risk," "you'd be exposed
for a couple of seconds") — never a specific roll value or threshold —
since neither the character nor the player should know a number that
depends on a choice not yet made.

**Source:** Turn 28, 2026-07-15 playtest. Confirmed an OUT-OF-ORDER-RESOLUTION
variant (a to-hit roll generated before any commitment) and a
HIDDEN-INFO-LEAK instance in the same turn (exact threshold disclosed).
Dropped from the M7.4 eval fixture set — the structural
OUT-OF-ORDER-RESOLUTION checker matches "damage rolled before to-hit
confirms" via conditional language in the roll's `purpose` (e.g. "damage if
hit"), which doesn't apply here since the violation is "a roll generated
before commitment," not "damage before to-hit within an already-declared
action." A second confirmed instance from a future playtest would justify
either a new structural heuristic for this specific shape or converting it
to a judged (LLM-graded) rubric.

**Since:** the old harness this entry was written for is being replaced by ev2
(`ADR-0120`), which has no fixture to drop it from. Still worth trying; no
milestone depends on it.

---

# Steered-playtest capture targets

Written 2026-08-21 for the second M7.7 playtest, which moved to M7.9 with the
harness rebuild (`docs/roadmap.md § M7.7`). Re-read against ev2 on 2026-10-16.

**Reference, not a checklist, until M8–M11 land.** M7.9's playtest was played
unsteered from 2026-10-16. Each open target either already had its answer (the
Wound chain, `eval-findings.md § S79`) or could not be reached: a Contractor
loses its `crewRole` on the first update to it (M9), and the Warden prompt
does not ask for canon (M10). Take a target if a session reaches it. Steering
toward them is the job of M12's closing playtest, after the fixes that would
let them come out differently.

These began as **gaps in the old harness's corpus**: situations no fixture
exercised, each closing a roadmap bullet or a tag. The old harness is being
rebuilt from its smallest version (`ADR-0120`), and ev2 has no tags,
applicability, or fixture counts. It asks a question, and a captured turn
becomes a case for one. `docs/eval-findings.md § S80` also sorted the Warden's
errors into fixed and open, which splits the targets in two:

- **Open causes.** The turn is expected to go wrong, and capturing it gives the
  milestone that fixes it (M7.10–M11) a case from real play to measure against.
- **Fixed tags.** Each was last measured on one or two old-harness fixtures. The
  target checks that the fix held. A failure is news and worth capturing; a pass
  needs no capture.

Each entry's **Source** is kept as written; **Watch for** and **Capture** say
what it is for now.

The first playtest (adventure `5c34991b`, 58 turns, 2026-08-16) yielded seven fixtures
and all seven came from turns 1–11. Everything after turn 12 was unusable: the
tool-syntax leak seeded there and compounded, and 39 of 58 GM turns shipped markup and
applied nothing. **That cap is gone** — the guard now sits inside the tool loop
(`session.service.ts:854`), before persistence, so a leaked response never reaches
`message` and never replays as history. The Warden still emits it on about 4% of
turns (`§ S80`), but each occurrence costs one abandoned turn rather than every turn
after it, and the recovery caught all three in 80 live turns (`§ S49`). Expect a usable
capture across the whole session this time.

## Capture discipline

The first two are **standing conventions**, not specific to this session — they
apply to every capture-driven playtest, and `docs/roadmap.md` no longer carries them.
The last two are settled questions kept for readers of the older material.

- **One adventure in the campaign, start to finish.** Fixtures freeze whatever
  `campaignState` exists at authoring time, and adventure-scoped state is not yet
  separated from campaign state, so a capture taken after a second adventure begins
  bakes cross-adventure pollution into the corpus permanently. The enforcing guard
  lands in M12; until then it is a convention. Start the playtest in a **new
  campaign**. The earlier playtest adventures stay in the database: ev2 cases are
  captured from them with `task eval:capture-fixture`.
- **Verify the capture at capture time, not after.** `gmContextBlob.playerEntityIds`
  populated, one entity id per character, one resource-pool prefix per entity. Checking
  this late is what voided the 2026-08-20 re-baseline — seven fixtures ran with
  `playerEntityIds` unset, so the Warden was never told which entity was the player.
- **No longer applies (2026-10-16): answering the `applicability` stubs
  `capture-fixture` writes.** They belong to the old harness's checkers, and ev2
  reads none of them (`eval-v2/fixture.ts`). Leave them as written.
- **Settled 2026-08-21, and it no longer constrains the capture:** the hidden-entity
  leak resolved to `ADR-0101` — `visible` is line of sight, `revealed` is discovery,
  and the snapshot no longer filters, so the pool "leak" this list once warned about is
  correct behaviour rather than something a capture would freeze. No fixture needed
  re-capturing (`corpusVersion` held at `abbce198026c`). Read `ADR-0101` before
  `docs/hidden-information-findings.md`, which is closed and preserved as evidence.

---

## Open causes

### Take a Wound — drive a player character to 0 HP

Get into a fight, or a structural hazard, and let the damage land. The full chain is
HP to 0 → Wound → `1d10` on the Wounds Table column for the damage type → whatever that
row demands.

**Watch for:** does the Warden write `{ pool: "wounds", delta: 1 }` rather than
`maxDelta`, send a `damageType` on the damage, and reset Health in the same response?
`§ S79` expects the carryover to be lost, because the validator rejects Health below
zero. If the chain ends in death, does the Warden apply it, or wait for the player's
permission (`CHARACTER-DEATH-OVERRIDE`, `5c34991b` turns 55–56)? If the row is a Fatal
Injury, does the lasting penalty land in `characterState.rollModifiers`, or only in
`gmUpdates.notes`?

**Source:** Turn 52, 2026-08-16 playtest. The Warden ran the chain correctly and then
recorded that it could find no way to increment `dr_kennedy.wounds` through
`resourcePools`, and no Condition matching the Fatal Injury's `[-]` on all rolls. Both
gaps are now fixed — 018 Part 7 enumerates the pool names, and `rollModifiers` holds
the penalty. Full transcript at `docs/milestones/m7.7-turns-50-52-transcript.md`.

**Capture:** a case for ev2 question 2, whose only case is constructed
(`18be155e-turn29-wounds-chain`). Taken before M8 moves the damage arithmetic into code
(`ADR-0123`), it is the before.

### Put a Contractor with a crew role in play, and make it act

Hire or acquire an NPC Contractor with a `crewRole`, then give it something to do that
its role bears on. Include **one scene where it must climb, sprint, or work in
zero-g**, so that its Athletics or Zero-G skill is in play.

**Watch for:** does the `<entities>` block render its Instinct and its role-derived
skills? Does the Warden use them, or narrate around them? Does it try to roll Instinct
itself, or invent a number — the backend rolls it at synthesis-write time and
`SYNTHESIS_TOOLS` has no `roll_dice`, so a Claude-supplied value is a fabrication.
**Then check that `crewRole` and `instinctRoll` survive the first update to that
Contractor.** The entity merge in `session.validator.ts` drops them
(`ENTITY-FIELD-LOSS`, `§ S80`, fixed in M9), and a capture taken after they are gone
exercises nothing.

**Source:** `ADR-0100`, built and shipped 2026-08-21 as 018 Parts 9–10. Every existing
capture predates the fields, so the re-baseline exercised none of it. Shipped and
unverified rather than shipped and measured.

**Capture:** the case for the Workflowy card "Construct a case with a Contractor acting
in its skill domain". On 2026-10-16 no captured turn in any session had a Contractor
in Zero-G or Athletics, and the card decided the case should come from this playtest
rather than be written by hand.

### Introduce plot-relevant detail and see whether it gets written down

Find or be told something new and specific — a name, a designation, a fact about the
station, a piece of someone's history — in a way that makes it matter to the story, and
then move on without dwelling on it.

**Watch for:** does a `world_facts` or `proposed_canon` entry appear for it, or does the
detail exist only in the narration where nothing can retrieve it later? Expect it not
to: the Warden prompt does not mention `proposedCanon`, and the schema field carries no
description (`§ S80`, cause 4).

**Source:** `MISSING-CANON-CAPTURE` measured nothing for three consecutive runs of the
old harness — 0/10 applicability every time. Its only fixture waited for the Warden to
volunteer the marker phrase `RESTRICTED — VERIDIAN INTERNAL`, which it did not, so the
check never once graded.

**Capture:** a case for M10, Emit What You Narrate, from a turn where the detail is
plainly there to be recorded.

### Leave a scene without saying where you are going

End a beat ambiguously — "I head back", "let's regroup", "I go look for the others" —
without naming a destination or a timeframe. Then, separately, move between places
the opening narration has fixed, and between decks.

**Watch for:** does the Warden ask, or does it place you somewhere and skip the transit,
the elapsed time, and anything that might have happened in between? When you move, does
it put the places where the seeded layout has them?

**Source:** `SCENE-JUMP` sat at a single old-harness fixture (`turn24`). `§ S80` counts
it fixed: earlier fails were the rubric. Wrong positions are open cause 1 —
`SEEDED-CANON-CONTRADICTION` and `SPATIAL-RELATION-ERROR`, five and two instances in
`2c0ba938`.

**Capture:** a wrong deck or a skipped journey is a case for ev2 question 1. Every
question 1 case so far is from `2c0ba938`. Taken before M7.10 gives the backend places
and routes (`ADR-0121`), it is the before.

---

## Fixed tags: check the fix held

### Declare an action whose difficulty is genuinely ambiguous

Do something where it is not obvious whether a roll is needed — squeeze through a gap
you might just fit through, talk to someone who might already be inclined to agree,
work a mechanism you might or might not know well enough.

**Watch for:** does the Warden name the check and its stat before resolving, or does it
narrate an outcome that quietly implies a check it never surfaced?

**Source:** `UNSURFACED-CHECK` sat at a single fixture (`turn03`) and read 1.00, which
`ADR-0082` makes a suspect rather than a pass. `§ S80` counts it fixed, on that one
fixture.

**Capture:** only on a failure.

### Declare a multi-step plan in one message

Give the Warden three or four actions chained in a single turn — cross the room, force
the panel, pull the component, get back to cover — without pausing between them.

**Watch for:** does it resolve the whole chain in one response, including the steps
whose outcomes depend on earlier steps it has not rolled yet? A correct response stops
at the first step that needs a result it does not have.

**Source:** `OVER-RESOLUTION` sat at a single fixture (`turn24`). `§ S80` counts it
fixed, on that one fixture.

**Capture:** only on a failure.

### Make a roll that changes something

Take actions that produce a die roll *and* a state change in the same turn — damage,
stress, a resource spent, a timer moved — rather than rolls that only inform narration.
Include rolls that are yours to make: a skill check, a Fear Save, a Panic Check.

**Watch for:** can the state change be traced back to the roll that caused it from the
event record alone, without reading the prose? And, for open cause 5: does the Warden
roll a check the player should make (`SYSTEM-ROLLED-PLAYER-ACTION`), or judge a
roll-under backwards, including by ignoring a skill bonus it named itself
(`ROLL-RESULT-INVERSION`)?

**Source:** `UNAUDITABLE-MAPPING` read 0.00 (0/10) on the 2026-08-21 re-baseline;
plan 021 fixed it and the last baseline read 1.00, with one fixture applicable. The
roll-ownership and roll-result errors are `§ S80`'s cause 5. `2c0ba938`'s ignored skill
bonus was never captured.

**Capture:** an unauditable mapping only on a failure. A player's roll made or misjudged
by the Warden is a case for M11, Roll Adjudication, either way.

### Get blocked on something you could actually supply

Reach a point where the Warden needs a piece of information only you can give — a
decision, a declared target, a stat you have and have not stated — and then withhold it
for a turn.

**Watch for:** does it stall and ask, or narrate past the block as though the answer
had arrived?

**Source:** `NARRATING-PAST-A-BLOCK` read 1.00 (20/20) at the last baseline, and
`§ S80` counts it fixed. This target was once the exit for `turn16`, an old-harness
fixture whose block no player could satisfy. ev2 has no such case.

**Capture:** only on a failure.
