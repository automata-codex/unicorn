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

---

# M7.7 second-playtest capture targets

Added 2026-08-21, ahead of the second M7.7 playtest. These are not "moments that
tripped the Warden before" in the sense the entries above are — they are **gaps in
the eval corpus**, situations no fixture currently exercises, and the session is worth
steering toward them because a captured turn is the only thing that closes them.

The first playtest (adventure `5c34991b`, 58 turns, 2026-08-16) yielded seven fixtures
and all seven came from turns 1–11. Everything after turn 12 was unusable: the
tool-syntax leak seeded there and compounded, and 39 of 58 GM turns shipped markup and
applied nothing. **That cap is gone** — the guard now sits inside the tool loop
(`session.service.ts:854`), before persistence, so a leaked response never reaches
`message` and never replays as history. Emission is still ~1.36% per turn, but each
occurrence costs one abandoned turn rather than every turn after it. Expect a usable
capture across the whole session this time.

## Capture discipline

The first three are **standing conventions**, not specific to this session — they
apply to every capture-driven playtest, and `docs/roadmap.md` no longer carries them.
The fourth is a settled question kept for readers of the older material.

- **One adventure in the campaign, start to finish.** Fixtures freeze whatever
  `campaignState` exists at authoring time, and adventure-scoped state is not yet
  separated from campaign state, so a capture taken after a second adventure begins
  bakes cross-adventure pollution into the corpus permanently. The enforcing guard
  lands in M9; until then it is a convention.
- **Verify the capture at capture time, not after.** `gmContextBlob.playerEntityIds`
  populated, one entity id per character, one resource-pool prefix per entity. Checking
  this late is what voided the 2026-08-20 re-baseline — seven fixtures ran with
  `playerEntityIds` unset, so the Warden was never told which entity was the player.
- **Answer the `applicability` stubs `capture-fixture` writes; do not delete them.**
  `applies: false` with a real reason surfaces in the report's
  `fixture-gated-never-applies` finding. A deleted entry is visible nowhere.
- **Settled 2026-08-21, and it no longer constrains the capture:** the hidden-entity
  leak resolved to `ADR-0101` — `visible` is line of sight, `revealed` is discovery,
  and the snapshot no longer filters, so the pool "leak" this list once warned about is
  correct behaviour rather than something a capture would freeze. No fixture needed
  re-capturing (`corpusVersion` held at `abbce198026c`). Read `ADR-0101` before
  `docs/hidden-information-findings.md`, which is closed and preserved as evidence.

## Take a Wound — drive a player character to 0 HP

Get into a fight, or a structural hazard, and let the damage land. The full chain is
HP to 0 → Wound → `1d10` on the Wounds Table column for the damage type → whatever that
row demands.

**Watch for:** does the Warden write `{ pool: "wounds", delta: 1 }`, or does it infer
the Wound from `characterState.death_save_pending` and leave the pool alone? Does it
use `delta` rather than `maxDelta`? If the row is a Fatal Injury, does the lasting
penalty land in `characterState.rollModifiers`, or only in `gmUpdates.notes` where
nothing downstream can apply it?

**Source:** Turn 52, 2026-08-16 playtest. The Warden ran the chain correctly and then
recorded that it could find no way to increment `dr_kennedy.wounds` through
`resourcePools`, and no Condition matching the Fatal Injury's `[-]` on all rolls. Both
gaps are now fixed — 018 Part 7 enumerates the pool names, and `rollModifiers` holds
the penalty — and **neither fix is exercised by any fixture.** Full transcript at
`docs/milestones/m7.7-turns-50-52-transcript.md`.

**Capture:** closes the wounds-chain bullet, and `CARRYOVER-ARITHMETIC` and
`UNEXPLAINED-DELTA` with it — three bullets from one turn, and the only route to
evidence for `rollModifiers`.

## Put a Contractor with a crew role in play, and make it act

Hire or acquire an NPC Contractor with a `crewRole`, then give it something to do that
its role bears on.

**Watch for:** does the `<entities>` block render its Instinct and its role-derived
skills? Does the Warden use them, or narrate around them? Does it try to roll Instinct
itself, or invent a number — the backend rolls it at synthesis-write time and
`SYNTHESIS_TOOLS` has no `roll_dice`, so a Claude-supplied value is a fabrication.

**Source:** `ADR-0100`, built and shipped 2026-08-21 as 018 Parts 9–10. Every existing
capture predates the fields, so the re-baseline exercised none of it. Shipped and
unverified rather than shipped and measured.

