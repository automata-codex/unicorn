# M5 — Claude API Client & Prompt Assembly: Implementation Plan

Phased implementation plan for `docs/specs/zoltar/m5-prompt-assembly.md`.
Each phase is sized for a manual code review and a single commit. Pause after
each phase for review before starting the next.

---

## Phase 1 — Documentation Alignment

Pure docs. No code changes. Lands the "Documentation Corrections" section and
the Deferrals-section doc updates in one reviewable commit so the rest of the
plan implements against corrected specs from the start.

**Documentation Corrections (from spec §"Documentation Corrections"):**

- `docs/tools.md` — in the `submit_gm_response` → `stateChanges.entities`
  section, drop the `position` subfield and add `status: z.string().optional()`
  to match the spec's corrected shape.
- `docs/zoltar-design-doc.md` — "State snapshot" section: replace the
  `flagTriggers` bullet with the revised wording in the spec ("original flags'
  triggers are cached; only play-introduced flags re-emit triggers").
- `docs/zoltar-design-doc.md` — "Message History and Context Window" section:
  reduce the prompt structure from four parts to three
  (`[GM context blob] → [state snapshot] → [last N kb of messages]`), remove
  the rolling-summary paragraph and its summarization-guidance text.

**Deferrals-section updates (from spec §"Deferrals"):**

- `docs/decisions.md` — add a rolling-summary deferral entry mirroring the
  spatial-system deferral in structure (rationale, what's deferred, reactivation
  trigger, artifacts kept around — namely the `adventure.rolling_summary` column
  staying null through Phase 1).
- `docs/roadmap.md` — strike the rolling-summary line from the M5 bullet.

**Review gate:** doc text matches spec wording, no stray references to
`position` in `submit_gm_response`, rolling-summary language consistently
removed across all three docs. Commit.

---

## Phase 2 — Frontend Router Migration (Part 0)

Self-contained frontend change. Install `svelte-spa-router`, replace the
homegrown router, preserve parity with the current application.

- `cd apps/zoltar-fe && npm install svelte-spa-router@^5`.
- Create `apps/zoltar-fe/src/routes.ts`. **Note:** the spec's illustrative route
  table omits routes that currently exist; preserve all of them. The full list
  should cover:
  - `/` and `/campaigns` → `CampaignList`
  - `/signin` → `SignIn`
  - `/dev/components` → `DevComponents`
  - `/campaigns/:campaignId` → `CampaignDetail`
  - `/campaigns/:campaignId/characters` → `CharacterView`
  - `/campaigns/:campaignId/characters/new` → `CharacterCreate`
  - `/campaigns/:campaignId/characters/edit` → `CharacterEdit`
  - `/campaigns/:campaignId/oracle` → `OracleFilter`
  - `/campaigns/:campaignId/adventures/:adventureId` → `AdventureSynthesis`
  - `*` → `NotFound` (create a minimal page if one doesn't exist)
- Rewrite `App.svelte` to `<Router {routes} />`; keep the existing nav-bar,
  loading screen, sign-out button, and auth-guard effects, but source the
  current path from `svelte-spa-router`'s `location` store (or equivalent)
  instead of the custom `route` store.
- Remove `apps/zoltar-fe/src/lib/router.svelte.ts` (the custom store/navigate
  helper) and every import of `navigate` / `route` from it. Replace `navigate`
  call sites with `push` from `svelte-spa-router` across all pages and
  components.
- Update page components that currently parse `campaignId` / `adventureId` from
  the URL (`CampaignDetail`, `CampaignList`, `CharacterCreate`, `CharacterView`,
  `CharacterEdit`, `OracleFilter`, `AdventureSynthesis`) to receive them via
  the `params` prop pattern from the spec:

  ```svelte
  let { params }: { params: { campaignId: string } } = $props();
  ```

- Re-implement the two auth-guard `$effect` blocks against the new location
  store (redirect unauthenticated users to `/signin`, and redirect authenticated
  users away from `/signin`).
- Sanity-check every page loads under a hash URL (`/#/campaigns`,
  `/#/campaigns/:id/adventures/:id`, etc.). Note: not adding a `/play` route —
  that's M6.

**Review gate:** every previously-reachable page reachable under hash URLs, no
dead imports of the old router, auth-guard redirects still work, `tsc --noEmit`
passes. Commit.

---

## Phase 3 — `submit_gm_response` Schema, Tool, and Snapshot Builder

Pure type + pure function work, no HTTP or DB. Ideal standalone review.

- Scaffold the `apps/zoltar-be/src/session/` module directory with the file
  layout from the spec; empty `session.module.ts` shell (imports
  `DrizzleModule`, `AnthropicModule`) that will be filled in Phase 5.
- `session.schema.ts`: `submitGmResponseSchema` verbatim from the spec. Note:
  `stateChanges.entities` is `{ visible?, status? }` — no `position`.
- `session.tools.ts`: `SUBMIT_GM_RESPONSE_TOOL` via `zodToJsonSchema` with
  `$refStrategy: 'none'`, exported alongside `SESSION_TOOLS` array. Do not
  register `roll_dice` or `rules_lookup` — they are M6.
- `session.snapshot.ts`: pure `buildStateSnapshot({ gmContextBlob,
  campaignStateData })` function. Implementation follows spec §"Part 2":
  - Visibility elision: drop entities where `visible = false`, always keep the
    player's own character entities.
  - Flag trigger re-emission only when the flag key is absent from
    `gmContextBlob.structured.flags`.
  - Deterministic alphabetical ordering within each block.
  - Omit empty blocks entirely (no empty tags).
  - Format rules per field from the spec.
- Two spec gaps to flag rather than implement:
  - The spec's `<character_attributes>` block has no data source in the current
    schema. Omit the block in M5; see the "Character Attributes Block" entry
    in `docs/decisions.md` for the deferral rationale.
  - Pool thresholds and timer notes (the `(thresholds: ...)` / ` — {note}`
    suffixes in `<resource_pools>`) depend on `PoolDefinition` metadata that
    doesn't exist in `@uv/game-systems` yet. Emit only `{key}: {current}/{max}`
    until definitions land.
- Small M4 carry-in: extend `buildGmContextBlob` in
  `apps/zoltar-be/src/synthesis/synthesis.write.ts` to persist
  `structured: { flags }` in the blob so the snapshot builder can distinguish
  original flags from play-introduced ones. Update the matching test.
- Unit tests:
  - `session.schema.spec.ts`: valid payloads parse; representative invalid
    shapes (extra `position`, malformed flags union) reject.
  - `session.snapshot.spec.ts` covering the cases listed in spec §"Testing":
    empty state → no tags; hidden entity elided; player entity always present;
    visibility toggle between snapshots; flag trigger emission only for
    play-introduced flags; deterministic ordering across permuted input;
    `max: null` produces no `/{max}`.

**Review gate:** schema matches spec byte-for-byte, snapshot output format
matches spec's XML example, tests cover spec's listed cases. Commit.

---

## Phase 4 — Anthropic `callSession`, Prompt Assembly, Message Window

Still pure/outbound logic, fully unit-testable with Anthropic mocked. No DB
writes, no endpoint wired.

- Extend `AnthropicService` with `callSession(params: CallSessionParams)`.
  `callMessages` stays as-is; `callSession` is additive. Reuse
  `DEFAULT_SYNTHESIS_MODEL` (`claude-sonnet-4-6`), default `max_tokens: 4096`.
- `session.prompt.ts`:
  - `formatGmContextBlob(blob)` — serialize structured GM context into
    human-readable text covering narrative, entities, flags (value + trigger),
    initial state. `openingNarration` last or omitted.
  - `WARDEN_SYSTEM_PROMPT_MOTHERSHIP` constant — Warden-role system prompt text.
  - `buildSessionRequest({ gmContextBlob, campaignStateData, windowMessages,
    playerMessage })`: assembles two-block `system` (GM context first with
    `cache_control: ephemeral`, Warden prompt second with no cache marker),
    messages array starting with snapshot as the first user message followed
    by the window then the new player message, and `tool_choice: { type:
    'tool', name: 'submit_gm_response' }`.
- `session.window.ts`: `MESSAGE_WINDOW_MAX_BYTES = 40 * 1024` constant and
  `buildMessageWindow(messages, maxBytes?)` walking backward from newest and
  measuring via `Buffer.byteLength(JSON.stringify(msg), 'utf8')`. Include a
  single oversized message anyway and log a warning.
- Unit tests:
  - `session.window.spec.ts`: empty input; chronological order preserved;
    threshold respected; single-oversized message included with warning.
  - `session.prompt.spec.ts`: system blocks ordered correctly with
    `cache_control` only on the GM context block; first user message carries
    the snapshot; `tool_choice` forces `submit_gm_response`; window messages
    appear between snapshot and new player message in chronological order.

**Review gate:** prompt structure matches spec §"Part 4", cache control placement
correct, window algorithm handles edge cases, Anthropic mocked throughout.
Commit.

---

## Phase 5 — Messages Endpoint, Repository, and Service Wiring

Final wiring. HTTP layer + orchestration + DB reads/writes (messages table
only — no state mutation, no canon, no events, no telemetry).

- `session.repository.ts` — reads only: `gm_context.blob`, `campaign_state.data`,
  adventure by id (for status + mode), message history for the adventure
  ordered ascending. Plus two writes: insert player message, insert GM message.
  Follow the repository-pattern feedback already captured in project memory —
  no Drizzle calls in the service.
- `session.service.ts` — orchestrates the flow from spec §"Part 6":
  1. Load context, state, adventure, messages.
  2. Build message window.
  3. Persist the player message (`role = 'user'`).
  4. Assemble prompt via `buildSessionRequest`.
  5. Call `AnthropicService.callSession` with forced tool choice.
  6. Extract the `tool_use` block for `submit_gm_response` — throw if absent.
  7. Validate against `submitGmResponseSchema` — throw on parse failure.
  8. Persist `playerText` as a new `messages` row with `role = 'assistant'`.
  9. Return `{ message, proposals }`.
- `session.controller.ts` + `session.module.ts`:
  - `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/messages`.
  - Auth + campaign-membership check.
  - Request schema: `{ content: z.string().min(1) }`.
  - Precondition: `adventure.status === 'ready'` → 409 otherwise.
  - Response shape exactly as spec: `{ message, proposals }`.
  - Error mapping: Anthropic SDK errors → 502 (log adventure id); tool-call
    extraction failure → 502 (log raw response, do not persist GM message);
    schema validation failure → 502. Note: the player message is already
    persisted by the time errors can occur — spec calls this out as
    intentional.
- Register `SessionModule` in `AppModule`.
- Integration tests (`session.controller.spec-int.ts`) against the test DB
  with `AnthropicService.callSession` mocked:
  - Happy path: POST a message, assert player + GM messages persist, response
    payload matches `SubmitGmResponse` shape.
  - No side effects: `campaign_state.data` byte-identical to pre-call,
    `pending_canon` unchanged, `game_events` unchanged.
  - Precondition 409: adventures in `synthesizing` / `failed` / `completed`
    reject with 409.
- Unit tests for `session.service.ts` covering the three error branches
  (Anthropic error, missing `tool_use`, invalid schema) and verifying the
  player message is persisted even when the GM message is not.

**Review gate:** full turn round-trips against the test DB, no state mutation
beyond the two messages rows, error paths behave per spec, `tsc --noEmit`
passes. Commit.

---

## Out of scope for this plan

Per spec §"Out of Scope for M5": state-change application, `pending_canon`
runtime routing, `game_events` / `adventure_telemetry` writes, `roll_dice` /
`rules_lookup` tool registration, correction mechanic, frontend play view,
caller model, spatial system, rolling summary. All of these are later
milestones.
