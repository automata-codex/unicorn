---
id: ADR-0045
title: "`rollType` / `gatedByRollId` / `actingEntityId` on `roll_dice` stay deferred, but they are measurement infrastructure"
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Closed — the three `roll_dice` fields landed in M7.5 on the schedule this entry set;
  the title is the original question, not the outcome. Records what `gatedByRollId`
  and `actingEntityId` bought the checks waiting on them, that `rollType` never had a
  measurement role, and a provenance note on a reversal that was itself reversed.
---

> **Status: closed 2026-08-07.** The fields landed in M7.5, on the schedule this entry set.
> The heading is kept in its original wording because several documents link to it by title;
> read it as the question, and the "Landed" section below as the answer.

These three fields were introduced in the M7.4 spec as a fixture-schema compatibility example and carried forward as a candidate structural fix for the Warden's own sequencing — tighten the tool schema so a dependent roll must name its gate, and out-of-order resolution becomes unrepresentable rather than merely detectable. That framing is incomplete. The checker audit established that the same two fields are what two structural checks need in order to *measure* anything at all:

- `gatedByRollId` — `out-of-order-resolution` can adjudicate the deferred-gate case from a pending `dice_request`, but the in-turn case is undecidable without it. Sequence numbers record what happened first, not what gated what.
- `actingEntityId` — `system-rolled-player-action` cannot attribute a Warden-side roll without it, because `actorType` is `'gm'` for every such roll whether it stands in for an NPC or the player, which is exactly the distinction the check draws. The current binding is a prose convention and is the last prose dependency in the structural checks.

So the fields are not only a possible fix; they are the precondition for knowing whether a fix is needed. Until they land, both checks report `not_applicable` naming the missing field rather than approximating it with a regex — the deliberate cost being denominator, per "Structural checks report undecided rather than guessing" below.

**Still deferred**, and the reason is unchanged: adding fields to `roll_dice` changes the tool schema, which changes what reaches the Warden, which invalidates every frozen artifact and forces a fresh baseline on both models. That is affordable once, not repeatedly, and the rules-ingestion work is already going to force one — both existing baselines ran against an empty `rules_chunk` index. Re-check after M7.5, and land the fields with that re-baseline rather than paying for a second one. (The re-baseline moved from M7.2 to M7.5; M7.2 populated the index but deliberately bought no Warden-level measurement.)

**Landed 2026-08-07, in M7.5, exactly as this entry planned.** Schema and prompt together, ahead of the re-baseline, so the fields ride the one baseline the populated index was already forcing rather than buying a second. `docs/tools.md § roll_dice` documents all three.

What they bought, on the two checks that were waiting:

- `gatedByRollId` — `out-of-order-resolution` now decides the in-turn case by comparing a named gate's sequence number against the roll naming it. See `ADR-0079` above for the three sub-cases and for the deferred-gate residual this does *not* close.
- `actingEntityId` — `system-rolled-player-action` attributes without reading `purpose`. This was the last prose dependency in the structural checks; on post-M7.5 output there is none left. **The first integration of this field was defective and shipped a false pass — see the entry immediately below, which is a correction to this bullet, not a footnote on it.**
- `rollType` — **no measurement role, and none was invented for it.** The entry above claims all three were "the precondition for knowing whether a fix is needed"; that was true of the other two and never of this one. Checked during M7.5 planning: it appears in `docs/specs/zoltar/011-eval-harness-multi-run.md § Part 6` only as a *hypothetical example* of a field some future check might need, is absent from the M7.4 spec entirely, and the two bullets above give it no job. It ships as a descriptive enum (`check` / `save` / `damage` / `panic_check` / `table` / `other`) read by no checker — telemetry and a reporting axis. The justification is this entry's own economics rather than a requirement: the re-baseline was being bought anyway, and discovering a use for it later would have meant buying another.

The prose paths are kept rather than deleted, and every consumer branches on field **presence** rather than on `fixtureSchemaVersion` — `eval:rescore` re-grades frozen `88fa84bd8329` artifacts that predate the fields, and version-gating would have been the obvious mechanism and the wrong one, since the fixture version records what `capture-fixture` captured and it captures no game events at all. **No `FIXTURE_SCHEMA_VERSION` bump was needed**, and no migration: `dice_roll` payloads are `jsonb`.

**Provenance note.** During M7.2 implementation planning this conclusion was briefly reversed — a plan document recorded "resolved with Alex: the fields do not ride along, a third baseline gets paid for separately" — and instructed that this entry be rewritten to match. That rewrite never happened here. The reversal was itself reversed during M7.5 spec review: the fields land with M7.5's re-baseline, per the original reasoning above, which was correct throughout. Noted so the now-stale reasoning in that plan document isn't mistaken for a second, independent decision.
