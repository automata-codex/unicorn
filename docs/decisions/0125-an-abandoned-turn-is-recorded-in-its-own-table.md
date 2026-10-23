---
id: ADR-0125
title: A turn abandoned by the tool loop or an unrecoverable leak is recorded in its own table, not in adventure_telemetry
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: M7.9
summary: >-
  Decided 2026-10-23. A turn that exhausts the tool loop or ends in
  SessionToolSyntaxError used to leave only a log line. It now writes a row to a
  new table, `abandoned_turn` (`V22`), with a `reason`, the adventure's highest
  event sequence number at the time as `after_sequence_number`, and a payload
  holding the lookups with their scores, the discarded rolls, and any leaks.
  `adventure_telemetry` is unchanged, so no reader of it can mistake a failed
  turn for a finished one. Spec 029.
---

## The problem

`adventure_telemetry` has one row per finished turn, keyed by
`(adventure_id, sequence_number)`, where the sequence number is that of the
turn's `gm_response` event. A turn abandoned by `SessionToolLoopError` or
`SessionToolSyntaxError` writes no events, so it has no sequence number. It
wrote no row at all, and its rules lookups, with the scores that tell retrieval
failing from the Warden over-asking, were lost (`rules-extraction-findings.md
§ S82`).

## What was decided

**A new table, `abandoned_turn`:** `adventure_id`, `reason` (text),
`after_sequence_number`, `payload` (JSONB), `created_at`. Spec 029 has the
columns and the payload.

**`after_sequence_number` is the adventure's highest `game_event` sequence
number when the row is written**, or 0. It places the failure between turns.
It is not unique.

**`reason` is text with a TypeScript union**, so a later reason needs no
migration.

**The row is written by the service and rethrows the original error.** A
failed write is logged and does not replace that error.

## Alternatives

**A nullable `sequence_number` in `adventure_telemetry`, with an outcome field
in the payload.** One table, but every reader has to learn a new kind of row.
`latestGmContextHash` orders by sequence number descending, and Postgres puts
NULLs first, so it would pick the failed turn every time.

**A `turn_failed` game event, to give the turn a real sequence number.** The
row would then fit the existing key. But it puts an event that changes nothing
into the log that replay and state reconstruction read, which is a much wider
change than the problem.

**Reusing the previous turn's sequence number.** That collides with the unique
index.

## What would reverse it

- Failed turns needing to read in sequence with finished ones routinely. A view
  over both tables comes first. Merging the tables only makes sense if the view
  is not enough.
- A `turn_failed` event becoming wanted for its own sake, such as showing the
  player that a turn was lost. Then that event's sequence number is the natural
  key and this table's `after_sequence_number` is redundant.
