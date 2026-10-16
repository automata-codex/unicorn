---
id: ADR-0121
title: The backend works out routes from a place list, and the Warden asks for them
area: claude-continuity-spatial
status: accepted
superseded_by: null
milestone: M7.10
summary: >-
  Decided 2026-10-11. `ADR-0047` deferred a structured spatial model until
  playtests showed prose layout breaking down, and named the failures to watch
  for. They happened, and six attempts to fix them by giving the Warden more to
  read did nothing measurable. A prototype that has the backend work the route
  out and hand it over took three failing cases from 13 of 29 to 27 of 29
  (`eval-findings.md § S77`). Phase 1 therefore gets a place list written at
  synthesis, each character's position held as one of those places, and a
  deterministic route tool. It is a list of rooms, not the grid, which stays
  with the Phase 3 renderer.
---

## The problem

**`ADR-0047` chose prose layout as a deferral under uncertainty, and said what
would end it:** "contradictory room connections, forgotten deck assignments,
layout drift across long sessions". The 2026-08-24 playtest produced the second
and third, five times in 52 turns (`ADR-0101`, addendum of 2026-08-25).

**The errors are few per turn and they stick.** A wrong deck narrated once is
repeated on every later turn, because the Warden follows its own earlier
narration over anything in the snapshot (`eval-findings.md § S51`, `§ S57`).
The maintainer, 2026-10-11: "it really hurts immersion for me when the narration
doesn't match the map I've constructed in my head."

**Giving the Warden more to read did not help.** Six attempts, none shown to
move question 1:

| Attempt | Finding |
|---|---|
| `ship_layout` restructured from prose into a deck list | `§ S44` |
| A movement rule in the prompt | `§ S49` |
| A position seeded as a world fact | `§ S57` |
| The snapshot reordered, headed and named in the prompt | `§ S65`, `§ S73` |
| A position fact with the prompt naming it | `§ S75` |

Each left the route for the Warden to work out. `§ S75` also showed
`ADR-0101`'s warning about a Warden-authored position in one turn: two of four
writes replaced a correct value with the history's wrong one.

## What was decided

**The backend works the route out, and the Warden asks for it.** Three parts:

- **A place list, written at synthesis.** The adventure's places as data, each
  with what the backend needs to say how to get from one to another. On the
  Halbrecht that is thirteen rooms and the deck each is on.
- **Each character's position, as one of those places.** The backend holds it.
  The Warden names a destination and never supplies the start.
- **A route tool.** The Warden calls it before narrating a move and is handed
  the route: a walk, or which way and how far by which connection. It is
  ordinary code with no model in it, tested like `roll_dice`.

**It is a list of rooms, not the grid.** It can say which room and how to get
there. It cannot say where in a room someone is, or who can see whom. Every
error recorded on question 1 is a room-and-route error. `grid_cell`,
`grid_entity` and line of sight stay where the design doc has them, with the
Phase 3 renderer.

**The evidence is one prototype run.** `eval-findings.md § S77`: turns 08, 14
and 18, 27 of 29 passing against 13 of 29, by the same judge on both sides.
The Warden called the tool in 28 of 29 narrated reps and followed the answer in
all 28. On turn 18, where its own history puts the berth on the wrong deck, all
ten narrations followed the tool.

**Why this worked when the snapshot did not is an inference.** The Warden
follows results it has just asked for, as it does with `roll_dice`, and the
answer is the last thing it reads before it writes. Nothing has tested that
explanation apart from the result.

**It is built before M8, as M7.10.** A replayed turn cannot show whether a
position stays right over a session. A playtest can, and playtests are the
scarce thing. Built before M8, M8's own playtest does that job, with several
characters in different places.

## Alternatives

**Keep trying prose and state.** Six attempts are above. The pattern across
them is the reason to stop, more than any one result.

**Build the grid now.** It answers everything this does and more. It needs a
generated map of cells, which is the Phase 3 map pipeline, and nothing observed
so far needs to know a square.

**A lookup with no stored position**, where the Warden names both ends of the
trip. Smaller, and not ruled out: on turn 18 the Warden knew where Danny was
and had the berth's deck wrong. It is not chosen here because the retraction
cases (`§ S53` to `§ S59`) lost where Danny was, and a Warden-supplied start is
the thing `ADR-0101` warns about. The spec may still reduce to it if a run
shows the stored position adds nothing.

**Leave it for Phase 2 or 3.** UVG is a point-crawl and would give a place list
a second user. Declined because Phase 1's target is a playable solo adventure
and this is its largest known defect.

## What would reverse it

- Synthesis cannot write a place list that is right. A wrong list makes the
  tool wrong every time, though in one line of data that can be read and fixed.
- The position cannot be kept right over a session.
- In a playtest the Warden stops calling the tool, or calls it and narrates
  something else.
- The tool's wording keeps turning up in the prose and cannot be written out.
  `§ S77` saw "same deck, no ladder needed" in many narrations. A fix for
  immersion that reads like a tool talking has not fixed it.

## Left to the spec

- Where the position is stored. The prototype used a world fact because that
  needed no schema change.
- What a place carries beyond a name, so that the list is not ship-shaped. A
  deck is one adventure's idea of a level.
- NPC positions, and how they fit `ADR-0101`'s rule that position is the one
  thing withheld structurally. Six prototype reps asked about an NPC first.
- Whether the player sees their own location in the play view.
- Distances stated in dialogue with nobody moving. Both fails in `§ S77` are
  this, and no call covers it.
- The amendment to `docs/zoltar-design-doc.md § Spatial Model`, and the
  roadmap's "omits entity position fields" line on the snapshot builder.

## Costs, accepted

**One more model round-trip on every turn where someone moves.**

**A second thing synthesis can get wrong**, beside `ship_layout`, which stays
as the description the Warden narrates from.

**Multiplayer waits one milestone longer.**

**The prototype's code is not on `main`.** It is commit `c30b2b0` on the
`route-tool` branch, taken back off before merging because its place list is
one ship's, written by hand.

## Addendum — no M8 playtest; a closing playtest does its job

Recorded 2026-10-16. "It is built before M8" counted on M8's multi-PC playtest
to show that positions stay right over a whole session. `ADR-0122` moved that
milestone to Phase 2. The session-length check now falls to the closing
steered playtest in M12. That playtest has one character instead of several, so a
party split across places is not tested before Phase 2.
