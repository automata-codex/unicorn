---
id: ADR-0115
title: '`turn02-missing-canon-capture` is retired, not re-authored'
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  The fixture reported `not_applicable` on 157 reps across 16 runs. The marker phrase
  looked like the defect and was a symptom: the detail it asks the Warden to capture is
  already seeded in `worldFacts`, so re-authoring the marker would have failed the turn
  for not re-writing a durable fact. Retired rather than repaired, and replaced by two
  fixtures graded in opposite directions.
---

## Context

`turn02-missing-canon-capture` never graded anything. Across every archived run
containing it — **157 reps, 16 runs**, both models, every prompt revision from 2026-07-29
to 2026-08-24 — it returned `not_applicable` on every rep.

The audit block on `checkMissingCanonCapture` had already examined this at 20 reps and
reached a correct but incomplete conclusion: the exclusions are honest, the marker phrase
(`RESTRICTED — VERIDIAN INTERNAL`) genuinely never appears, and the fixture is at fault
rather than the checker. It named the fix as "recapturing the fixture against a turn whose
narration reliably introduces its detail, or authoring the expectation as something other
than a literal phrase."

## The marker is a symptom, not the defect

The turn asks whether the Warden captured the station layout. `worldFacts.station_layout_overview`
**already seeds that layout** — the central hub, four radial modules, habitat ring, ladder
shaft, Lab C's quarantine notice. The player asks for a map and the Warden reads the seeded
canon back to them. That is correct behaviour, it introduces nothing, and there is nothing
to capture.

**Which makes the obvious repair a trap.** Re-authoring the marker to a phrase the
narration does produce every rep — "habitat ring", "ladder shaft" — gates on restated
seeded canon, and the check would then fail the turn on every rep for not durably writing
a fact that was already durable. An honest zero denominator traded for a manufactured
0.00. `ADR-0081` rejects this check's migration to judged for the mirror-image reason: a
judge asked "was the detail introduced, and if so captured" would answer "it wasn't" on
every rep and, the verdict being binary, return a spurious 1.00. Both trades replace *no
measurement* with *a wrong measurement*, in opposite directions.

The details the turn genuinely invents vary rep to rep — one rep produces
`"restricted, manifest ref. 774-KK"`, another places the junction "about twenty metres out"
where `starting_location` seeds 12. No fixture-authored literal phrase can gate on
invention that moves every rep.

## Decision

**Retire `turn02-missing-canon-capture`, and replace it with two fixtures from `2c0ba938`,
one per direction.**

Retirement rather than repair is forced as well as chosen: the source adventure
`18be155e` is no longer in the local database, so the fixture cannot be re-captured
against a different turn. Only a hand-edit of the frozen JSON was available, and every
candidate edit is the trap above.

- **`2c0ba938-turn21-missing-canon-capture`** — the fail side. The player's corrected
  arithmetic opens the insurance file, and what the file holds lives in
  `gmContextBlob.narrative` ("a designed loss, with hazard-multiplier payouts for crew and
  colonist casualties") where the player cannot see it, with nothing about it in the five
  `worldFacts` keys standing at that point. Narrating it moves a GM secret into shared
  canon and owes a durable write; the original turn wrote a flag and an `npcState`.
- **`2c0ba938-turn23-missing-canon-capture`** — the pass side, and it exists because the
  `worldFacts`-diff branch had never executed against real output in those 157 reps. The
  player asks who the crew are, five of the six are unnamed in the seeded context, and the
  original turn wrote `crew_roster` and `insurance_file_copies`.

Both were verified against the historical output of their turns before landing: `turn21`
reaches `FAILED`, `turn23` reaches `PASSED` on the branch that had never run.

## The rule this generalises to

**A fixture that grades whether a turn wrote something down must seed a world in which
that something is absent.** Nothing in the authoring path checks this — the marker phrase,
the `expects:` text and the seeded state are authored independently, and `capture-fixture`
cannot know which world fact the author has in mind. Until it can, the question belongs on
the authoring checklist: *is the expected detail absent from
`seededState.campaignState.worldFacts`, and absent from the seeded message window?*
Recorded at length in `docs/eval-methodology.md § A fixture cannot grade what the seed
already contains`.

**Marker stability becomes an authoring criterion rather than an accident.** A phrase the
Warden invents fresh each rep gates on a coin flip. Both replacements are pinned instead:
`hazard multiplier` is vocabulary the Warden reads off its own seeded context, and
`bridge crew` is echoed from the player's own question. Neither is a guess at how a model
might word something — the property `RESTRICTED — VERIDIAN INTERNAL` lacked.

## Alternatives considered

- **Re-author the marker in place.** The ticket's first option, and the trap analysed
  above. It also keeps the fixture id and its comparison history, which is a real cost of
  retiring — paid because the alternative is a fixture that reports a number meaning
  nothing.
- **Migrate the check to judged.** Rejected in `ADR-0081` and not reopened: only the
  structural path can express `not_applicable`, and this fixture is the case that proves
  why that matters.
- **Keep it and add coverage elsewhere.** Leaves an honest zero denominator standing at
  the cost of a rep per run and an exclusion line someone re-reads every time. Rejected as
  paying rent for nothing.

## Consequences

**A set-membership bump** under `docs/eval-methodology.md § Two kinds of corpus bump` —
one fixture removed, two added. Frozen artifacts for surviving fixtures stay valid, but
`MISSING-CANON-CAPTURE`'s denominator moves and no rate spans the change like-for-like.

**The `pending_canon` branch is still unexercised.** The check has two PASS branches and
the replacement only covers one. `2c0ba938` proposes canon on no turn at all; the only
rows in any source adventure are `5c34991b` sequences 14 and 34. Covering it properly is
M7.8 known-answer work — a hand-authored artifact carrying a `pending_canon` row — because
no corpus fixture can force the Warden to choose that route.

**`turn02` joins `turn16-narrating-past-a-block` as a retired fixture**, and the two were
retired for different reasons worth keeping distinct: `turn16` was measuring the harness
(a `dice_request` the fixture itself seeded with a null target), while `turn02` measures
nothing at all. A fixture that grades the harness produces a wrong number; this one
produced no number.
