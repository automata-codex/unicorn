---
id: ADR-0050
title: Message ordering relies on `createdAt` only; no shared sequence key with `game_events`
area: claude-continuity-spatial
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The `messages` table has no `sequence_number` column, unlike `game_events`. Reconstruction and message-window ordering (`buildMessageWindow`) rely purely on `createdAt` timestamps. Player and GM messages for the same turn are not written in the same transaction — the player message commits first, in its own transaction, before the GM call runs (intentionally, so a retry can reproduce the player's action) — so there is no transactional guarantee of ordering either, only the practical guarantee that a player's message is always written before the GM's response to it.

This is adequate today and is not being changed. The current production shape — a single backend instance, self-hosted, solo async play with human-paced turns seconds-to-minutes apart — has essentially no exposure to ordering ambiguity: Postgres timestamp precision is far finer than the gap between any two real messages, and there is only one clock in play.

Two conditions would change that:

- **Multi-instance deployment** (Phase 3+ SaaS, per the stateless-scaling design), if `createdAt` values are ever assigned application-side (each Node process reading its own clock) rather than DB-side. Cross-instance clock skew becomes a live vector for inverted ordering only once there's more than one clock generating timestamps.
- **Synchronous multiplayer with tight timing** (Phase 2 — Ably, live typing preview, initiative-mode combat), where sub-second sequencing might actually matter for narrative correctness in a way solo async play never surfaces.

Deferred under uncertainty, consistent with the project's general bias against fixing failure modes that haven't been observed. Revisit — adding a per-adventure sequence key to `messages`, mirroring `game_events`' existing `(adventureId, sequenceNumber)` pattern — if or when multi-instance deployment or synchronous multiplayer work begins, rather than before.
