---
id: ADR-0046
title: "`actingEntityId` must resolve against a declared identifier set, and an unresolvable id is undecided"
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: M7.5
summary: >-
  The `actingEntityId` namespace mismatch that inverted `system-rolled-player-action`
  and graded ten violations clean, plus the three rules drawn from it: name both
  namespaces in an identifier comparison, treat a resolution failure as a third state,
  and enforce one canonical id at runtime while the checker tolerates aliases. The
  amendment closes the product path and corrects two claims about the cause.
---

M7.5's first integration of `actingEntityId` compared it against `applicability.playerEntity` for equality. The field carries an entity **id** (`lt_alvarez`); `playerEntity` carries a display **name** (`Alvarez`). Nothing ever matched, and because "no roll belongs to the player" is `system-rolled-player-action`'s PASS condition, the check did not report *less* — it inverted. It graded ten violations clean, including a rep whose payload reads `system_generated` / `lt_alvarez` / `"Alvarez Combat Check to shoot contractor alpha"`. Full account in `docs/rules-extraction-findings.md § S30`.

Three rules come out of it, and they generalise past this field.

**An identifier comparison must name both namespaces.** The bug was not a typo; it was comparing two things that had never been the same kind of thing, in a codebase whose own convention (`ADR-0032`) makes ids and display names visibly distinct. `rollActsFor` now takes an explicit `AttributionContext` carrying `playerEntityIds`, `knownEntityIds`, and the display name for the legacy prose path, so the comparison cannot be written without stating which set is being consulted.

**A resolution failure is a third state, not a negative answer.** `rollActsFor` returns `'player' | 'other' | 'unknown'`. An id matching neither the declared player set nor the fixture's seeded entities is `'unknown'` — `NOT_APPLICABLE`, excluded from the denominator, never a pass. This is the same discipline as "Structural checks report undecided rather than guessing" above, applied to structured data rather than prose: the shipped bug's mechanism was a resolution failure silently collapsing into `'other'`. It is load-bearing, not defensive — Sonnet 4.6 emitted resource *pool* names in this field 13 times across one run.

**The runtime enforces one canonical id; the checker tolerates aliases.** `roll_dice` rejects an `actingEntityId` naming no known entity, modelled on the existing dangling-`gatedByRollId` rejection, with the valid ids named so the model corrects in-loop — and **skipped entirely when the known set is empty**, because `getPlayerEntityIds` reads `character_sheet` and a campaign without one would otherwise have every player roll rejected. The checker deliberately resolves against *every* declared id, because it also grades frozen artifacts from runs predating the validation that legitimately used an alias. The asymmetry is intentional and mirrors the prose fallback for pre-M7.5 payloads.

**Root cause, and what is still open.** The Warden is never told the player's entity id: `campaign_state.entities` holds NPCs, threats and features only, `gmContextBlob.playerEntityIds` exists for exactly this but is fed from a `character_sheet` table with zero rows, and `renderEntities` only *un-hides* ids already in the entities map — it is a filter override, not a source. So the model infers an id from resource pool names, which in the captured adventure carry two prefixes for one character. Seeding fixtures closes this for the eval; **the product path is not closed**, and rendering player entities into `<entities>` from `playerEntityIds` remains the real fix.

**Why the tests did not catch it.** All 60 structural specs passed throughout, because they pair `actingEntityId: 'alvarez'` with `playerEntity: 'Alvarez'` — the one id form that collides with the display name under `toLowerCase()`. The specs were written from the same misunderstanding as the implementation and were therefore not independent evidence. Regression tests now use the real captured id forms, taken from run artifacts rather than authored alongside the code.

**Amendment 2026-08-10 — the product path is closed; `<entities>` is a source now**

"Rendering player entities into `<entities>` from `playerEntityIds` remains the real fix" is done. `renderEntities` emits every declared player id whether or not `campaign_state.data.entities` carries it — which in practice is all of them, since that map holds NPCs, threats and features only — tagged `player_character` and listed first, so the canonical spelling is the first thing the block states. An id absent from the map reports `status=unknown`, the same value `buildEntityMap` gives every synthesized entity and the honest one here: nothing recorded a status. Live HP stays in `<resource_pools>`.

This changes the state snapshot and therefore the Warden prompt, so it invalidates `c45a142a` as a comparison point and forces a re-baseline. Tracked in `docs/eval-methodology.md § Current baseline N`.

**Two things the original paragraph got wrong, worth separating from what it got right.**

The diagnosis was right: the model had no id to read and inferred one from pool names. But the paragraph attributes the ambiguity it inferred *from* to a `character_sheet` table with zero rows, and that is the eval's condition, not the defect's cause. The duplicate prefixes were minted at synthesis time by a prompt that showed the model a display name and no `entityId` — they would have appeared in a campaign with a perfectly good sheet, because character creation writes `{entityId}_hp` while synthesis independently invents its own prefix. Zero rows explains why `playerEntityIds` was empty; it does not explain why the pools disagreed. That half is closed separately under `ADR-0036`, and the two fixes are independent: this one stops the Warden inferring an id, that one stops the state offering two to infer from.

The claim that seeding fixtures "closes this for the eval" also understates what the harness already does. `seedScratchAdventure` seeds exactly one `character_sheet` row from the *first* declared id, and `SessionService` overwrites the seeded blob's `playerEntityIds` with the repository's answer — so a fixture declaring `['lt_alvarez', 'alvarez']` has always resolved to one id at run time. The two-id declaration is read only by the checker, deliberately, per "the checker tolerates aliases" above. Fixtures therefore need no cleanup for this change to be safe; what they still carry is the duplicate *pools*, which is a separate open question about seeded state.
