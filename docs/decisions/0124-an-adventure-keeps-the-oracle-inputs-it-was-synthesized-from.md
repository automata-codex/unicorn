---
id: ADR-0124
title: An adventure keeps the oracle inputs it was synthesized from, written before synthesis runs
area: api-data-model
status: accepted
superseded_by: null
milestone: M7.9
summary: >-
  Decided 2026-10-16. A synthesis request's oracle draws, the filter they were
  drawn from, and the addendum were validated, used, and then stored nowhere.
  They now go in a nullable JSONB column, `adventure.synthesis_inputs`, with
  both the draws the player sent and the selections that reached Claude, which
  differ when the coherence check rerolls. They are written by
  `SynthesisService.prepareSynthesis` after the coherence check passes and
  before Claude is called, so an adventure whose synthesis fails keeps them
  too. A coherence conflict writes nothing.
---

## The problem

`POST .../synthesize` validates the player's oracle selections, checks them for
coherence, and hands them to Claude. Nothing stores them. Once the adventure
exists there is no way to recover what it was built from: which entries were
drawn, which the player had switched off, what the addendum said, or whether
the coherence check substituted a category. The last of these appears only in
a debug log line.

The steered playtest is the immediate reason. An adventure created without
this loses the data for good.

## What was decided

**One nullable JSONB column on `adventure`, `synthesis_inputs`** (`V21`). It
holds:

- `drawnSelections`: the selections the player sent.
- `finalSelections`: the selections synthesis ran on. It differs from
  `drawnSelections` only when the coherence check rerolled a category, so
  comparing the two is the reroll record.
- `activeEntryIds`: the filter, per category.
- `addendum`, or null.

Each selection is the full oracle entry, not its id, so an edit to the oracle
tables in `@uv/game-systems` cannot change what a stored adventure says it
started from.

**It is written before synthesis runs, not with its result.**
`SynthesisService.prepareSynthesis` runs the coherence check and then writes
the inputs, all before the 202. The controller makes that one call; the write
is in the service and the query in `SynthesisRepository`. A retry after a
coherence conflict overwrites the earlier record, because the inputs that
matter are the ones synthesis ran on. A conflict itself writes nothing, since
no adventure is built from those inputs.

## Alternatives

**Columns on `adventure_synthesis_snapshots`.** That table already holds an
adventure's starting conditions, and was the obvious home. But its row is
written inside `writeGmContextAtomic`, after synthesis succeeds. An adventure
whose synthesis fails would lose its inputs, and a failure is when they are
most wanted.

**Write them in the controller.** Declined: the controller should handle the
API, and the service already owns the coherence check that decides what the
final selections are.

**Store entry ids only.** Smaller, but an id resolves against whatever the
oracle tables say today, not what they said when the adventure was made.

## What would reverse it

- A second game system whose selections are not shaped like Mothership's.
  The column would then need a system tag or a version field, which it does not
  have yet.
- A need to query the inputs across adventures. JSONB on `adventure` is fine
  for reading one adventure's record and poor for anything relational.
