---
id: ADR-0112
title: '`UNREVERSED-RETCON` is judged, and the reversed turn''s committed deltas are captured'
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  The turn 20/21 retcon pair, registered as a tag on one instance. Judged rather than
  structural, because detecting a reversal means reading prose; graded against a new
  captured field (`seededState.precedingCommittedTurn`, fixture schema v3) rather than
  hand-authored facts, because the fold destroys the delta the check needs. Carries the
  rejected structural design and the `ADR-0105` golden that ships with the renderer.
---

## Context

**Turn 20 of the 2026-08-24 playtest adjudicated a check against the wrong target, and
turn 21 fixed the fiction without fixing the world.** Danny attempts to crack an
insurance file; the roll comes in at 48. The player's own message says *"I have
Computers +10"* — in the same turn, before the adjudication — and the Warden resolves it
against an unmodified Intellect 40, narrates a hard failure with a tamper alert, and
commits two things for that outcome: `stress +1` on `danny`, whose `reason` names the
failed check, and `insurance_scam_exposed` held at `false`.

The player says so: *"I have computers +10, so that 48 would be under the total of 50."*
Turn 21 agrees, and it is right to — Trained is +10, the target is 50, and 48 clears it.
It narrates the moment again as a clean success, flips the flag to `true`, and writes an
`npcState`. The stress point stays. The turn's own notes state the reason it stays:

> Overwrote the prior narrated failure/lockout outcome this turn since **no lasting
> state had been committed to it beyond narrative flavor**.

That claim is false, and the fixture carries the `state_update` proving it. Every
subsequent turn is built from a `danny.stress` of 3, one point of which was charged for
an event the fiction no longer contains.

**`ADR-0104` had already isolated this mechanism and declined to name it.** Reviewing six
continuity errors from the same playtest, it registered `SEEDED-CANON-CONTRADICTION`,
deferred `SPATIAL-RELATION-ERROR`, and set turn 9's silent retcon aside as "one instance,
entangled with a defensible behaviour, and a different mechanism from the turn 20/21
retcon defect which is about state committed and not reversed." This entry registers that
second mechanism.

## Decision

**Register `UNREVERSED-RETCON` on its single instance, as a judged check, graded against
a newly captured fixture field.**

### Registered on one instance, which is a departure worth stating

`ADR-0104`'s own bar was a second instance before registering turn 9's retcon, and this
tag clears no such bar. Three things separate them. The roadmap already commits to this
one as an M7.7 deliverable. The failure is a state-integrity defect rather than a
narrative one — a wrong number in the world that every later turn compounds, not a
paragraph a reader might disagree about. And the behaviour that produces it is not
entangled with anything defensible: the retcon itself is correct and is explicitly
excluded from the rubric, so the tag names only the half that has no argument for it.

### Judged, not structural

The subject of the check — that a turn reversed an outcome an earlier turn narrated —
lives in the narration and nowhere else. `ADR-0074` bars a structural check from
classifying prose, and "you reel the moment back the way it should've gone" is prose. The
comparison that follows a detected reversal is mechanical, and both sides of it are now
captured data, but reaching the comparison is the part that is not.

**A structural version was designed and is recorded here because it is the obvious
move.** It would gate on the one structural trace a reversal leaves — this turn writing a
key the preceding turn also wrote, `insurance_scam_exposed` going `false` → `true` — and
then grade whether the preceding turn's other committed deltas were offset. It is
deterministic, free, and non-lexical, and it fails on coverage: a reversal that overwrites
nothing leaves no trace at all. A turn can narrate the failure away and simply emit less,
which is the shape a Warden that believes "no lasting state was committed" will most often
produce. Gating on the overwrite measures the subset of retcons that happen to touch the
same key, and reports it as the rate for all of them.

The alternative structural framing — stipulate the reversal in the fixture and grade only
whether the stress was offset — was rejected for the opposite failure. A Warden that
re-examines the arithmetic and declines to retcon has committed no violation, and would
score a `fail` for the absence of a delta it correctly did not owe.

### Graded against `seededState.precedingCommittedTurn`, a new v3 capture field

**Nothing in a fixture carried what the reversed turn committed.** Everything under
`seededState` is state *as of* the target turn, which is the fold of every prior delta:
by construction it records where the world ended up and not who moved it there. The
folded `campaignState` carries `danny.stress = 3` and no trace that a turn added 1 of it,
for a reason that no longer applies. `seededState.messages` are narration only — `role`
and `content`, no `stateChanges`. So the check's ground truth was absent from both modes,
not just from the judged one.

