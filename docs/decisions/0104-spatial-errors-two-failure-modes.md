---
id: ADR-0104
title: Spatial narration errors are two failure modes, not one
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  Splits the 2026-08-24 playtest's spatial narration errors into a gradeable
  seeded-canon tag and an ungradeable relative-position one, with the rubric and
  `judgeContext` injection the first needs. The addendum reverses the second half: its
  category-three classification does not hold and registration is deferred.
---

**The 2026-08-24 playtest narrated ship movement wrongly six times, and the six look
like one failure mode.** Adventure `2c0ba938-ea80-4138-a95a-dc13e417bf2b`, 52 turns.
Turn 8 has Danny leave the bridge and climb *down to the deck below* to reach the
engineering records terminal, which `worldFacts.ship_layout` places on the upper deck aft
of the bridge. Turn 14 takes him from that terminal *past mid-deck and on toward the
lower deck* to Mara's berth; berths are mid. Turn 18 repeats it. Turn 21 places the cryo
bay *two decks from here* and the bridge *two decks up* in one sentence, which cannot both
hold from one position. Turn 24 places Petrov *two decks from the engine room* when
`worldFacts.crew_roster` puts him in it. Turn 28 puts the cryo bay *two decks away* from a
scene explicitly set in the mess hall, which is the same deck.

**They are two, and the line between them is whether the fixture contains the answer.**
`worldFacts.ship_layout` states which deck each place is on and renders verbatim in all
52 snapshots, so it is seeded into any fixture captured from this adventure. Danny's
current deck is stated nowhere in state at all — the snapshot emits four sections
(`<resource_pools>`, `<entities>`, `<flags>`, `<world_facts>`) and none is spatial,
`grid_entity` is unread and does not contain the player, and `narrative.location` is a
scenario descriptor fixed at synthesis. A checker can compare a claimed deck against
`ship_layout`. Nothing can evaluate *two decks from here* without knowing where *here* is.
That is the difference between a gradeable tag and a category-three tag, and it is why one
finding produces two registrations.

**The first kind manufactures the false premises the second kind then reasons from
correctly.** Turn 21 was narrated from Mara's berth, which turn 14 had wrongly placed on
the lower deck seven turns earlier. From the lower deck, *bridge two decks up* is right.
The arithmetic was sound and the position it operated on was a fiction the Warden had
authored itself and never recorded. Scoring both under one tag would double-count one root
cause and erase the ordering, which is the most actionable thing the playtest produced
about this failure: the lookup errors are upstream, and fixing them removes some of the
distance errors without touching distance reasoning at all.

**Decision, in two parts.**

- **`SEEDED-CANON-CONTRADICTION`** — narration asserts something contradicting a concrete
  value resident in the fixture's seeded state or seeded opening narration. Judged, not
  structural: extracting the claim from prose is classification, and structural checks may
  read event and state structure only. A response making no such claim is
  `not_applicable`, not a pass.
- **`SPATIAL-RELATION-ERROR`** — the Warden asserts a relative spatial claim that is wrong
  given the layout and the acting entity's actual position. Registered as **category
  three**: a question that would be structural if the schema recorded an additional field.
  Every rep returns `not_applicable` naming `current_location` as the missing field, until
  that field exists.

**`SEEDED-CANON-CONTRADICTION` is deliberately scoped wider than the spatial cases.** The
unifying property is not that a claim is spatial; it is that its referent lives in the
fixture, which is what makes the tag gradeable at all. Two subtypes are attested. Layout
contradictions against `ship_layout` (turns 8, 14, 18), and a timeline contradiction at
turn 1, which places the mid-deck lighting failure *since day four* against a seeded
opening narration saying the fixtures went dark *two nights ago*, aboard a ship three weeks
out. A third subtype appears at turn 24, where the contradicted value is where a *person*
is (`crew_roster`) rather than where a *place* is (`ship_layout`). Five instances across
three kinds of case. Registering `DECK-LOOKUP-ERROR` and a
timeline sibling separately would mean generalising later against a corpus already
committed to the narrow shape, and the standing defer-until-a-second-case principle is
satisfied here by a second *kind* rather than a repeat.

