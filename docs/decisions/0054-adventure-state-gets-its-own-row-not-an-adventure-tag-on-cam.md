---
id: ADR-0054
title: Adventure state gets its own row, not an adventure tag on campaign state
area: api-data-model
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Given the placement rule above, adventure-scoped state has to be separable from
campaign-scoped state. Two shapes were available: tag each entity and pool entry in
`campaign_state.data` with the adventure it belongs to, or give adventures their own
state row with its own per-system Zod schema, mirroring `campaign_state`.

**Decided: a separate row.** Tagging makes the boundary a convention that every query and
the snapshot builder must remember to honour, and the two state defects this project has
actually hit were both exactly that failure. The `lt_alvarez` / `alvarez` incident was a
flat map plus a preserve-on-conflict merge, where the safety mechanism is what let the
duplicate through (`ADR-0036`, amendment). The `<character_attributes>` block sat deferred for two
milestones past its own stated trigger because nothing structural was watching
(`ADR-0049`, second amendment). A separate row makes scope structural rather than
remembered, gives the adventure lifecycle a natural place for cleanup, and bounds a blob
that is read on every turn and would otherwise grow without limit across a long campaign.

**What it costs, stated rather than glossed:** two Zod schemas per system instead of one,
two write paths, and a snapshot builder that merges two sources. That is real, and it is
the price of not relying on every future caller to remember a tag.

**Not implemented in Phase 1.** See the addendum to `ADR-0053`
above — the single-adventure constraint is what makes deferring the implementation safe
rather than merely postponing it. This entry records the terminal shape now so that the
Phase 2 migration is written against a decided target rather than choosing one under
pressure.

**Addendum — the Phase 2 relocation spans both state buckets, because ownership and scope
are orthogonal**

The entry above decides the terminal shape without naming what moves into it. The obvious
reading — that `scenarioState` is the adventure-scoped bucket and `resourcePools` the
campaign-scoped one — is wrong, and worth writing down before it becomes a working
assumption.

**The two axes are independent.** `resourcePools` versus `scenarioState` is a distinction
of *ownership*: per-entity numerics versus non-entity numerics
(`campaign-state.schema.ts:26`). Campaign versus adventure is a distinction of *scope*, per
`ADR-0026`. They cross:

| | Entity-owned | Not entity-owned |
|---|---|---|
| **Campaign-scoped** | player character pools | — |
| **Adventure-scoped** | synthesized threat and NPC pools | station power, countdown timers |

**Both cells of the bottom row sit in campaign state today**, because the adventure row
does not exist yet. A synthesized threat's HP is in `resourcePools` and a hull-breach timer
would be in `scenarioState`, and both die with the adventure that produced them. Neither is
campaign state by the rule; they are there because there is nowhere else.

**So Phase 2 relocates all of `scenarioState` *and* a subset of `resourcePools`** — the
owners synthesis created — while player-character owners stay. The adventure row will need
both an owned and an unowned bucket, for the same reason campaign state has both.

**M7.6 leaves a clean handle for that.** Under D1-A, `resourcePools` nests by owner and
unowned pools take the reserved owner `_scenario`
(`docs/plans/016-m7.6-character-sheet-fidelity-implementation-plan.md` D1). The Phase 2
migration then moves whole owner keys rather than classifying individual pools: `_scenario`
and every synthesis-created owner go to the adventure row, player owners stay. That is a
bucket move per owner, not an inference per key — which matters, because the inference is
exactly what the M7.6 verification pass could not do reliably. Of six non-resolving pool
keys examined, two were ambiguous and one (`android_memory_integrity`) turned out to have
an entity referent after being classified as not having one.

**A related fact, recorded because it is the mechanism behind the defect this entry
addresses:** nothing anywhere resets `entities`, `flags`, `scenarioState`, or `worldFacts`
between adventures (`docs/plans/m7.6-code-inventory.md` @ `e1cdaac`). The single-adventure
constraint in `ADR-0053` (addendum) is what keeps that from
mattering before Phase 2.

**Not settled here.** `entities` mixes recurring NPCs with synthesized threats and needs
per-entry classification. `flags` and `worldFacts` are unexamined. And whether
`scenarioState` should continue to exist at all is open: under D1-A an unowned pool works
fine in `resourcePools`, and `scenarioState` has no producer at synthesis
(`submitGmContextSchema.structured` has four members and none is `scenarioState`), so it is
`{}` in every fixture and every dump. It may be a bucket whose purpose was superseded
before it was ever filled.
