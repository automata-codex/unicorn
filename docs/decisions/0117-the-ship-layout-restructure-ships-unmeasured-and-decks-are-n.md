---
id: ADR-0117
title: The `ship_layout` restructure ships unmeasured, and decks are numbered top-down
area: claude-continuity-spatial
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  `ADR-0101`'s addendum recommended restructuring `worldFacts.ship_layout` from prose
  into a deck-indexed list, and `ADR-0104` required the measurement come first. Both
  happened. The measurement could not detect an effect either way, and the restructure
  is kept anyway — on the argument that a form-only change costing nothing needs a
  reason to revert rather than a result to justify it. Also fixes deck numbering
  top-down as a standing convention, inverting the one example already in the corpus.
---

## What was decided

**The restructure landed on twenty fixtures and the synthesis prompt**, in the
form `ADR-0101`'s addendum described: a line naming the overall shape and the
numbering convention, one line per deck, and the connections between decks on
their own line. Corpus `301302000143` → `d651cec51ad7`, input-affecting.

**Four decisions rode with it**, recorded here because
`docs/eval-findings.md § S42`–`§ S45` are measurements and this file is where
decisions live.

## Decks are numbered from the top down, and this is a standing convention

`DECK 1` is topmost. The familiar name stays alongside the number — `DECK 2
(mid)` — because the fiction uses both and the judge needs to map narration onto
the layout.

**This inverts the only worked example already in the corpus.**
`5c34991b`'s `station_spatial_layout` — synthesis-generated, and the thing that
demonstrated the target shape was reachable by the existing prompt — numbers
`DECK 0` lower and `DECK 1` upper. Those fixtures are out of scope here and keep
their convention, so **the corpus now carries both**. That is survivable because
each layout states its own convention in its first line, and it is the reason
the synthesis prompt now states the rule explicitly: without it, generation
coin-flips the direction per adventure and the inconsistency spreads.

Top-down was chosen because it is what the maintainer reads naturally and
because "two decks up" from `DECK 3` resolving to `DECK 1` is arithmetic either
way. The in-corpus precedent was the stronger argument for bottom-up and it lost
to that.

## No within-deck adjacency was added

The station example chains rooms with `→` because its source prose establishes a
corridor order. Neither ship's prose does. Adding arrows would have invented
canon the fixtures never had, which is a change to the seeded *facts* rather than
to their *form* — and form-only is the whole claim the measurement rested on.
Verified by content-word comparison across both values: nothing lost, nothing
added but the numbering convention.

## No Warden prompt clause rode along

The Warden prompt contains no occurrence of `worldFacts`, `layout`, `spatial` or
`deck`. So this improves the form of data the Warden is never instructed to
consult, which is a real gap — and adding the instruction would have moved
`promptHash` and made the run attribute two changes at once. Kept single-variable
deliberately. **If the restructure is ever shown not to help, the clause is the
next arm, not evidence that layout form does not matter.**

## The station fixtures are out of scope

The thirteen `turn*` fixtures carry `station_spatial_layout` and
`station_layout_overview` — a hub-and-spoke topology on two levels, not a deck
stack. Restructuring them is a different change against a different shape and
belongs to its own item. Their artifacts stayed valid through this bump, which
is the practical benefit of having scoped them out.

## The restructure is kept although the measurement failed to detect anything

`§ S42` pre-registered the comparison, `§ S43` captured two fixtures to give it
headroom, and `§ S44` scored it: **not one per-fixture movement was
distinguishable from sampling noise**, every Fisher *p* ≥ 0.31. The intervention
is unmeasured — not confirmed, not refuted.

**Kept anyway, on three grounds.** It is form-only, so keeping it costs nothing
and reverting costs another input-affecting bump. The control held and no
tripwire failure implicates it, so the side-effect question — the one thing the
run *did* settle — came back clean. And the failure rationales show the Warden
reasoning in the new vocabulary, citing deck numbers, which is at least evidence
the shape is legible to it.

**What would reverse this.** A run with enough power to show the restructure
made things worse, or a diagnosis that the multi-line value is implicated in
something — the tool-syntax leak rate was the obvious candidate and `§ S45`
excluded it. Absent either, this stays.

**What must not be inferred.** `ADR-0101`'s addendum recommended this change on
reasoning, and that reasoning is not validated by anything here. Anyone citing
the restructure as a demonstration that prose layouts cause deck-lookup errors
is citing an argument, not a result.

## Considered and rejected

- **Several `worldFacts` keys rather than one multi-line value** —
  `ship_layout_upper_deck` and siblings. `renderWorldFacts` sorts keys
  alphabetically, so a three-deck stack would render `lower`, `mid`, `upper`:
  a vertical topology emitted in an order that is not the topology, which is
  worse than the paragraph for exactly the lookup that fails. One key also keeps
  the `judgeContext` renderer and its golden untouched.
- **Deferring until after the next playtest.** The measurement was the reason to
  act early — `ADR-0104` names the hazard of landing it in the same batch as the
  fixtures — and the pre-existing corpus would only have grown more entangled.
- **Buying a properly powered run first.** `§ S44` puts that at roughly 74 reps
  per arm. The restructure is free to keep and free to revert; spending that
  before shipping a form-only change inverts the cost of being wrong.

## Cost

Twenty fixtures across two adventures, one line each. An **input-affecting**
corpus bump, so every frozen artifact for those twenty is void as evidence and
no rescore substitutes — the bump note is in
`docs/eval-methodology.md § Bump note — 2026-08-31, ship_layout restructured`.
`promptHash` and `assemblyHash` are unmoved. The synthesis prompt's change is
invisible to the harness, since the corpus replays turns and no eval command
exercises synthesis; it changes what the next adventure generates, and its
golden was regenerated.
