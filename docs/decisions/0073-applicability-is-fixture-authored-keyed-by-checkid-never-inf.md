---
id: ADR-0073
title: Applicability is fixture-authored, keyed by `checkId`, never inferred from the turn's own output
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Applicability moves out of 'did this turn produce a `dice_roll`?' — selection on the
  outcome variable, which had shrunk two checks to 2 decided reps out of 40 — and into
  a fixture-authored `applicability` map keyed by `checkId`. Records why it is keyed
  rather than nested under `assertion`, and why `capture-fixture` stubs it
  fail-closed.
---

`system-rolled-player-action` and `out-of-order-resolution` originally decided applicability by asking "did this turn produce a `dice_roll` event?" — a consequence of the model's own choice, not a property of the fixture's scenario. When the correct behaviour was declining to roll (deferring to a pending `dice_request` instead), the harness scored the turn as `not_applicable` rather than as a pass, silently shrinking the denominator to exactly the reps where the model happened to roll — selection on the outcome variable. Confirmed against a real Sonnet 5 run: 38 of 40 reps across the two checks read `not_applicable` for this reason, and the two reps that didn't were themselves a false pass — a system-rolled to-hit roll the old pattern-only rule didn't match.

The fix adds `applicability: Record<checkId, {applies, playerEntity?, situation}>` to `evalFixtureSchema` (`FIXTURE_SCHEMA_VERSION` 1 → 2), authored once at fixture-capture time rather than derived at eval-run time from `campaignState` or the presence of any event. Keyed by `checkId`, not nested under `assertion` or flat on the fixture, because `selectChecksForFixture` already models "a fixture may carry more than one check" — turn19/turn21 exist as separate fixture *files* per tag today, but the schema shouldn't assume that stays true. `playerEntity` on the `applies: true` branch also replaces `system-rolled-player-action`'s old `campaignState.resourcePools`-key-guessing heuristic for identifying "the player" — the fixture author already knows who the player is.

Checks that need this declare `requiresFixtureSchema: 2` (the field existed, unused, since M7.4 anticipated exactly this situation) so a fixture below that version reports `not_applicable` through `runCheck`'s existing gate rather than a checker guessing or crashing. `capture-fixture` writes a fail-closed placeholder (`applies: false`, TODO reason) for every newly captured fixture, matching the existing `playerInput`/`assertion` placeholder convention — an unedited stub can never silently read as "situation confirmed."

`out-of-order-resolution` is only half-migrated: situation gating is real, but the in-turn ordering case needs a `gatedByRollId` the payload does not record, so the check reports `not_applicable` with a reason naming the missing field rather than the old model-artifact phrasing. An earlier version of this paragraph proposed extending turn19/21 through the follow-up turn to recover that evidence; that proposal is withdrawn — see "`out-of-order-resolution` reads the deferred gate, and declines the in-turn case" below.
