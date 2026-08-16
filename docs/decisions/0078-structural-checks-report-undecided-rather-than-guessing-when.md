---
id: ADR-0078
title: Structural checks report undecided rather than guessing when a prose dependency fails
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

`isAttributedTo` — binding a roll to the acting entity by the Warden's leading-name convention — is the last prose dependency in the structural checks, and it is not removable: nothing in `game_events` records who acted, and `actorType` is `'gm'` for every Warden-side roll whether it represents an NPC or the player, which is exactly the distinction being drawn. It waits on an `actingEntityId` on the roll payload.

What was fixable is how it fails. A prose match failing to match is indistinguishable from the thing genuinely being absent, and the two carry opposite verdicts, so `system-rolled-player-action` treated "no roll named the player" as a pass. It now reports `not_applicable` when nothing binds *and* unattributable system-side rolls are present. Measured across both frozen runs this costs 2 of 40 reps — both on `turn21` under 4.6, where they were that fixture's only two passes against seven fails — and leaves Sonnet 5 untouched at 1.00/0.80, because a model that properly issues `dice_request`s hits the structural branch instead. Costing a denominator is the point: a rep whose verdict rests on a prose match having failed is not evidence, and counting it as one is how a rate reaches 1.00 without the behaviour improving.

The same audit found that binding a `dice_request` by prose was simply wrong. A request is player-facing by construction — `roll_dice` is documented for GM rolls, `diceRequests` for player-facing ones — so a pending request is a deferred player roll whatever its purpose text says. A manually-verified clean turn had been failing because it deferred correctly with a request that never named the player, which a request addressed *to* the player has no reason to do.
