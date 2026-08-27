---
id: ADR-0043
title: "`rules_lookup` calls are captured in `adventure_telemetry.payload.rulesLookups`, not in `game_events`"
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Why `rules_lookup` calls land in `adventure_telemetry.payload` rather than
  `game_events`: they are metadata about how the Warden reached a ruling, not state
  changes, and the event log is player-visible and bound to a sequence-number
  contract. Records what the telemetry record keeps and why full chunk text is
  deliberately omitted.
---

Every `roll_dice` call writes a `dice_roll` row to `game_events` — dice are mechanically consequential, part of the turn's audit trail, and rolls (like player actions and GM responses) carry sequence numbers so the full turn can be replayed from the event log.

`rules_lookup` calls are different in kind. They are metadata about how Claude arrived at a ruling, not state changes. The player is not entitled to see every query the Warden made; the tool is a reasoning aid. Recording lookups in `game_events` would (a) pollute the player-visible event stream with Warden internals, (b) require inventing a "lookup" actor_type / payload shape for data that never affects state, and (c) couple the lookup-telemetry schema to the game_events sequence-number contract for no operational benefit.

Instead, `rulesLookups: RulesLookupRecord[]` lives in `adventure_telemetry.payload` alongside the turn's prompt snapshot, Claude request/response metadata, and validator output. Playtest review tooling (M7.1) reads from that row and can surface lookups — including empty-result ones, which are the primary signal for M7.2 ingestion prioritization — without touching the event log.

The record carries `query`, `limit`, `resultCount`, `topSimilarity`, and `sources` (citation strings). Full chunk text is deliberately omitted: re-running the query at review time reproduces the chunks deterministically until the index is re-ingested, and storing them inline would bloat the telemetry JSONB without marginal benefit. If Phase 2 review surfaces a need for full-text capture, a `texts: string[]` field can be added.
