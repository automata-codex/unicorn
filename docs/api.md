# API Specification

This document defines the Zoltar HTTP API surface for Phase 1. Tool definitions for the Claude integration live in `docs/tools.md`.

---

## Architecture: CQRS-Flavored Split

The API follows a CQRS-flavored pattern without formal CQRS infrastructure. The write path and read path are kept in separate NestJS modules and never share a controller.

**Command path (writes):** Player actions and administrative commands. The main command — submitting a player action — triggers the full GM pipeline: state snapshot construction, Claude API call, state change validation, DB write. Other commands are administrative: creating campaigns and adventures, transferring the caller role, reviewing pending canon.

**Query path (reads):** Serves the frontend directly from the database. No GM pipeline involvement. Message history, adventure state, campaign data, pending canon queue.

`@nestjs/cqrs` is not used — the separation is enforced by module boundaries, not a command/query bus.

---

## Conventions

**Base URL:** `/api/v1`

**Authentication:** Bearer token in `Authorization` header. Validated by `AuthService` on every request.

**URL structure:** Nested routing for owned resources (`/campaigns/:id/adventures`), flat for cross-cutting queries.

**Pagination:** Cursor-based for append-only collections (messages, game events). Offset-based for short bounded lists (campaigns, adventures). Cursor is a base64-encoded ID pointing to the last item received; pass it as `?before=<cursor>` to page backwards through history.

**Error envelope:**
```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Adventure not found"
  }
}
```

Standard error codes: `UNAUTHORIZED`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `INTERNAL_ERROR`, `GM_PIPELINE_ERROR`.

---

## Command Endpoints (Write Path)

### Campaigns

#### `POST /api/v1/campaigns`

Create a new campaign.

**Request:**
```json
{
  "name": "The Persephone Incident",
  "system": "mothership",
  "visibility": "private",
  "diceMode": "soft_accountability"
}
```

**Response `201`:**
```json
{
  "id": "uuid",
  "name": "The Persephone Incident",
  "system": "mothership",
  "visibility": "private",
  "diceMode": "soft_accountability",
  "createdAt": "2026-03-01T00:00:00Z"
}
```

---

#### `POST /api/v1/campaigns/:campaignId/members`

Invite a player to a campaign by email. Creates a `campaign_member` record. The invited user gets a `player` role; the campaign owner retains `owner`.

**Request:**
```json
{
  "email": "player@example.com"
}
```

**Response `201`:**
```json
{
  "campaignId": "uuid",
  "userId": "uuid",
  "role": "player",
  "joinedAt": "2026-03-01T00:00:00Z"
}
```

---

### Adventures

#### `POST /api/v1/campaigns/:campaignId/adventures`

Create a new adventure within a campaign. In Phase 1 this is always Solo Blind — oracle table selections are submitted here and synthesis begins.

**Request:**
```json
{
  "oracleSelections": {
    "survivor": ["corporate_spy", "traumatized_engineer"],
    "threat": ["unknown_organism"],
    "secret": ["company_knew"],
    "vesselType": ["mining_vessel"],
    "tone": ["slow_burn_horror"]
  },
  "ranges": {
    "survivors": 2,
    "threats": 1
  }
}
```

**Response `202`:** Adventure created, synthesis in progress. The response returns immediately; the adventure is not playable until `status` transitions to `ready`. Poll `GET /api/v1/campaigns/:campaignId/adventures/:adventureId` for status.

```json
{
  "id": "uuid",
  "campaignId": "uuid",
  "status": "synthesizing",
  "createdAt": "2026-03-01T00:00:00Z"
}
```

> **Note:** Synthesis is the one async operation in the write path. Everything else is synchronous. The frontend should poll or (in Phase 2 with Ably) subscribe for the `adventure.ready` event.

---

#### `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/messages`

Submit a narrative player action. Triggers the full GM pipeline — state snapshot construction, Claude call (with inner tool loop for `roll_dice` / `rules_lookup`), validator, correction pass if rejected, atomic turn write.

> **Note:** Phase 1 ships separate endpoints for the two action types — `POST /messages` for narrative and `POST /dice-results` for dice submissions (below). The unified `POST /actions` endpoint shown in earlier drafts of this doc is deferred; the shape on the wire is otherwise identical to what's specified here.

**Request:**
```json
{
  "content": "I try to access the ship's manifest on the terminal near the airlock."
}
```

**Response `200`:**
```json
{
  "message": {
    "id": "uuid",
    "role": "assistant",
    "content": "The terminal flickers to life...",
    "createdAt": "2026-03-01T12:00:00Z"
  },
  "applied": { "resourcePools": { "dr_chen_hp": { "current": 7, "max": 10 } } },
  "thresholds": [],
  "diceRequests": [
    {
      "id": "uuid",
      "notation": "1d100",
      "purpose": "Intellect save to interpret corrupted data",
      "target": null
    }
  ]
}
```

