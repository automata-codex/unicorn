---
id: ADR-0051
title: Narrative and dice-result submissions are separate endpoints, not a discriminated union under `POST /actions`
area: api-data-model
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Why narrative and dice submissions ship as `/messages` and `/dice-results` rather
  than a discriminated union under `/actions`: the two diverge on Claude invocation,
  response shape, failure modes and resource semantics, so a union reconciles the
  request bodies and nothing else. Names the endpoint count that would justify
  revisiting.
---

Earlier drafts of `docs/api.md` specified a single `POST /api/v1/campaigns/:id/adventures/:id/actions` endpoint with a discriminated-union request body: `{ type: 'narrative', content } | { type: 'diceResult', requestId, notation, results, source }`. The M7 implementation ships two separate endpoints instead: `POST /messages` for narrative turns and `POST /dice-results` for dice submissions. `docs/api.md` has been updated to match what actually ships; this entry records why.

The two operations turned out to diverge on every substantive axis — different Claude-invocation behaviour (narrative always calls, dice only when `autoAdvance` resolves the last pending request), different response shapes (turn payload vs. resolution metadata with an optional nested turn), different failure modes (`dice_pending` vs. `dice_request_conflict` / `dice_result_invalid`), different resource semantics (a GM turn vs. a resolution of a specific `dice_request`). A discriminated union would reconcile the request bodies but not the responses; the FE still branches on `type` to know what to render, so the union is ceremony rather than simplification.

Two endpoints with distinct error codes also self-document failure modes better than one endpoint with a union of error shapes. The controller already shares the turn-error translator (`translateTurnError`) and the `SendMessageResult → TurnPayload` serializer (`serializeTurn`) across both paths, so there is no duplication to amortize by merging the URLs.

The tradeoff accepted here: if M8 adds further player actions (caller transfer, advance initiative), those will live at their own nouns (`/caller`, `/initiative`, etc.) rather than being bundled under `/actions`. This is acceptable — the surface area stays small per endpoint, each gets its own test file and failure taxonomy, and the alternative (growing a union-typed action endpoint) would accumulate branch complexity inside one handler faster than it accumulates URL count. Revisit if the endpoint list becomes genuinely unwieldy (> 8–10 player-action endpoints) or if M8's caller/initiative work surfaces tight coupling that a unified endpoint would simplify.
