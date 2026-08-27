---
id: ADR-0110
title: Dice are stored as they fell; the 0-indexed table offset is applied at lookup
area: architecture-backend
status: accepted
milestone: M7.7
superseded_by: null
summary: >-
  Dice are stored as they fell and the 0-indexed table offset is applied at lookup, in
  one place, so a recorded roll still means what the player saw on the table.
  `trinket` and `patch` have carried the same 1-based roll since M7.6: a convention to
  establish going forward rather than a bug to repair, since nothing reads those
  tables.
---

**Convention decided 2026-08-20, shipped 2026-08-21 as spec 018 Part 3.**

**The mismatch.** Mothership's creation tables — loadout, trinkets, patches — are indexed
`00`–`09` or `00`–`99`. `executeDiceRoll` is not: `dice.ts:57-64` returns
`randomInt(sides) + 1`, so `1d10` yields 1–10 against a table whose first row is `00`.

**Decision: store the dice as they fell and apply the `-1` at lookup time.** Two reasons,
both about keeping one convention rather than two:

- It preserves the dice-as-they-fell property that `creationRolls` is built on. A recorded
  roll means what the player saw on the table.
- It keeps the offset in one place rather than at every roll site.

**Shipped.** `tableIndexForRoll` (`packages/game-systems/src/dice.ts:88-95`) owns the offset
and throws on a die result below 1. `executeDiceRoll` is untouched. `loadout` joins `trinket`
and `patch` in `creationRolls` as the one optional roll, since a sheet written before the
field existed cannot retroactively acquire a roll nobody made.

**Consequence for `trinket` and `patch`.** Both have carried the same 1-based roll since
M7.6, and because the player reads those tables themselves the offset has never been applied
by anything. This is therefore a convention to establish going forward, not a bug to repair
on those two. See [[0109-trinket-and-patch-tables-are-not-repaired]], which is why nothing
in the app reads them.
