---
id: ADR-0038
title: M7.6 pool and character-state contract — resolved decisions
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: M7.6
summary: null
---

*Closing out `docs/plans/016-m7.6-character-sheet-fidelity-implementation-plan.md`,
whose D1–D4 were open when it was written. The reasoning lives in the plan; what
follows is what was actually built, plus what was deliberately left out.*

**D1 — `resourcePools` nests by owner, and ownership is unconstrained.**
`resourcePools[owner][poolName]`. Most owners are entity ids; pools belonging to
no entity take the reserved owner `_scenario`. No pools move to `scenarioState`,
which has no producer at all — `submitGmContextSchema.structured` has four
members and none is `scenarioState`, and play-time writes to undeclared keys are
rejected, so no key can enter it by any path that exists. Relocating live pools
into a write-only bucket would also have moved them out of the delta stream this
milestone exists to build: no `reason`, no `maxDelta`, no `sum(deltas)` audit
property, no per-pool rejection telemetry.

**D1-A.1 — `_scenario` is reserved by its leading underscore.** Entity ids may
not begin with `_`; reserved owners must. One narrow assertion enforces it —
reject an `_`-prefixed owner that is not a known reserved owner — on both write
paths. **General identifier-format validation is still not built anywhere**, and
is on the roadmap rather than here: enforcing format across entity creation,
synthesis and the tool boundary is its own change with its own failure modes,
and `_scenario` works as a convention whether or not collisions are prevented.

**D2 — `creationChoices.adjustedStat` records the class Stat choice.** The
Android's −10 and the Scientist's +5 land on a Stat the player picks, so without
it the acceptance criterion — rolls plus class arithmetic reconcile to each
starting ceiling — cannot be computed at all. It is the missing *input* to that
audit, not a second copy of a value living elsewhere, which is the same argument
that admits `creationRolls`. The schema requires it for those two classes and
rejects it for the other two.

**D3 — `stateChanges` gains `characterState`, and its five families stay
outside the delta stream.** Six operations discriminated on `op` — conditions
add/remove, armor damage, bleeding, pending Death Save, minimum stress — because
the sheet has no write path from a turn and a Panic result granting a Condition
would otherwise have nowhere to land.

**The exclusion is the half a later reader will need, and a schema alone does
not record it.** Bleeding, minimum stress and the pending Death Save are numeric
counters that change during play; each would fit the pool mechanism and would
inherit `reason`, in-order folding and rejection telemetry for free. They were
**identified as candidates and left out, not overlooked**. Nobody has asked to
audit a bleeding counter, and building an audit path for a hypothesis is the
thing this project does not do.

Two consequences, which are the price:

- **The M7.6 re-baseline measures nothing about `characterState`.** The
  rejection telemetry is per-pool. The milestone establishes a floor for
  pool-delta behaviour and no floor at all for these five families — including
  whether the Warden writes bleeding reliably. The one exception is the
  absolute-vs-delta count, in scope precisely because prompt instruction 3 is
  where the contract is inconsistent with itself.
- **Reversal trigger, stated because "if interest is expressed" never fires:** a
  playtest produces a bleeding, minimum-stress, or armor value nobody can
  explain. That is the same shape as the Strength question that motivated
  `reason`, and it will arrive in a playtest report rather than as a feature
  request.

**D4 — rejection is all-or-nothing per turn, and the fold runs on a working
copy.** `resourcePools` entries are folded in order against a running state, so
the wounds chain is expressible. A rejected entry aborts the whole array,
`characterState` aborts with it, and nothing is applied.

**The guarantee is validate-all-then-apply, and it is stronger than the
transactional one.** `validateStateChanges` accumulates across every
`stateChanges` member and returns one pass/fail; `SessionService` throws before
`applyValidatedTurn` runs; and when a correction round succeeds it is the
correction's applied set that is used, round one's being discarded entirely. So
nothing reaches the applier on rejection and transaction atomicity never comes
into it. Recorded rather than left implicit, per
`roadmap.md § Prerequisite — turn-path lock audit`: a guarantee that holds by
accident is one refactor away from not holding, and that item exists because
exactly this went unrecorded once already.

**Still open:** whether a pool rejection should also abort `entities`, `flags`,
`scenarioState` and `worldFacts`. It does not today, and there is a test
pinning that so the behaviour is visible rather than assumed.

**Payload field name: `owner`, not `entityId`.** The plan and the spec §2.1 both
write `entityId` on the pool-change entry. Both predate D1-A's amendment from
entity-keyed to owner-keyed, and a field named `entityId` that legally holds
`_scenario` contradicts itself in the document the model reads most carefully.
`characterState` entries keep `entityId`, where it really is one.

**Deferred and worth naming: `armor_repair`.** A Patch Kit sets a vaccsuit to
AP 1 and replacement swaps the item — both are equipment operations, and
equipment has no write path in M7.6. Armor can be damaged and destroyed this
milestone, never restored.

**Addendum — D4's granularity within an `entities` entry, stated because it was read as unstated.** Recorded 2026-08-21 while drafting `docs/specs/zoltar/019-entity-visibility-and-entity-write-path.md`, which first proposed applying the valid fields of a rejected entity change and was wrong to.

D4 settles rejection granularity *across* `stateChanges` members and says nothing about granularity *within* one entry, so `applyEntity`'s behaviour looked like an open question. It is not: **within-entry rejection is all-or-nothing by inheritance.** `validateStateChanges` returns one pass/fail, `SessionService` discards the entire `applied` set whenever `rejections` is non-empty and runs a correction round (`session.service.ts:377-406`), so applying the valid fields of a rejected entry would be unreachable code. Verified by direct call: an entity carrying a valid `visible` and an invalid `status` yields the rejection with `applied.entities` empty.

**What was genuinely wrong is reporting, not application.** `applyEntity` returned at the first invalid field without examining the rest, so a Warden told about `status`, fixing it, and failing on an unreported sibling received no second correction — the correction path is single-shot and the turn is thrown. With `status` the only rejectable field this was theoretical. Spec 019 adds `revealed` (monotonic) and `npcState` and rejects unknown ids, which makes an entry with two independently invalid fields ordinary. `applyEntity` now accumulates every field-level rejection before returning.

The distinction is worth keeping in mind wherever D4 is cited: *validate-all-then-apply* is a claim about what reaches the database, not a licence to stop validating once one thing has failed.
