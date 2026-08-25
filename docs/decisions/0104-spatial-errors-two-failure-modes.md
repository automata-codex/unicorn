---
id: ADR-0104
title: Spatial narration errors are two failure modes, not one
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: null
---

**The 2026-08-24 playtest narrated ship movement wrongly five times, and the five look
like one failure mode.** Adventure `2c0ba938-ea80-4138-a95a-dc13e417bf2b`, 52 turns.
Turn 8 has Danny leave the bridge and climb *down to the deck below* to reach the
engineering records terminal, which `worldFacts.ship_layout` places on the upper deck aft
of the bridge. Turn 14 takes him from that terminal *past mid-deck and on toward the
lower deck* to Mara's berth; berths are mid. Turn 19 repeats it. Turn 21 places the cryo
bay *two decks from here* and the bridge *two decks up* in one sentence, which cannot both
hold from one position. Turn 28 puts the cryo bay *two decks away* from a scene explicitly
set in the mess hall, which is the same deck.

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
contradictions against `ship_layout` (turns 8, 14, 19), and a timeline contradiction at
turn 1, which places the mid-deck lighting failure *since day four* against a seeded
opening narration saying the fixtures went dark *two nights ago*, aboard a ship three weeks
out. Four instances across two kinds of case. Registering `DECK-LOOKUP-ERROR` and a
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

- **One tag covering all five errors.** Rejected on the causal argument above: it
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
tag's denominator moves. The three fixtures × N reps are owed whenever they are captured, so
deferring saves nothing and forfeits the coverage. The provisional rubric's first figures
become citable, so a bump note is written when the rubric is authored rather than when it is
first revised.