**Capture:** closes the `crewRole`/`instinctRoll` bullet.

## Introduce plot-relevant detail and see whether it gets written down

Find or be told something new and specific — a name, a designation, a fact about the
station, a piece of someone's history — in a way that makes it matter to the story, and
then move on without dwelling on it.

**Watch for:** does a `world_facts` or `proposed_canon` entry appear for it, or does the
detail exist only in the narration where nothing can retrieve it later?

**Source:** `MISSING-CANON-CAPTURE` has measured nothing for three consecutive runs —
0/10 applicability every time. Its only fixture waits for the Warden to volunteer the
marker phrase `RESTRICTED — VERIDIAN INTERNAL`, which it does not, so the check has
never once graded. **This is a fixture defect, not a Warden finding**, and a capture
gated on something the turn reliably produces is the fix.

**Capture:** gives the tag a second instance, and a replacement for the marker-phrase
gate. One of the four tags blocking M7.4's fixture-count bullet.

## Declare an action whose difficulty is genuinely ambiguous

Do something where it is not obvious whether a roll is needed — squeeze through a gap
you might just fit through, talk to someone who might already be inclined to agree,
work a mechanism you might or might not know well enough.

**Watch for:** does the Warden name the check and its stat before resolving, or does it
narrate an outcome that quietly implies a check it never surfaced?

**Source:** `UNSURFACED-CHECK` sits at a single fixture (`turn03`) and reads 1.00, which
`ADR-0082` makes a suspect rather than a pass. The spec flagged it as needing a second
confirmed instance before the category counts as covered.

**Capture:** one of the four tags blocking M7.4's fixture-count bullet.

## Declare a multi-step plan in one message

Give the Warden three or four actions chained in a single turn — cross the room, force
the panel, pull the component, get back to cover — without pausing between them.

**Watch for:** does it resolve the whole chain in one response, including the steps
whose outcomes depend on earlier steps it has not rolled yet? A correct response stops
at the first step that needs a result it does not have.

**Source:** `OVER-RESOLUTION` sits at a single fixture (`turn24`).

**Capture:** one of the four tags blocking M7.4's fixture-count bullet.

## Leave a scene without saying where you are going

End a beat ambiguously — "I head back", "let's regroup", "I go look for the others" —
without naming a destination or a timeframe.

**Watch for:** does the Warden ask, or does it place you somewhere and skip the transit,
the elapsed time, and anything that might have happened in between?

**Source:** `SCENE-JUMP` sits at a single fixture (`turn24`). Added after the spec and
inherits the same two-instance bar.

**Capture:** one of the four tags blocking M7.4's fixture-count bullet.

## Make a roll that changes something

Take actions that produce a die roll *and* a state change in the same turn — damage,
stress, a resource spent, a timer moved — rather than rolls that only inform narration.

**Watch for:** can the state change be traced back to the roll that caused it from the
event record alone, without reading the prose?

**Source:** `UNAUDITABLE-MAPPING` reads **0.00 (0/10)** on the 2026-08-21 re-baseline
with applicability 0.20 (10/49) — four of its five fixtures return "no dice_roll events
this turn" every rep, so one fixture carries the entire tag. The rate is bad *and* rests
on a single turn.

**Capture:** widens the tag's coverage, which is half of what its roadmap bullet asks
for. The other half — reading the ten failing artifacts to find out what the Warden is
actually doing wrong — is desk work, not playtest work.

## Get blocked on something you could actually supply

Reach a point where the Warden needs a piece of information only you can give — a
decision, a declared target, a stat you have and have not stated — and then withhold it
for a turn.

**Watch for:** does it stall and ask, or narrate past the block as though the answer
had arrived?

**Source:** `turn16-narrating-past-a-block` has never had a satisfiable block. It stalls
the Warden until it learns "Alvarez's Instinct score", and Alvarez is the player
character — Instinct is a Contractor stat, now formally an `npc`-only field under
`ADR-0100`. No value the player could supply unblocks it, so no run can pass it, and it
has failed every rep across every run ever recorded. `NARRATING-PAST-A-BLOCK` reads 0.66
entirely because of it.

**Capture:** supplies the re-authoring exit for that bullet. If nothing usable comes up,
the other exit is retiring `turn16` and letting the tag stand on `turn21` plus the
`5c34991b-turn10` capture — which costs a corpus bump and no Warden spend.