**The judge cannot see seeded state, so the ground truth has to be injected.**
`runJudgeCall` builds the rubric text, the winning response's `playerText`, a dump of this
turn's `gameEvents`, and an optional `judgeContext` block. No `seededState`, no
`campaignState`, no `worldFacts` — and since `summarizeGameEvents` shows only what the turn
*wrote*, a seeded value never appears there either. The mechanism is `judgeContext`, which
receives the fixture and can render `fixture.seededState.campaignState.worldFacts` into the
scope block; `unauditableMappingJudgeContext` is the existing precedent.

**The rubric is authored with `requiredFacts: []`, and that is a durability decision
rather than a shortcut.** Rubric text lives in `eval/checks/judged/rubrics.ts` and is
outside `corpusVersion`, so a rubric revision is scoring-only — frozen artifacts stay valid
and `eval:rescore` re-grades them in place. `assertion.facts` lives inside the fixture file
and is not. Putting the contradicted value in `requiredFacts` would therefore pin the
fixture files to the provisional rubric's fact set, so any later revision changing that set
costs a `corpusVersion` bump. With an empty fact set and the ground truth injected through
`judgeContext`, the first rubric is a revisable draft rather than a permanent commitment,
and getting it wrong is cheap.

**The injection sits in a hash blind spot, which is a separate defect and gets a separate
entry.** `judgeContext` output is covered by neither `rubricHash` (which hashes the
template alone) nor `judgeContractHash` (model, system prompt, closing instruction, verdict
tool) nor `corpusVersion`. Two runs can therefore carry identical identities on every axis
while the judge read different material — the shape `ADR-0099`'s addendum exists to
prevent, and pre-existing, since `unauditable-mapping` already sits in it. Mitigated here by
sourcing the injected data from `fixture.seededState`, so the *data* falls under
`corpusVersion` and only the renderer is unhashed, plus a committed golden on the renderer.
Hashing the output directly is the wrong instrument: it varies per fixture and per run, so
it would not be a stable contract identity in the way `rubricHash` and `judgeContractHash`
are, and what needs coverage is the renderer's behaviour rather than its output.

**Considered and rejected.**

- **One tag covering all six errors.** Rejected on the causal argument above: it
  double-counts turn 14 as turn 21 and hides which fix comes first.
- **A narrow `SEEDED-CANON-CONTRADICTION` restricted to spatial claims.** Rejected because
  the turn 1 timeline case has the identical gradeable property and would force the
  generalisation later at higher cost.
- **Deferring `SPATIAL-RELATION-ERROR` until `current_location` exists.** Rejected because
  registration is free — the registry is harness-side and moves neither `promptHash` nor
  `assemblyHash` — and because registering it now means the tag converts when the field
  ships rather than being invented late. Note the report must distinguish a tag gated by a
  *declared* missing schema field from one gated by accident; `MISSING-CANON-CAPTURE`'s
  three runs of 0/10 are the second kind, and reading them the same way at a glance is the
  hazard.
- **A third tag for turn 9's silent retcon.** Asked directly whether he had changed decks,
  the Warden asserts Danny is on the upper deck and *never had to take the ladder shaft down
  at all* — restoring `ship_layout` correctly while flatly denying turn 8's narration. The
  correction is right; the failure is that it is unacknowledged. One instance, entangled
  with a defensible behaviour, and a different mechanism from the turn 20/21 retcon defect
  which is about state committed and not reversed. Logged, not registered. Revisit on a
  second instance, and do not merge the two on the strength of both containing the word
  retcon.

**Measurement hazard this decision creates.** The `ADR-0101` addendum of the same date
recommends restructuring `ship_layout` from a ~700-character prose run into a deck-indexed
list — a Warden-visible intervention aimed at precisely what
`SEEDED-CANON-CONTRADICTION` measures. If it lands in the same batch as the fixtures, the
tag's first number is post-intervention with nothing to compare against, and the effect of
the one intervention most worth knowing about is unrecoverable. The restructure is a
`worldFacts` edit with no schema change and does not need to ride any particular milestone,
so the cheap resolution is to measure first. Whichever order is chosen, the §6.3 prediction
is written before the run: a prediction too loose to be violated makes category-2
attribution unreachable by construction.

