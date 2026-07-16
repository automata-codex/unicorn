# M6 — GmService & State Management: Implementation Plan

Multipart implementation plan for `docs/specs/zoltar/m6-state-management.md`.
Each part is sized for a manual code review and a single commit. Pause after
each part for review before starting the next.

Terminology note: "part" here means a unit of this plan. The M6 spec itself is
also organized into 10 parts (Part 1 … Part 10), and the project roadmap uses
"Phase" for top-level project phases (Phase 1, Phase 2+). The plan's parts
below map onto spec parts; where a plan part cross-references a spec part it
is written as "spec Part N" to keep the two namespaces distinct.

---

## Part 1 — Documentation Corrections

Pure docs. No code changes. Lands the "Documentation Corrections" section from
the spec so later parts implement against corrected references from the start.

- `docs/api.md` — rewrite the post-`submit_gm_response` numbered step list
  (steps 12–21) to match the M6 flow in the spec. LOS (step 6), rolling summary
  (steps 7, 22), caller transfer (step 21), and initiative (step 20) references
  move into Phase 2+ commentary (project phase, not a plan part), not numbered
  in the M6 sequence.
- `docs/zoltar-design-doc.md` — in the "No undo" section, replace the
  `superseded_by` bullet with the revised wording covering validator
  rejections alongside rules-review corrections (spec §"Documentation
  Corrections → zoltar-design-doc.md").
- `docs/tools.md` — no changes (spec confirms tool schema work landed in M5).

**Review gate:** doc text matches spec wording. No stray references to
deferred work (LOS, rolling summary, caller transfer, initiative) inside the
M6 numbered sequence. Commit.

---

## Part 2 — Pool Definitions (spec Part 1)

Self-contained package addition. Lands the `@uv/game-systems` bits the
validator will import in Part 3.

- Create `packages/game-systems/src/mothership/pool-definitions.ts` with:
  - `PoolDefinitionSchema` Zod shape (`min`, `max`, `thresholds[]`).
  - `PoolDefinition` type.
  - `HP_DEFINITION`, `STRESS_DEFINITION`, `DEFAULT_DEFINITION` constants.
  - `getMothershipPoolDefinition(poolName: string): PoolDefinition` resolver
    using the `_hp` / `_stress` suffix rules.
- Create `packages/game-systems/src/mothership/pool-definitions.spec.ts`
  covering every case in spec §"Part 1 → Tests":
  - `dr_chen_hp` → HP definition with threshold at 0.
  - `vasquez_stress` → stress definition with `min: 0`.
  - `reactor_integrity` → permissive default.
  - `_hp` edge case (whole name is the suffix).
  - `PoolDefinitionSchema.parse` rejects non-integer threshold `value`.
- Export from `packages/game-systems/src/index.ts` barrel.

Do **not** introduce a per-system registry in this part — the spec explicitly
defers that until a second system lands.

**Review gate:** unit tests green. `tsc --noEmit` passes on
`@uv/game-systems`. Spot-check that only the three constants and the resolver
are exported, no premature registry scaffolding. Commit.

---

## Part 3 — State Change Validator (spec Part 2)

Pure function over a parsed `SubmitGmResponse` + current `campaign_state.data`.
No DB access, no NestJS dependencies.

- Create `apps/zoltar-be/src/session/session.validator.ts`:
  - Export types: `ValidationRejection`, `ThresholdCrossing`,
    `ValidationResult` (the shapes in spec §"Part 2 → Contract").
  - Export `validateStateChanges({ proposed, currentData, poolDef })`.
  - Walk the proposed maps in insertion order (determinism note in spec).
  - Implement the five per-field rule blocks from the spec:
    - `resourcePools` — bootstrap on positive delta for unknown pools, reject
      on negative delta for unknown pools, reject when `min: 0` pool would go
      below zero, compute threshold crossings after application.
    - `entities` — bootstrap absent entities with defaults, merge provided
      fields over existing, revalidate `status` against `EntityStatusSchema`.
    - `flags` — require trigger on new flags; on existing flags, ignore any
      provided trigger (immutable per `docs/DECISIONS.md`).
    - `scenarioState` — reject unknown keys; overwrite `current` on known keys
      while preserving `max` and `note`.
    - `worldFacts` — always apply verbatim.
- Create `apps/zoltar-be/src/session/session.validator.spec.ts` covering every
  bullet in spec §"Part 2 → Tests" (unknown-pool bootstrap/reject, spend below
  zero rejection, HP threshold fire, entity-status accepted without
  auto-zeroing, flag-without-trigger reject, scenarioState key-missing reject,
  worldFacts always applied, mixed batch partial success).
- Do **not** wire the validator into `SessionService` yet — that happens in
  Part 9.

**Review gate:** unit tests green; validator is pure (no imports from
`@nestjs/common`, the repository, or the Anthropic SDK). Rejection reason
strings read as Claude-facing copy, not developer diagnostics. Commit.

---

## Part 4 — State Change Applier + Repo Write (spec Part 3)

Small, self-contained. Depends on the `ValidationResult['applied']` type from
Part 3.

- Create `apps/zoltar-be/src/session/session.applier.ts` with
  `applyToCampaignState({ currentData, applied })`. Shallow merge semantics per
  spec. Pure function, does not mutate input, preserves `schemaVersion`.
- Create `apps/zoltar-be/src/session/session.applier.spec.ts` covering empty
  `applied`, no-mutation guarantee, merge-preserves-unmentioned-keys for both
  `resourcePools` and `entities`, `schemaVersion` carry-through.
- Extend `apps/zoltar-be/src/session/session.repository.ts` with
  `writeCampaignState({ campaignId, data, tx? })` — optional transaction
  argument, defaults to `this.db`. Uses `sql\`now()\`` for `updatedAt`.

**Review gate:** applier unit tests green. Repository method compiles and
matches the signature the orchestrator will call in Part 9. Commit.

---

## Part 5 — `game_events` Write Path (spec Part 4)

Medium-sized part — introduces sequence-number allocation semantics and the
turn-level event helper.

- Create `apps/zoltar-be/src/session/session.events.ts`:
  - `nextSequenceNumber(adventureId, tx)` using `SELECT ... FOR UPDATE`
    (fallback to raw `sql` template if the Drizzle builder doesn't surface
    `.for('update')` on the query type in use).
  - `writeTurnEvents(args)` that:
    - Allocates contiguous sequence numbers inside the supplied transaction.
    - Inserts `player_action`, `gm_response`, optionally `correction`, then
      `state_update` rows with the payloads in spec §"Part 4 → Event shape per
      turn".
    - When `correction` is present, updates the `gm_response` row's
      `superseded_by` to point at the new `correction` row's id.
    - Returns `{ gmResponseEventId, correctionEventId?, stateUpdateSeq }` for
      the telemetry helper (Part 7).
- Create `apps/zoltar-be/src/session/session.events.spec-int.ts` (new
  integration test file) covering every case in spec §"Part 4 → Tests":
  - Three events, contiguous sequence numbers (happy path).
  - Four events, contiguous sequence numbers (correction path).
  - `gm_response.superseded_by` set to the correction row's id.
  - Concurrent writers against the same adventure produce disjoint sequence
    numbers (seed two simultaneous calls; assert no sequence collision).
- Verify the `game_events` schema columns (`sequence_number`, `superseded_by`,
  `actor_type`, `actor_id`, `payload`, etc.) already exist from earlier
  migrations; if anything is missing, add a migration in this part.

**Review gate:** integration tests green against a clean volume
(`docker compose down -v` first — per memory). Sequence numbers in a
multi-turn adventure form a contiguous 1..N run with no gaps. Commit.

---

## Part 6 — Correction Request Builder (spec Part 5, pure function only)

Small part. Lands the request-construction helper; the orchestration that
decides when to invoke it lands in Part 9.

- Create `apps/zoltar-be/src/session/session.correction.ts`:
  - `buildCorrectionRequest({ originalRequest, originalAssistant, rejections })`
    returning a fully-formed `Anthropic.MessageCreateParams` with:
    - Original `messages` extended by the original assistant response and a
      user turn containing a single `tool_result` content block.
    - `tool_result.tool_use_id` matches the original `submit_gm_response`
      tool-use block's `id`.
    - `tool_result.is_error: true`, text body containing the rejection list in
      `- path: reason` format plus the re-narration instruction.
    - `tool_choice: { type: 'tool', name: 'submit_gm_response' }`.
  - Throws if the original assistant response had no `submit_gm_response`
    tool_use block (defense-in-depth; should be impossible given M5
    invariants).
- Create `apps/zoltar-be/src/session/session.correction.spec.ts` covering
  every case in spec §"Part 5 → Tests (session.correction.spec.ts)":
  original-assistant-included, `tool_use_id` matches, rejection text contains
  every rejection one-per-line, `tool_choice` preserved.
- Define `SessionCorrectionError` class in the same file (or alongside the
  existing `SessionOutputError` / `SessionPreconditionError` — confirm which
  module they live in, match that convention). Include first-round and
  second-round rejections on the error for the controller to surface.

**Review gate:** unit tests green. `buildCorrectionRequest` is a pure
function, no network or DB access. Commit.

---

## Part 7 — Adventure Telemetry Write (spec Part 7)

Small, self-contained.

- Create `apps/zoltar-be/src/session/session.telemetry.ts`:
  - `AdventureTelemetryPayload` type matching spec §"Part 7 → Payload"
    exactly (including the empty `diceRolls: []` stub and the optional
    `correction` block).
  - `writeAdventureTelemetry({ tx, adventureId, sequenceNumber, payload })`
    helper that inserts one row.
- Create `apps/zoltar-be/src/session/session.telemetry.spec.ts` covering the
  payload-shape cases in spec §"Part 7 → Tests (session.telemetry.spec.ts)":
  payload structure matches spec, `diceRolls` defaults to `[]`, `notes.original`
  and `notes.correction` handled correctly.
- Verify the `adventure_telemetry` table columns already exist from earlier
  migrations; add a migration here if the `payload` JSONB column or the
  `sequence_number` column is missing.

**Review gate:** unit tests green. The payload type is the single source of
truth — no structural drift between the exported type and the schema the
helper inserts. Commit.

---

## Part 8 — Proposed Canon Routing + GM Context Blob Updates (spec Part 6)

Medium part. Repository-level work that Part 9's orchestrator will call.

- Extend `apps/zoltar-be/src/session/session.repository.ts` with:
  - `insertPendingCanon({ tx, adventureId, entries })` — bulk-insert the
    `proposedCanon` entries as `pending_canon` rows with `status: 'pending'`.
  - `mergeNpcAgendas({ tx, adventureId, npcStates })` — read
    `gm_context.blob.narrative.npcAgendas`, overwrite on key collision, write
    the updated blob back. Skip the read/write when `npcStates` is empty.
- Extend `SynthesisRepository.autoPromoteCanon` (in `apps/zoltar-be/src/synthesis/`)
  to accept an optional transaction argument. Default to `this.db` when omitted
  so the existing M4 call site keeps working.
- Add/extend unit tests:
  - `synthesis.repository.spec.ts` — `autoPromoteCanon` honors the supplied
    transaction.
  - Repository-level integration tests for `insertPendingCanon` and
    `mergeNpcAgendas` if the existing repo test file covers that surface;
    otherwise a minimal new test covering both.
- Confirm `gmUpdates.notes` is **not** written to the blob in this part —
  the spec routes it only to `adventure_telemetry.payload.notes` (Part 7
  already accepts the field; Part 9 populates it).

**Review gate:** repo changes compile; the `autoPromoteCanon` signature
extension is non-breaking for M4. Repo tests green. Commit.

---

## Part 9 — SessionService Orchestration + Endpoint Response Shape (spec Parts 8 + 9)

The biggest part. Stitches every prior part together, rewrites `sendMessage`,
reshapes the controller response, and replaces the M5 integration tests that
were documenting non-behavior.

### Service changes

- Rewrite `SessionService.sendMessage` per spec §"Part 8 → The new
  `sendMessage`":
  1. Preconditions (unchanged from M5; keep the existing error-translation).
  2. Persist the player message (unchanged).
  3. Extract the M5 "prompt build + Claude call" path into a
     `callClaudeOnce` helper on the service so both the original and
     correction calls can share it.
  4. Validate → if rejections, build correction request via
     `buildCorrectionRequest`, re-call Claude, re-validate. If second-round
     rejections, throw `SessionCorrectionError`.
  5. Call `applyTurnAtomic` (new repo method, below).
  6. Return `{ message, applied, thresholds }` — the M5 `proposals` field is
     removed.
- Add `SessionRepository.applyTurnAtomic(args)` bundling in a single
  transaction: state write, event writes (`writeTurnEvents`), canon insert
  (`insertPendingCanon`), `autoPromoteCanon` when `campaign.creationMode ===
  'solo_blind'`, blob merge (`mergeNpcAgendas`), final-message insert into
  `messages`, and telemetry write (`writeAdventureTelemetry`). The player
  message row from step 2 stays **outside** the transaction per the M5
  pattern — a failed turn still preserves player input.

### Controller changes

- Update `session.controller.ts` response type to
  `{ message, applied, thresholds }`. Remove the M5 `proposals` field from the
  DTO.
- Add error translation for `SessionCorrectionError` → 502 with body error
  code `gm_correction_failed`. Keep existing `SessionPreconditionError` → 409
  and `SessionOutputError` → 502 mappings.

### Test replacements

- `session.service.spec.ts` — add unit cases for:
  - `SessionCorrectionError` thrown when both rounds reject.
  - Existing `SessionOutputError` / `SessionPreconditionError` cases still
    pass.
- `session.service.spec-int.ts` — the existing M5 assertions that "no state
  mutation / no `pending_canon` / no events" now document obsolete non-
  behavior. Replace with the three end-to-end paths from spec §"Part 5/8 →
  Tests":
  - **Happy path** — one Claude call, three events, state applied, canon
    routed + auto-promoted in Solo Blind, blob `npcAgendas` merged, telemetry
    row written.
  - **Correction-succeeds** — two Claude calls, four events, `superseded_by`
    set on the original `gm_response`, corrected `playerText` in `messages`,
    state reflects corrected deltas, telemetry keyed to the original
    `gm_response` sequence with `correction` block populated.
  - **Correction-fails** — two Claude calls, only the `player_action` event
    written, no state mutation, no canon rows, no telemetry,
    `SessionCorrectionError` thrown and translated to 502 with
    `gm_correction_failed` error code.

**Review gate:** all backend unit + integration tests green. `tsc --noEmit`
clean. Smoke-test one manual turn via the existing messages endpoint (curl or
REST client): `campaign_state.data` mutates, three `game_events` rows appear,
one `adventure_telemetry` row appears. Commit.

---

## Part 10 — Frontend Support Endpoints + Route Registration

Small part. Lands the two new backend read endpoints the play view needs plus
the SPA route, stubbed to a placeholder page. Splitting this from Part 11
keeps the review focused — backend read endpoints are boring but shouldn't
hide behind the larger frontend diff.

### Backend

- Add `GET /api/v1/campaigns/:campaignId/adventures/:adventureId/messages`
  returning the full message log for the adventure, sorted chronologically.
  Auth-gated to campaign members. Response shape mirrors what the POST
  endpoint now returns for `message`, but as an array: `{ messages: [{ id,
  role, content, createdAt }, …] }`. Add controller + repository method +
  unit tests.
- Add `GET /api/v1/campaigns/:campaignId/state` returning
  `{ data: MothershipCampaignState }`. Auth-gated to campaign members. Thin
  read-only endpoint on the campaign controller (or session controller —
  match whichever owns the existing campaign-state writes). Add controller +
  repository + tests.

### Frontend

- Add a placeholder `apps/zoltar-fe/src/pages/Play.svelte` that renders "Play
  view — coming in next part" and reads `campaignId` / `adventureId` from
  `$props()`.
- Register in `apps/zoltar-fe/src/routes.ts`:
  `'/campaigns/:campaignId/adventures/:adventureId/play': Play,`.
  **Spec deviation:** spec says `apps/zoltar-fe/src/routes/Play.svelte`;
  existing convention is `src/pages/`. Follow existing convention.

**Review gate:** new GET endpoints return expected shapes for a seeded
adventure. Navigating to `/#/campaigns/:id/adventures/:id/play` from the
adventure detail page renders the placeholder. Commit.

---

## Part 11 — Frontend Play View (spec Part 10)

The frontend part proper. Self-contained given Part 10 already landed the
route and read endpoints.

- Create `apps/zoltar-fe/src/lib/components/play/`:
  - `CharacterStatusStrip.svelte` — name, HP bar, stress bar, conditions line
    (sourced from `entities[playerEntityId].npcState` per spec). Uses the
    M2.5 semantic tokens and the existing `ResourceBar.svelte` primitive.
  - `MessageLog.svelte` — scrollable, auto-scrolls to bottom on new messages,
    renders a list of `MessageBubble` components.
  - `MessageBubble.svelte` — two variants (player right-aligned/dimmer, GM
    left-aligned/full-width/Warden typography).
  - `MessageInput.svelte` — text input + send button, disabled while a turn
    is in flight, shows the "Warden is typing" pulsing-dot indicator under
    the last message.
  - `ThresholdBanner.svelte` — renders when the last response's `thresholds`
    array is non-empty; hidden otherwise.
- Rewrite `apps/zoltar-fe/src/pages/Play.svelte` per spec §"Part 10 → Page
  component":
  1. On mount: fetch adventure (abort + redirect to campaign detail with
     error banner if `status !== 'ready'`), fetch message log, fetch
     `campaign_state` data.
  2. If log is empty, render `openingNarration` as the first GM bubble.
     Otherwise render the log. Do **not** render opening narration when
     messages exist.
  3. Character status strip reads HP + stress from
     `campaign_state.data.resourcePools` keyed by the player entity id.
  4. Turn flow per spec §"Part 10 → Turn flow": optimistic player bubble,
     disable input, POST to messages endpoint, append GM bubble on 200,
     refresh status strip from `applied.resourcePools`, render
     `ThresholdBanner` when `thresholds` is non-empty, handle 409 / 502
     (including `gm_correction_failed`) with a retry affordance.
- Tests per spec §"Part 10 → Tests":
  - `MessageLog` renders player/GM bubbles in order.
  - `CharacterStatusStrip` renders HP and stress bars with correct fill
    percentages.
  - `ThresholdBanner` renders when `thresholds` is non-empty, hidden when
    empty.
  - `Play.svelte` integration test against mocked fetch: initial load with
    empty log shows opening narration; post-send shows player bubble
    immediately and GM bubble after response.
- Out of scope for this part (and M6 entirely): `playerRolls` UI,
  `pending_canon` visualization, private actions, caller transfer, real-time
  updates.

**Review gate:** all new frontend tests green. `tsc --noEmit` clean on the
frontend. Manual browser check: the "Begin Adventure" button on the
post-synthesis flow lands on the play view with opening narration; one turn
sent end-to-end renders the player bubble, the GM bubble, and an updated
status strip. Golden-path and one deliberate error path (e.g. send while
logged out to force a 401 / 409) behave as expected. Commit.

---

## Part 12 — Final Docs: Deferrals + Roadmap

Last part. Pure docs. Lands the deferral entries and roadmap updates the spec
requires, now that the code they reference is in place.

- `docs/decisions.md` — add two entries:
  - **Entity death does not auto-zero prefixed pools** — exact wording from
    spec §"Deferrals Introduced in M6 → Auto-zero pools on `status: 'dead'`".
  - **Correction loop bounded at one re-prompt** — new entry capturing the
    rationale from spec §"Part 5 → Bounding" (one extra Claude call per
    rejected turn; two rounds compounds cost and masks validator / prompt
    problems).
- `docs/roadmap.md`:
  - Check off M6 items as they land.
  - Add a one-line pointer under M6 to `docs/specs/zoltar/m6-state-management.md`.
    (Note: spec mentions `m6-gm-service-and-state-management.md` but the file
    on disk is `m6-state-management.md` — use the actual filename.)
  - Insert a new **M7.1 — Playtest Review Tooling** milestone between M7 and
    M8. Scope per spec: SQL views joining `game_events` and
    `adventure_telemetry` (per-turn, per-state-history, per-correction), a
    CLI script producing a turn-by-turn markdown report for a given adventure
    id, no web UI.

- Smoke-test sanity check per spec §"Playtest review tooling — M7.1":
  after a first end-to-end run, eyeball one adventure's `adventure_telemetry`
  payload via `psql` and confirm the shape is actually useful. Fifteen
  minutes; not tooling, a sanity check. If the shape needs adjusting, roll it
  into this part's commit; otherwise just confirm in the review notes.

**Review gate:** decisions and roadmap reflect the M6 reality. Commit.

---

## Summary of Commits

| Part | Scope | Size |
|------|-------|------|
| 1  | Docs corrections | Small |
| 2  | Pool definitions (game-systems package) | Small |
| 3  | State-change validator | Medium |
| 4  | Applier + repo write | Small |
| 5  | `game_events` write path + integration tests | Medium |
| 6  | Correction request builder | Small |
| 7  | Adventure telemetry write | Small |
| 8  | Canon routing + blob merges + `autoPromoteCanon` tx | Medium |
| 9  | SessionService orchestration + endpoint reshape | Large |
| 10 | FE support endpoints + route registration | Small |
| 11 | Play view components + page | Large |
| 12 | Decisions + roadmap updates | Small |

---

## Spec Deviations Flagged

- Spec references `apps/zoltar-fe/src/routes/Play.svelte`; the existing repo
  convention is `apps/zoltar-fe/src/pages/`. Plan follows existing convention
  (Part 10).
- Spec's closing footer names the file as
  `m6-gm-service-and-state-management.md`; the file on disk is
  `m6-state-management.md`. Plan uses the on-disk name (Part 12 roadmap
  pointer).

---

## Cross-cutting Notes

- **Volume hygiene:** Part 5 and Part 9 integration tests must start from
  a clean volume (`docker compose down -v`) to avoid stale-schema race
  conditions — per project memory on migration-adjacent test runs.
- **Repository pattern:** every part that touches the database goes through
  `session.repository.ts` or `synthesis.repository.ts`; no direct Drizzle
  calls from services — per project memory.
- **No mocks at the DB boundary:** integration tests in Parts 5 and 9 hit
  the real test database per `CLAUDE.md` testing standards. Unit tests in
  Parts 3, 4, 6, 7 mock at the service boundary and never touch the DB.