`diceRequests` is empty when Claude resolves the action without requiring a player roll. When present, the frontend shows the dice UI before the player can submit their next narrative action.

**Response `409 dice_pending`** — narrative submission is blocked while any `dice_request` for this adventure is still `pending`. Resolve outstanding prompts via `POST /dice-results` first.
```json
{
  "error": "dice_pending",
  "message": "Resolve the pending dice prompts before submitting a narrative action.",
  "pendingRequestIds": ["uuid", "uuid"]
}
```

Other error codes from this endpoint: `gm_correction_failed` (502), `gm_tool_loop_exhausted` (502).

---

#### `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/dice-results`

Player submits the result of a dice roll issued by a previous GM response. Resolves the referenced `dice_request`, writes a `dice_roll` event, and folds the outcome into the next narrative turn's prompt. Does **not** call Claude.

**Request:**
```json
{
  "requestId": "uuid",
  "notation": "1d100",
  "results": [47],
  "source": "player_entered"
}
```

`source` is `"system_generated"` when the client used the "Roll for me" button (executed via the shared `@uv/game-systems` parser, same code path as the backend's `roll_dice` tool) and `"player_entered"` when the player typed raw die faces.

**Response `200`:**
```json
{
  "requestId": "uuid",
  "accepted": true,
  "pendingRequestIds": []
}
```

`pendingRequestIds` lists remaining unresolved dice_requests for this adventure. The narrative input re-enables client-side when this array is empty.

**Error codes:**
- `409 dice_request_conflict` — unknown id, already resolved, or scoped to a different adventure.
- `422 dice_result_invalid` — notation mismatch vs. the persisted request, wrong number of results, or a result outside the per-die range.

---

#### `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/caller`

Transfer the caller role to another player. Caller-only endpoint.

**Request:**
```json
{
  "userId": "uuid"
}
```

**Response `200`:**
```json
{
  "callerId": "uuid"
}
```

---

#### `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/caller/claim`

Claim the caller role when the current caller is offline. Any campaign member may call this.

**Response `200`:**
```json
{
  "callerId": "uuid"
}
```

---

#### `PATCH /api/v1/campaigns/:campaignId/adventures/:adventureId`

Update adventure-level state. Used to end an adventure.

**Request:**
```json
{
  "completedAt": "2026-03-15T00:00:00Z"
}
```

**Response `200`:** Updated adventure object.

---

### Canon Review

#### `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/canon/:canonId/promote`

Promote a pending canon entry to the GM context blob. Reviewer-only (campaign owner, or designated overseer in Solo with Overseer mode — Phase 2).

**Response `200`:**
```json
{
  "id": "uuid",
  "status": "promoted",
  "reviewedAt": "2026-03-15T00:00:00Z"
}
```

---

#### `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/canon/:canonId/discard`

Discard a pending canon entry. Logged but never written to GM context.

**Response `200`:**
```json
{
  "id": "uuid",
  "status": "discarded",
  "reviewedAt": "2026-03-15T00:00:00Z"
}
```

---

## Query Endpoints (Read Path)

### Campaigns

#### `GET /api/v1/campaigns`

List campaigns the authenticated user is a member of.

**Response `200`:**
```json
{
  "campaigns": [
    {
      "id": "uuid",
      "name": "The Persephone Incident",
      "system": "mothership",
      "visibility": "private",
      "diceMode": "soft_accountability",
      "createdAt": "2026-03-01T00:00:00Z"
    }
  ]
}
```

---

#### `GET /api/v1/campaigns/:campaignId`

Get a single campaign.

**Response `200`:** Campaign object.

---

#### `GET /api/v1/campaigns/:campaignId/state`

Get the current campaign state blob, validated against the system Zod schema.

**Response `200`:**
```json
{
  "campaignId": "uuid",
  "system": "mothership",
  "schemaVersion": 1,
  "data": { }
}
```

---

### Adventures

#### `GET /api/v1/campaigns/:campaignId/adventures`

List adventures for a campaign, most recent first.

**Query params:** `?limit=20&before=<cursor>`

**Response `200`:**
```json
{
  "adventures": [
    {
      "id": "uuid",
      "campaignId": "uuid",
      "status": "active",
      "mode": "freeform",
      "callerId": "uuid",
      "createdAt": "2026-03-01T00:00:00Z",
      "completedAt": null
    }
  ],
  "nextCursor": "base64string"
}
```

---

#### `GET /api/v1/campaigns/:campaignId/adventures/:adventureId`

Get a single adventure including current mode and caller.

**Response `200`:** Adventure object. Includes `status: 'synthesizing' | 'ready' | 'completed'` derived from whether `gm_context` exists and `completed_at` is set.

---

#### `GET /api/v1/campaigns/:campaignId/adventures/:adventureId/messages`

Get message history and pending dice prompts for an adventure. Cursor-based, most recent first. Used as the play-view bootstrap — the frontend renders the message log and, when `pendingDiceRequests` is non-empty, drops the user into the `DicePrompt` before the narrative input.

**Query params:** `?limit=50&before=<cursor>`

**Response `200`:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "role": "gm",
      "content": "The terminal flickers to life...",
      "createdAt": "2026-03-01T12:00:00Z"
    }
  ],
  "pendingDiceRequests": [
    {
      "id": "uuid",
      "notation": "1d100",
      "purpose": "Intellect save to interpret corrupted data",
      "target": null
    }
  ],
  "nextCursor": "base64string",
  "rollingSummary": "The crew boarded the Persephone and discovered..."
}
```

`pendingDiceRequests` is empty in the normal case (no outstanding rolls). When a user left the play view mid-roll, the prompt persists server-side and is surfaced here on reload so the FE can re-render the `DicePrompt` without losing state.

`rollingSummary` is included so the frontend can display it at the top of the message log as context for history that has aged out of the window. Still null through Phase 1 (see `docs/decisions.md`).

---

#### `GET /api/v1/campaigns/:campaignId/adventures/:adventureId/canon`

Get pending canon entries for review.

**Query params:** `?status=pending` (default), `?status=promoted`, `?status=discarded`

**Response `200`:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "summary": "The Ironteeth goblin lieutenant held position rather than pursuing.",
      "context": "Emerged during room 7 combat when the fighter withdrew.",
      "status": "pending",
      "createdAt": "2026-03-01T12:00:00Z"
    }
  ]
}
```

