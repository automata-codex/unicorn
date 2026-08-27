---
id: ADR-0049
title: The `<character_attributes>` snapshot block is specified but deferred until a data source exists
area: claude-continuity-spatial
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  The `<character_attributes>` block was specified with nothing to populate it. Two
  amendments have overtaken the body: the static stats/saves slice was never actually
  blocked, and the qualitative half's own reactivation trigger had already fired with
  nothing watching. Both landed in M7.6, not the M8.1 this entry last scheduled.
---

The M5 spec, the design doc's state-snapshot section, and the M5 roadmap bullet all reference a `<character_attributes>` block — persistent qualitative character state (armor mode, weapon loadout, active conditions) emitted in the per-turn snapshot. The M5 snapshot builder has no source to populate this block from: `MothershipCampaignState` carries no `characterAttributes` field, synthesis does not write one, and the Mothership character sheet shape (`equipment: string[]`, `saves.armor: number`) does not cleanly separate armor from loadout or carry conditions. The block is omitted in M5 per the spec's "omit an entire block if its source is empty or missing" rule.

This is not a question of whether the concept is right — it clearly is, and the design doc describes it correctly. The question is *what writes it*. Populating the block requires either a schema addition plus a synthesis write path, or a derivation from character-sheet data that would require extending the character-sheet shape to separate armor/loadout/conditions. Neither is load-bearing for M5's goal of closing the outer GM turn loop; all mechanically critical state lives in resource pools, entities, flags, and world facts.

The block becomes genuinely useful when the game engine starts reading armor/conditions mechanically — that's M6 (state-change application of condition toggles) or M7 (roll resolution that consults armor). Reactivate at the milestone that first needs the data. At that point the schema, the write path, and the snapshot rendering can be designed together against concrete usage, rather than guessed at now.

The three doc references stand unchanged — they describe the intended end state. The M5 snapshot builder simply does not render this block. When the data source lands, the builder is a two-line addition (one render function, one call site) following the same pattern as the other blocks.

**Amendment — the deferral scope was too broad; static build data was never blocked**

This entry conflated two different claims under one deferral: the qualitative `characterAttributes` block (armor mode, loadout, conditions), which genuinely lacks a data source, and character-sheet *build* data — stats, saves — which does not. `character_sheets.data` already carries `Strength`/`Speed`/`Intellect`/`Combat` and the saves as structured fields, populated at character creation (see `ADR-0036`), and rendering them into the snapshot requires no schema addition and no synthesis write path — only a render function and a call site, the same shape already anticipated above for the qualitative block.

"Reactivate at the milestone that first needs the data" was the intended trigger, and for this narrower slice it already fired: Phase 1 has no rule evaluator, so Claude adjudicates every stat check itself, and without these fields in the snapshot its only source for the check target is the player stating their own stat in the action text — the system asking the player for data the system already has. That gap has existed since M6/M7 started resolving checks, not from some future milestone.

Scheduled for M8.1. The qualitative block — armor mode, loadout, conditions — remains deferred exactly as described above; it is the part that actually needs new schema and a character-sheet shape extension to separate armor/loadout/conditions.

**Amendment — the deferral is over; both slices move to M7.6, and the blocker was never independent**

Superseding the two paragraphs above: the qualitative block is no longer deferred, and neither slice is scheduled for M8.1. Both now sit in **M7.6 — Character Sheet Fidelity**, ahead of the playtest.

The reasoning that closed the deferral is that its blocker was never a standalone problem. This entry describes the obstacle as a character-sheet shape that "does not cleanly separate armor from loadout or carry conditions" — and correcting that shape is exactly the goal of the character-creation rework already carried on the kanban board, which reworks the application-level sheet data structures and plausibly the table shape with them. So the "schema addition and character-sheet shape extension" this block has been waiting on since M5 is not a future batch to be scheduled against; it is work already committed to for independent reasons. Grouping them makes the block's dependency explicit instead of leaving it as an open-ended wait.

This also lets the entry's own closing instruction be followed literally. It asks that "the schema, the write path, and the snapshot rendering can be designed together against concrete usage, rather than guessed at now" — impossible under the M8.1 scheduling, whose charter is prompt-only and which would have forced the render and the schema into different milestones. M7.6 owns schema, so all three land together.

Two corrections to the amendment above, for the record. Its trigger analysis was right about the narrow slice and stopped short: **the qualitative block's trigger had also already fired.** "Reactivate at the milestone that first needs the data — that's M6 (state-change application of condition toggles) or M7 (roll resolution that consults armor)" names two milestones that have both shipped. The block was not waiting on a trigger; the trigger fired and nothing was watching. And the claim that the static slice needs "no schema addition" holds only against today's sheet — once the rework moves the stats/saves fields, that render reads whatever shape it settles, which is why M7.6 orders the rework first and the two renders after.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.
