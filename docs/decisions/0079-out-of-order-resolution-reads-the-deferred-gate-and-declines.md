---
id: ADR-0079
title: "`out-of-order-resolution` reads the deferred gate, and declines the in-turn case"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Why `out-of-order-resolution` reads a pending `dice_request` as a structural gate,
  and the three sub-cases the checker keeps distinct so none collapses into a false
  pass. The in-turn half closed when `gatedByRollId` landed; the deferred-gate
  branch's known false FAIL is pinned by a test rather than patched, and the two-turn
  fixture idea is withdrawn.
---

> **Status: the in-turn half closed 2026-08-07**, when `gatedByRollId` landed in M7.5. Title
> kept for the links that point at it; the resolution is inline below. The deferred-gate
> branch's known false FAIL is *not* closed.

A *pending* `dice_request` is an unresolved gate as a matter of structure: the backend surfaces it and the turn ends waiting on it, so anything resolved on the player's behalf while it sat pending was resolved ahead of its gate. That replaces `CONDITIONAL_DAMAGE_PATTERN`, the second regex this checker had tried, which failed the way prose matchers here always do — it flagged *NPC* damage rolls that were never gated by the player's request, on 4 of `turn19`'s 10 reps, which is most of why that fixture read 0/9.

When the turn resolves its gating roll in-turn instead, the check reported `not_applicable` naming the missing `gatedByRollId`. Sequence numbers show what happened first, not what depended on what; a to-hit followed by damage is correct and the reverse is not, the same two events either way, separable only by a link the payload does not record. Adjudicating that by regex is what the check was doing and what it stopped doing.

**Resolved 2026-08-07 (M7.5).** `gatedByRollId` landed, and the in-turn branch now decides: a roll whose named gate carries a *higher* sequence number than the roll itself had its consequence resolved before the thing it was contingent on. Two sequence numbers and a reference, nothing inferred from wording. The wait was the right call — the field cost one milestone of `not_applicable`, where each of the two regexes that preceded it cost a wrong verdict nobody could see.

Three sub-cases, kept distinct because collapsing any two of them re-creates a false pass:

- **No roll declares a gate** — `not_applicable`, and a *different* `actualCode` from the pre-M7.5 "the field doesn't exist" case, so an exclusions table never aggregates "nothing depended on anything" together with "we couldn't tell".
- **A `gatedByRollId` resolves to no roll in the turn** — `not_applicable`, never a pass. The tool loop rejects dangling references before they can persist, so this should be unreachable; it is pinned by a test anyway, because "found no violation" is exactly how an unresolvable link would otherwise read.
- **Otherwise** — a real PASS or FAIL.

**Extending `turn19`/`turn21` through the follow-up turn does not recover the missing half, and the idea is withdrawn wherever this log proposed it.** The reasoning that produced it was that a model deferring a to-hit across a turn boundary puts the ordering evidence outside the captured turn. But the violation window *is* the captured turn: a deferred gate ends the turn, so any dependent roll on the follow-up turn is after the gate resolved by construction. A two-turn fixture would therefore pass structurally no matter what the Warden did, and the pass would look like evidence of correct sequencing. The in-turn case waits on the schema field; it does not wait on a longer fixture.

A known false FAIL is accepted and pinned by a `[known limitation]` test rather than patched: a player stress check triggered by NPC fire that already resolved is properly ordered but structurally identical to a pre-rolled damage roll — both GM-initiated, both without `requestId`, both after the gate in sequence. It costs 1 of 18 decided reps. **M7.5 did not close this one**, and it is worth being precise about why: `gatedByRollId` records which *roll* gated a roll, while this branch asks whether a roll was gated by a pending *request*. Different link, still unrecorded. The available discriminators are notation (1d10 vs 1d100) and purpose wording, and reaching for either would re-import the "works on the data in front of me" failure that produced the regex being removed. A false FAIL also names the offending roll in the report, so it is diagnosable; the alternative readings risk a false PASS, which is not.