---

### Character Sheets

#### `GET /api/v1/campaigns/:campaignId/character-sheet`

Get the authenticated user's character sheet for a campaign.

**Response `200`:**
```json
{
  "id": "uuid",
  "system": "mothership",
  "schemaVersion": 1,
  "data": { }
}
```

---

## GM Pipeline: Orchestration Sequence

When `POST /adventures/:id/actions` is received:

```
1.  Validate request — authenticated, caller matches callerId, adventure is active
2.  Write player action to game_events (sequence_number = max + 1)
3.  Write player message to messages table
4.  Fetch GM context blob from gm_context (cached prompt candidate)
5.  Fetch current campaign state snapshot from campaign_state
6.  Fetch last N kb of messages from messages table
7.  Construct Claude prompt:
      [GM context blob]
      [State snapshot]
      [Last N kb of messages]
      [Current player action]
8.  Call Claude API with tool: submit_gm_response
9.  Claude calls submit_gm_response — backend receives structured output
10. Validate proposed state changes against pool definitions and campaign_state
11. If rejections: re-prompt Claude once with a tool_result describing them
12. Apply validated state changes to campaign_state (single transaction)
13. Write player_action, gm_response (+ correction if applicable), state_update events
14. Write proposed_canon entries to pending_canon (auto-promote in Solo Blind)
15. Write gm_updates.npc_states and notes to gm_context blob
16. Write final corrected GM response to messages table
17. Write adventure_telemetry row keyed to the gm_response sequence_number
18. Return { message, applied, rejections, thresholds } to frontend
```

**On validation failure (step 10):** Claude is re-prompted once with a `tool_result` describing the rejections (step 11). If the correction also fails validation, the turn aborts with 502, `campaign_state` is unchanged, and only the `player_action` event persists. On a successful correction, the rejected `gm_response` event is logged with `superseded_by` pointing to the correction event; only the corrected `playerText` reaches the `messages` table.

**On Claude API failure:** Return `GM_PIPELINE_ERROR`. The player action remains in the event log. The frontend should surface a retry affordance.

**Phase 2+ pipeline additions** (not numbered in the M6 flow, return in later milestones):
- LOS computation — per-turn visibility filter over `grid_entities` when the spatial system ships.
- Rolling summary — fetch into prompt construction and update after the turn; deferred per `docs/decisions.md`.
- Tool-use inner loop — Claude may call `roll_dice` / `rules_lookup` zero or more times before `submit_gm_response` (M7).
- Initiative mode flips and `advance_initiative` handling (M8).
- Caller transfer handling on `submit_gm_response` (M8).

---

## Phase 2+ Additions

Endpoints not yet defined, to be added when the relevant phase begins:

- `PUT /api/v1/campaigns/:campaignId/character-sheet` — update character sheet data
- `GET /api/v1/campaigns/:campaignId/adventures/:adventureId/grid` — grid cell and entity state for renderer (Phase 3)
- `POST /api/v1/campaigns/:campaignId/adventures` — Solo Authored and Collaborative creation modes (Phase 2)
- WebSocket / Ably subscription shape for real-time push (Phase 2)
- Private action endpoint (Phase 2)
- Caller request endpoint (Phase 2)