`capture-fixture` now records the last **committed** turn before the target: the winning
`gm_response`/`correction` payload's `stateChanges`, paired with the `applied` block of
the `state_update` that committed it, plus that response's sequence number.
`FIXTURE_SCHEMA_VERSION` moves 2 → 3 and `unreversed-retcon` declares
`requiresFixtureSchema: 3`, so a v2 fixture — whose `null` means *never captured* rather
than *nothing was committed* — reports `not_applicable` instead of an exclusion it never
earned. This is the first judged check to declare the field, which surfaced that
`buildChecks` read `REQUIRES_FIXTURE_SCHEMA` only in the structural loop; `runCheck`
applies the gate before dispatching on mode, so the omission would have been a silently
ignored declaration rather than a type error.

**Both halves are captured, because they answer different questions.** `stateChanges` is
what the Warden emitted — the deltas, and the `reason` text on each, which is where the
causal link to the reversed outcome lives. `applied` is what the validator committed —
resulting values, which is what "committed" means and what a rejected change would be
missing from. The prior value is the difference between them, and is deliberately left as
a difference: see the renderer note below.

### Every kind of committed state counts

Pools, flags, entities, world facts, character state — not only numeric pools. The
instance in hand is a pool, and a rubric scoped to pools would name the tag after its
first example. The cost is a judgment the rubric has to carry explicitly: state the
reversed turn committed *for reasons that survive the reversal* is not owed an undo, and
the rubric says so rather than leaving the judge to infer a scope.

## Consequences

**A `judgeContext` golden ships with the renderer**, per `ADR-0105`. This is the third,
after `SEEDED-CANON-CONTRADICTION` and `UNGROUNDED-CONTRACTOR-TARGET`;
`unauditableMappingJudgeContext` remains the one uncovered renderer and remains M7.8's
work. The catalog reports the state per check (`task docs:eval-tags`), so the gap is
visible rather than remembered.

**The renderer selects and computes nothing.** `ADR-0105`'s corollary is load-bearing
here in a way it was not for `SEEDED-CANON-CONTRADICTION`: the interesting number is the
*prior* value of a changed pool, and that is arithmetic. Computing it inside the renderer
would put an arithmetic claim in front of the judge as ground truth, carrying no identity
and answerable to no hash — so the two blocks are rendered verbatim and the difference is
left for the judge to take. A spec asserts the absence.

**`corpusVersion` moves**, as it does for any corpus addition — one new fixture,
`2c0ba938-turn21-unreversed-retcon`. The check's `applicabilitySource` is `'artifact'`
under the weakest-link rule, and carries the same caveat `SEEDED-CANON-CONTRADICTION`
does: a turn that reverses nothing is `not_applicable` in principle and a pass in
practice, because a judged check has no route to `not_applicable` except through its gate
and deciding that case means reading prose. The rubric requires the judge to name it in
those terms so the artifacts stay separable.

**The prior narration reaches the judge from `messages`, not from the new field.** The
renderer takes the last `gm` message in the seeded window, which is not provably the same
turn as the captured deltas — `precedingCommittedTurn` skips back past a turn that
committed nothing, while `messages` carries every narration. They coincide on every
fixture captured so far. The renderer labels the section as the last narration the player
was shown rather than asserting a pairing it cannot verify.

## Alternatives considered

- **Hand-author the reversed turn's deltas into `assertion.facts`.** Free — the fixture
  file falls under `corpusVersion` already — and rejected on the cost `ADR-0104` records
  for `SEEDED-CANON-CONTRADICTION`'s `requiredFacts: []`: pinning ground truth there
  commits every future fixture carrying this tag to the current fact set, and a later
  rubric revision changing that set costs a `corpusVersion` bump on all of them. It also
  moves a transcription step into fixture authoring, where a typo becomes ground truth.
- **Grade against the folded state alone, with no capture change.** Rejected as
  unreachable rather than expensive: the fold has already destroyed the distinction the
  check is about.
- **Capture the `state_update` payload only.** Cheaper, and loses the `reason` text —
  which is the only field linking a committed delta to the outcome being reversed. A
  judge shown `stress: 3` with no stated cause cannot tell what the reversal owes.
- **A structural check.** Recorded above at length, in both its gated and stipulated
  forms.
- **Fold this into `MISSING-DELTA`.** Superficially close — both are about a gap between
  narration and emitted state — and wrong in direction. `MISSING-DELTA` asks whether a
  turn failed to emit a change it described; this asks whether a turn failed to emit a
  change it *un*-described. Merging them would make one tag's rate mean two things, which
  is the objection `ADR-0104` raises against a single tag for six errors and
  `fixture.schema.ts` raises against merging `SCENE-JUMP` into `OVER-RESOLUTION`.

## Open items

1. **The tag has one fixture and will report a rate on one turn.** `ADR-0082`'s reading
   applies in advance: a rate that never moves is a harness suspect before it is a
   finding. A second instance is worth capturing when a playtest produces one, and the
   scenario is cheap to steer toward — tell the Warden its arithmetic was wrong on a roll
   that already cost something.
2. **Whether a `judgeContext` renderer without a golden should be a compile error** is
   still the open question `ADR-0105` left, and is now three-for-four rather than
   two-for-three. A convention that depends on remembering is the thing that entry was
   correcting.