**Cost.** New fixtures are a set-membership `corpusVersion` bump — survivors' artifacts
stay valid and no Warden call is owed for them — and because both tags are new, no existing
tag's denominator moves. The fixtures × N reps are owed whenever they are captured, so
deferring saves nothing and forfeits the coverage — and the candidate set is larger than the
three the roadmap bullet names, since turns 18 and 24 are also fail-direction instances. The provisional rubric's first figures
become citable, so a bump note is written when the rubric is authored rather than when it is
first revised.

**Addendum — `SPATIAL-RELATION-ERROR` is not a category-three tag, and its registration is
deferred.** Recorded 2026-08-25 while annotating the playtest report for fixture extraction.

The claim above is that this tag "would be structural if the schema recorded an additional
field," and that adding `current_location` converts it. `ADR-0074`'s third case does not
admit it. The test that case sets is not that a field is missing; it is that once the field
lands the check reads **no prose at all** — `out-of-order-resolution` compares a named gate's
sequence number, `system-rolled-player-action` attributes through `actingEntityId` "without
reading `purpose` at all," and both cleared it because the fact being graded already lived in
the `roll_dice` payload and the new field completed it.

The fact graded here does not. *"Four hundred and twelve people are asleep two decks away"*
exists only in narration. `current_location` supplies where the acting entity stands; it does
not supply the assertion, and extracting the assertion is classification — the same argument
this entry makes one paragraph earlier to send `SEEDED-CANON-CONTRADICTION` to a judge. So
the field moves this tag from ungradeable to *judged with a better fact injected*, which is
not what category three means: every prior third-case example resolved into the first case,
not into a better-informed judge call.

**Two different checks were conflated.** Grading the prose claim is judged permanently, and
`current_location` improves the `judgeContext` injection exactly as `worldFacts` does for the
sibling tag. Grading the *state writes* — are consecutive `current_location` values
adjacency-legal against `ship_layout` — is genuinely structural, but it is a narrower
question that catches turn 14's misplacement and misses turns 21 and 28 entirely, because a
prose distance claim need not correspond to any state write. Those two turns are the
instances that motivated the tag. This entry describes the first and promises the second.

**Registration is therefore deferred**, reversing the "considered and rejected" bullet above
on its own terms. That bullet rejected deferral because registration is free. It is not free
in the way that assumed: registering forces a choice between `structuralFailureModeTags` and
`judgedFailureModeTags` now, and that is precisely the question that is unsettled. Registering
structural and later moving to judged is the `MISSING-DELTA` / `ROLL-RESULT-INVERSION`
migration, which required an `assertion.mode` edit inside every fixture file carrying the tag
and therefore a `corpusVersion` bump.

Deferral also keeps the guardrail mechanical rather than procedural. `capture-fixture`
validates `--tag` against `failureModeTagSchema` and refuses an unregistered value, so while
the tag is unregistered a fixture cannot be captured against it by accident. Registering it
replaces that gate with a note asking people to remember. Nothing is lost by waiting: the
`SEEDED-CANON-CONTRADICTION` fixtures are unaffected, and no fixture was planned for this tag
in the same batch. Annotating the playtest report with the tag is safe and stays — nothing
reads those annotations, and the 2026-08-16 report already carries unregistered tags.

**`SEEDED-CANON-CONTRADICTION` is unaffected.** Register it, author the rubric with
`requiredFacts: []`, and capture its fixtures as planned.

**One correction to the body above, applied in place.** The third layout contradiction is
**turn 18**, not turn 19 — *"You head back down to the lower deck ... and rap a knuckle
against Mara's hatch"* — and turn 19 contains no deck claim at all. The same error is in the
M7.7 roadmap bullet and in the capture list, which name turn 19 for this instance; the
roadmap bullet has since been corrected. Two further counts moved when turn 24 was added to
the body as a third subtype, and are corrected in place: the playtest narrated ship movement
wrongly **six** times rather than five, and the opening paragraph now enumerates turn 24
alongside the other five. `SEEDED-CANON-CONTRADICTION` stands at five instances across three
subtypes; the six counts all spatial errors including the two that belong to the deferred
tag.
