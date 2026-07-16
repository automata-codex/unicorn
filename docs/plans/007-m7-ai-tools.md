# M7 — Tools (`roll_dice` & `rules_lookup`): Implementation Plan

Multipart implementation plan for `docs/specs/zoltar/m7-ai-tools.md`. Each part
is sized for a manual code review and a single commit. Pause after each part
for review before starting the next.

Terminology note: "part" here means a unit of this plan. The M7 spec itself is
also organized into 10 parts (Part 1 … Part 10) plus a Documentation
Corrections section. Plan parts map onto spec parts but do not number 1:1 —
where a plan part cross-references a spec part it is written as "spec Part N".

**Migration number correction.** The spec names the new migration
`V10__dice_request.sql`. The next free slot on `main` is actually **V12** —
`V10__character_sheet_drop_current_fields.sql` and
`V11__adventure_status_in_progress.sql` have landed since the spec was
written. Plan part 7 uses `V12__dice_request.sql`; update the spec alongside
(or land the correction in part 1).

---

## Part 1 — Documentation Corrections & `playerRolls` → `diceRequests` Rename

Small, foundational. Pure-ish changes that later parts want in place up front.

- Rename `playerRolls` → `diceRequests` in `apps/zoltar-be/src/session/session.schema.ts`
  (shape unchanged except name).
- Flow the rename through any consumers: `session.telemetry.ts`
  (`originalResponse` is inferred from `SubmitGmResponse`, but any direct
  field reads need updating), `session.telemetry.spec.ts` stub, and any
  `parsed.playerRolls` references in `session.service.ts`. Grep first, rename
  in place.
- Delete the stale `// roll_dice and rules_lookup are M6 additions — not
  registered yet` comment in `session.tools.ts` (the comment gets updated
  for real in part 2).
- `docs/schema.md` — no change in this part (the `dice_request` table lands in
  part 7).
- `docs/ENVIRONMENTS.md` — no change in this part (Voyage env vars land in
  part 5).
- `docs/DECISIONS.md` — no entries yet; the three new entries listed in the
  spec's Documentation PR Checklist land in the parts that introduce each
  decision (6.2 in part 8, "rules lookups not in game_events" in part 8,
  "M7.2 split" as a standalone entry in part 1).
- `docs/roadmap.md` — insert the new **M7.2 — Rules Ingestion Pipeline**
  milestone entry between M7.1 and M8 (scope per spec).
- `docs/specs/zoltar/m7-ai-tools.md` — correct the migration filename to
  `V12__dice_request.sql` in Part 7.1, or note the correction in this plan
  only if we prefer to leave the spec immutable. Suggested: patch the spec
  in this part so later parts cite the correct name.

**Review gate:** `tsc --noEmit` passes on `zoltar-be`. M6 behaviour unchanged
— all existing tests still green. No stale `playerRolls` references remain.
Commit.

---

## Part 2 — Tool Schemas & Registration (spec Part 1.2–1.4)

Self-contained. Lands the two new tool schemas and their registration; does
**not** wire `tool_choice: { type: 'any' }` yet — that comes with the inner
loop in part 8.

- Add to `apps/zoltar-be/src/session/session.schema.ts`:
  - `rollDiceInputSchema`, `rollDiceOutputSchema`, `RollDiceInput`,
    `RollDiceOutput` (spec §1.2).
  - `rulesLookupInputSchema`, `rulesLookupOutputSchema`, `RulesLookupInput`,
    `RulesLookupOutput` (spec §1.3).
- Update `apps/zoltar-be/src/session/session.tools.ts`:
  - Export `ROLL_DICE_TOOL` and `RULES_LOOKUP_TOOL` as `Anthropic.Tool` with
    descriptions from spec §1.4.
  - Register both in `SESSION_TOOLS` alongside `SUBMIT_GM_RESPONSE_TOOL`.
- Unit tests in `session.schema.spec.ts` (or wherever the existing Zod tests
  live): valid/invalid shapes for both new schemas, `limit` defaulting to 3
  for `rules_lookup`, `limit` bounds (1–5).
- Any existing `session.tools.spec.ts` test listing tool names in
  `SESSION_TOOLS` needs updating to include the two new entries.

**Review gate:** schema tests green. `tsc --noEmit` green. Running the app
against M6 flows still produces correct tool selection — registering tools
without flipping `tool_choice` to `any` means Claude continues forcing
`submit_gm_response`, so no runtime behaviour change yet. Commit.

---

## Part 3 — Dice Notation Parser in `@uv/game-systems` (spec Part 2)

Self-contained package addition. The frontend will depend on this in part 13;
the backend `DiceService` in part 4.

- Create `packages/game-systems/src/dice.ts` with exactly the surface in spec
  §Part 2: `ParsedNotation`, `DiceNotationError`, `parseDiceNotation`,
  `DiceRollResult`, `webCryptoRandomInt` (rejection-sampling CSPRNG),
  `executeDiceRoll` (injectable `randomInt` for tests).
- Export from `packages/game-systems/src/index.ts`: `parseDiceNotation`,
  `executeDiceRoll`, `webCryptoRandomInt`, `DiceNotationError`, and the types.
- Create `packages/game-systems/src/dice.spec.ts` covering spec §Part 2 Tests:
  - Parsing: happy path, modifier handling, invalid format, out-of-range
    count (≤0 and >100), unsupported sides.
  - Execution with a deterministic injected `randomInt` — fixed-sequence
    generator asserts result arrays and totals are reproducible.
  - `webCryptoRandomInt` statistical smoke: 10,000 d100 draws, every bucket
    hit at least once and no bucket >3× mean. Fast (<1s).
  - `globalThis.crypto.getRandomValues` availability check under vitest's
    default Node environment.

**Review gate:** package tests green. `tsc --noEmit` on `@uv/game-systems`
green. Spot-check that rejection sampling threshold is
`Math.floor(0x1_0000_0000 / sides) * sides` (upper bound, not inclusive).
Commit.

---

## Part 4 — `DiceService` + `dice_roll` Event Write Path (spec Part 3)

Backend wiring of part 3. Does **not** call from the session service yet —
that happens in part 8.

- Create `apps/zoltar-be/src/dice/dice.module.ts` and
  `apps/zoltar-be/src/dice/dice.service.ts` per spec §3.1.
  `DiceService.rollForGm` wraps `executeDiceRoll` from `@uv/game-systems` and
  translates `DiceNotationError` into `DiceInvocationError`.
- Register `DiceModule` in `app.module.ts`. Import `DiceModule` from
  `SessionModule` (so it's available when part 8 injects the service).
- Extend `SessionRepository` (or its events sub-repo) with
  `insertDiceRollEvent` matching the signature in spec §3.2 — accepts
  `actorType`, `actorId`, `rollSource`, and payload fields; reuses the
  sequence-number allocator from M6.
- Unit tests:
  - `dice.service.spec.ts` — mocks `executeDiceRoll` (or passes deterministic
    injected `randomInt`). Happy and error-translation paths.
- Integration tests:
  - Extend `session.events.spec-int.ts` with a direct-insert case: call
    `insertDiceRollEvent` inside a transaction, assert the row lands in
    `game_events` with `event_type: 'dice_roll'`, correct `actor_type`,
    `actor_id`, `roll_source`, and JSONB payload shape (no inner-loop
    scenarios yet — those land in part 8).

**Review gate:** unit + integration tests green. `DiceService` is injectable
but no other code calls it yet. Commit.

---

## Part 5 — `VoyageService` + Environment Configuration (spec Part 4)

Self-contained. No Voyage call happens at runtime yet; that waits for part 6.

- Create `apps/zoltar-be/src/voyage/voyage.module.ts` and
  `apps/zoltar-be/src/voyage/voyage.service.ts` per spec §4.1. Uses `fetch`;
  supports `input_type: 'query' | 'document'` (only `query` exercised in
  M7); throws `VoyageError` on non-2xx or missing-embedding responses.
- Update `apps/zoltar-be/src/config/env.schema.ts`:
  - `VOYAGE_API_KEY: z.string().min(1)`
  - `VOYAGE_EMBED_MODEL: z.string().default('voyage-3-lite')`
- Update `.env.example` with both (API key placeholder, model default).
- Update `docs/ENVIRONMENTS.md` to list both under a new or existing
  "External services" row.
- Register `VoyageModule` in `AppModule`.
- Unit tests: `voyage.service.spec.ts` mocks `fetch`, asserts:
  - POST body shape (`input`, `model`, `input_type`).
  - Both `query` and `document` input types hit the same endpoint.
  - Non-2xx response translates to `VoyageError` with status code in the
    message.
  - Missing `data[0].embedding` translates to `VoyageError`.
- Do **not** add an integration test — the spec explicitly says no live
  Voyage call in CI. Alex runs one manual verification before merging this
  part (ping the real Voyage API from a local shell).

**Review gate:** unit tests green. App still boots with the new env vars
(run locally with a valid `VOYAGE_API_KEY` to confirm config validation
doesn't reject). Commit.

---

## Part 6 — `RulesLookupService` + pgvector Query (spec Part 5)

Depends on part 5. The query-side plumbing lands with a correctly-behaving
empty-index path. `rules_chunk` already exists from V7 — no migration here.

- Create `apps/zoltar-be/src/rules/rules.module.ts` and
  `apps/zoltar-be/src/rules/rules-lookup.service.ts` per spec §5.1.
  - Voyage-embeds the query (`input_type: 'query'`).
  - Issues the pgvector cosine-similarity query with `system_id` filter.
  - Maps rows to `{ text, source, similarity }` entries.
- Handle the empty-index case per spec §5.2: empty result set returns
  `{ results: [] }` cleanly, no short-circuit around Voyage (we pay the
  embedding cost even on empty results, because M7 telemetry wants a record
  of every attempt).
- Register `RulesModule` in `AppModule`. Import from `SessionModule` (ready
  for part 8 to inject).
- Unit tests — `rules-lookup.service.spec.ts`: mocks Voyage + mocks DB,
  asserts SQL shape and row→result mapping.
- Integration tests — `rules-lookup.service.spec-int.ts`:
  - **Empty index:** no `rules_chunk` rows seeded, query returns
    `{ results: [] }` — the explicit M7 regression test.
  - **Populated index:** seed three rows with hand-chosen fixed 1024-element
    vectors (not Voyage-embedded), query with a controlled mock Voyage
    vector, assert ordering by similarity matches expectation.
  - **System filter:** seed rows under two different `system_id` values,
    confirm only the requested system's rows are returned.
  - All three cases mock `VoyageService.embed` to return a fixed vector.

**Review gate:** integration tests green against a fresh volume
(`docker compose down -v` first — per auto-memory). Empty-index case
explicitly asserted. Commit.

---

## Part 7 — `dice_request` Table & Repository Methods (spec Part 7.1 + 7.2 prep)

Pure DB + repo. No integration into the submit path yet — that lands in
part 8 when the inner loop is wired.

- Create `infra/db/migrations/V12__dice_request.sql` (note: spec says V10; use
  V12 — see plan header). Content per spec §7.1: `dice_request_status` enum,
  `dice_request` table, two indexes.
- Update `apps/zoltar-be/src/db/schema.ts` with `diceRequestStatusEnum` and
  the `diceRequests` Drizzle table definition matching the SQL.
- Extend `SessionRepository` (or the dice sub-repo if that's cleaner given
  the repository-pattern memory) with:
  - `insertDiceRequest({ tx, adventureId, issuedAtSequence, notation,
    purpose, target })` → `{ id, notation, purpose, target }`.
  - `loadDiceRequest({ adventureId, id })` → row or null (needed in part 9
    but lands with the repo now).
  - `resolveDiceRequest({ tx, id, resolvedAtSequence })` → void, sets
    `status = 'resolved'`, `resolved_at = now()`, `resolved_at_sequence`.
  - `pendingDiceRequestsForAdventure(adventureId)` → row array (used by the
    adventure bootstrap endpoint in part 9 and the pending-guard in part 9).
- Update `docs/schema.md`: add the `dice_request` table definition under a
  new subsection after `pending_canon`; add `V12__dice_request.sql` to the
  migration list.
- Unit tests: repo-method happy paths with a test Postgres (not mocked) —
  these are naturally integration-ish. Add to an existing repo integration
  spec file or create `dice-request.repository.spec-int.ts`. Cover:
  - `insertDiceRequest` inserts with correct defaults (`status: 'pending'`).
  - `resolveDiceRequest` transitions status and stamps `resolved_at`.
  - `loadDiceRequest` returns null for unknown id.
  - `pendingDiceRequestsForAdventure` returns only pending rows for the
    given adventure.

**Review gate:** migration applies cleanly on a fresh volume. Repo methods
compile and are typed against the Drizzle schema. No code path in
`SessionService` uses them yet. Commit.

---

## Part 8 — Inner Tool-Use Loop + `dice_request` Persistence at Submit (spec Part 6 + spec Part 7.2 integration)

The largest part. This is the integration moment — every earlier part plugs
in here. Budget extra review time.

- Add `SessionToolLoopError` alongside the existing session errors
  (`SessionOutputError`, `SessionCorrectionError`, `SessionPreconditionError`
  — match their file layout). Controller maps it to HTTP 502 with error
  code `gm_tool_loop_exhausted`.
- Define `ExecutedRollRecord` and `RulesLookupRecord` types in
  `session.telemetry.ts` (the telemetry file is their natural home; part 10
  will populate them).
- Flip `tool_choice` on `buildSessionRequest` from
  `{ type: 'tool', name: 'submit_gm_response' }` to `{ type: 'any' }`.
  Update `session.prompt.spec.ts` (or whichever spec asserts the request
  shape) accordingly.
- Implement `runInnerToolLoop` on `SessionService` per spec §6.1. The loop
  body:
  - Calls Claude via `AnthropicService.callSession`.
  - If any `tool_use` block is `submit_gm_response`: Zod-parse its input,
    return `{ finalRequest, finalResponse, finalParsed, diceRolls,
    rulesLookups, iterations }`.
  - Otherwise, for each `tool_use`:
    - `roll_dice` — Zod-parse input, call `DiceService.rollForGm`, allocate
      next sequence number, write `dice_roll` event inside the transaction,
      record the roll, append `tool_result`.
    - `rules_lookup` — Zod-parse input, call
      `RulesLookupService.lookup(systemId, input)`, record the lookup
      metadata (query, limit, `resultCount`, `topSimilarity`, `sources`),
      append `tool_result`. Never writes to `game_events` — rules lookups
      are metadata, not state-changing events.
    - Invalid input → `tool_result` with `is_error: true` and the Zod
      error message; Claude may recover.
    - Unknown tool name → `tool_result` with `is_error: true`; Claude may
      recover.
  - Appends the assistant response and a `user` turn with all tool_result
    blocks to `request.messages`, increments iteration, loops.
  - `INNER_TOOL_LOOP_CAP = 8`. On exhaustion, throw `SessionToolLoopError`.
- Refactor `sendMessage` to call `runInnerToolLoop` in place of the M6
  single-shot `callSession` invocation. The structure becomes:
  1. Build initial request (including `tool_choice: any`).
  2. Open transaction, allocate `player_action` sequence, write
     `player_action` event.
  3. Call `runInnerToolLoop` — dice events get written to `game_events`
     inside the same transaction as they happen.
  4. Validate `finalParsed.stateChanges` (M6 validator).
  5. If rejected: build correction request (M6) using the *final* request
     from the tool loop as the base — `tool_choice:
     { type: 'tool', name: 'submit_gm_response' }` is forced on the
     correction pass so Claude cannot re-roll. Compose per spec §6.2.
  6. Apply state changes (M6).
  7. Allocate sequence, write `gm_response` event (M6).
  8. Persist dice_request rows per spec §7.2: for each entry in
     `finalParsed.diceRequests ?? []`, call `repo.insertDiceRequest` with
     `issuedAtSequence = gmResponseSequence`, collect backend-assigned IDs.
  9. Write `state_update` event (M6).
  10. Return HTTP response with enriched `diceRequests` carrying
      backend-assigned UUIDs, `playerText`, `applied`, `thresholds`.
- Add entry to `docs/DECISIONS.md`:
  - **Correction loop does not re-enter the inner tool loop** — per spec
    §6.2 wording.
  - **Rules lookups are not written to `game_events`** — captured in
    `adventure_telemetry.rulesLookups` only.
- Tests — `session.tool-loop.spec.ts` (new, mocked Anthropic + mocked
  `DiceService` + mocked `RulesLookupService`), every case in spec §6.4:
  - `submit_gm_response` on first call (identical to M6 happy path).
  - One `roll_dice` then `submit_gm_response`.
  - Two `roll_dice` calls in a single assistant turn.
  - `rules_lookup` then `roll_dice` then `submit_gm_response` across three
    iterations.
  - `rules_lookup` returning `{ results: [] }` — threaded correctly;
    `rulesLookups` record has `resultCount: 0`, `topSimilarity: null`.
  - Dice-notation error returns `is_error: true`; Claude recovers.
  - Unknown tool name returns `is_error: true`; Claude recovers.
  - Iteration cap exhaustion throws `SessionToolLoopError`.
  - No tool_use block throws `SessionOutputError`.
- Extend `session.service.spec-int.ts`: one roll-and-respond happy path
  against the test Postgres. Assert `dice_roll` lands at the right sequence
  number, between `player_action` and `gm_response`.
- Extend `session.events.spec-int.ts` with the expanded ordering case —
  a turn with two `roll_dice` tool calls produces events
  `[player_action, dice_roll, dice_roll, gm_response, state_update]` in
  sequence.

**Review gate:** all session tests green, including the M6 regression tests
— a submit-without-rolls turn must behave identically to M6. Integration
test confirms dice events land at correct sequence numbers. Controller
returns 502 with `gm_tool_loop_exhausted` when the cap trips. Commit.

---

## Part 9 — `diceResult` Action + Pending Guard + Bootstrap + Prompt Injection (spec Part 7.3–7.6)

Closes the player-facing half of the dice loop. Entirely backend.

- Extend the `/actions` request schema in `apps/zoltar-be/src/session/`:
  `diceResultActionSchema` per spec §7.3 — `type: 'diceResult'`,
  `requestId`, `notation`, `results: number[]`, `source: 'player_entered' |
  'system_generated'`.
- Implement `SessionService.submitDiceResult` per spec §7.3:
  1. Load `dice_request` via `loadDiceRequest`. Return **409** if missing,
     not pending, or adventure mismatch.
  2. Verify `notation` matches persisted notation. **422** otherwise.
  3. Re-parse `notation` with `parseDiceNotation`; verify
     `results.length === count` and every result in `[1, sides]`. **422**
     otherwise.
  4. Compute `modifier = 0`, `total = sum(results)`.
  5. In a transaction: allocate sequence, write `dice_roll` event with
     `actor_type: 'player'`, `actor_id: <user_id>`, the submitted
     `roll_source`, and `payload.requestId`; call `resolveDiceRequest`.
  6. Return `{ requestId, accepted: true, pendingRequestIds }`.
- Controller guard on the `narrative` action branch (spec §7.6): if any
  `dice_request` rows for the adventure are `pending`, return **409** with
  `error: 'dice_pending'` and pending IDs in body. Defensive — the FE
  blocks it already.
- Prompt injection (spec §7.4): extend `buildSessionRequest` so that when
  `dice_roll` events with `roll_source = 'player_entered'` exist between
  the last `gm_response` sequence and the current turn's `player_action`,
  they're rendered into a synthetic `[Dice results]` block immediately
  before the narrative input. Format per spec §7.4. Requires a new repo
  query: `playerDiceRollsSinceLastGmResponse(adventureId)` or similar.
- Extend the adventure bootstrap endpoint
  (`GET /campaigns/:id/adventures/:id`) to include `pendingDiceRequests:
  Array<{ id, notation, purpose, target }>` drawn from
  `pendingDiceRequestsForAdventure`. Document in `docs/api.md`.
- Tests:
  - `session.service.spec.ts` — extend for:
    - `submit_gm_response` carrying two `diceRequests` entries produces two
      `insertDiceRequest` calls; response contains both backend-assigned
      IDs.
  - `session.diceResult.spec-int.ts` (new integration test):
    - Happy flow: issue a request → submit a result → event written, request
      resolved.
    - Wrong `notation` → **422**.
    - `requestId` from another adventure → **409**.
    - Already-resolved request → **409**.
    - Submitting a subset of pending results blocks a narrative action
      (controller-level assertion).
  - `session.prompt.spec.ts` — extend: a window containing resolved
    player-entered dice events produces the `[Dice results]` prefix.
- Caller-role enforcement is **out of scope** (M8). Any campaign member may
  submit a dice result in M7. Ensure the pending-guard and resolution logic
  work regardless of the submitter.

**Review gate:** integration tests green. Manual smoke via the playtest app
(or a curl sequence) confirms: submit a turn where Claude issues
`diceRequests`, GET bootstrap reflects pending requests, POST
`/actions` with a `diceResult` resolves them, next narrative action
succeeds and the `[Dice results]` prefix appears in the next Claude
prompt. Commit.

---

## Part 10 — Adventure Telemetry Update (spec Part 8)

Small, focused. Previously prepared types from part 8 become populated
end-to-end.

- Update `AdventureTelemetryPayload` in `session.telemetry.ts` per spec
  §8.1:
  - `diceRolls: ExecutedRollRecord[]` (was `never[]` in M6).
  - `rulesLookups: RulesLookupRecord[]` (new).
  - `toolLoopIterations: number` (new — 1 if no intermediate tools called).
- Extend `buildAdventureTelemetryPayload` to take the three new arguments;
  plumb `diceRolls`, `rulesLookups`, `toolLoopIterations` through
  `SessionService.sendMessage` from `runInnerToolLoop`'s return value.
- Include player-entered rolls in the turn's `diceRolls` per spec §8.2:
  query `dice_roll` events with `roll_source = 'player_entered'` between
  the last `gm_response` sequence and the current `player_action`, map to
  `ExecutedRollRecord`, concat with the system-generated rolls.
- `RulesLookupRecord` stores `sources` and `topSimilarity` only — **no**
  chunk text (spec §8.4). Preserve zero-result lookups faithfully (spec
  §8.3): no filtering, no downsampling, no query-collapsing.
- Extend `session.telemetry.spec.ts`:
  - `diceRolls` carries one entry per executed system-generated roll in
    sequence order.
  - `diceRolls` includes player-entered rolls resolved since the previous
    `gm_response`.
  - `rulesLookups` carries one entry per `rules_lookup` call with sources
    captured.
  - `rulesLookups` includes empty-result lookups with `resultCount: 0` and
    `topSimilarity: null`.
  - `toolLoopIterations` matches the actual iteration count.

**Review gate:** telemetry tests green. Run an end-to-end local session with
a `rules_lookup` call and a `roll_dice` call; inspect the
`adventure_telemetry` row and confirm both records are captured correctly,
including `resultCount: 0` rows. Commit.

---

## Part 11 — Warden System Prompt Additions (spec Part 9)

Small. Prompt-only change, but land-it carefully — Warden prompt changes
affect every subsequent Claude call.

- Add the `TOOLS` / `WHEN TO CALL …` section from spec §Part 9 to the
  Mothership Warden system prompt file (likely
  `apps/zoltar-be/src/session/wardens/warden.mothership.ts` — match
  existing file layout).
- Update the prompt-cache ephemeral boundary marker so the new block is
  part of the cached static region (critical for cost — the Warden prompt
  already caches).
- If Warden prompt versioning is not yet in the production backend, do
  **not** introduce it in M7 (spec §9.1). Open a follow-up ticket instead.
- Test-only change: any existing prompt-shape assertion in
  `session.prompt.spec.ts` that snapshots the Warden prompt needs updating
  to include the new section.

**Review gate:** prompt-shape tests green. Manual smoke: run a test
adventure, submit an ambiguous mechanical question, confirm Claude calls
`rules_lookup` rather than improvising. Run another test with an edge
case that isn't in the index; confirm Claude records a
`Ruled without rulebook support: <topic>` note in `gmUpdates.notes`.
Commit.

---

## Part 12 — Frontend Components: `DicePrompt` + `DiceRollBubble` (spec Part 10.1, 10.3, 10.4)

Frontend, component-level only. No `Play.svelte` integration yet — that's
part 13 so the component review stays focused.

- Create `apps/zoltar-fe/src/lib/components/DicePrompt.svelte` per spec
  §10.1:
  - Props shape from the spec (`requests`, `diceMode`, `onSubmit`).
  - Layout: heading with pending count, one card per request, "Roll for
    me" button (calls `executeDiceRoll` from `@uv/game-systems`), manual
    raw-entry inputs (one per die, `[1, sides]` validation), submit button
    disabled until every request has a complete result.
  - Target display respects `diceMode`: shown in `soft_accountability`,
    hidden in `commitment`.
- Create `apps/zoltar-fe/src/lib/components/DiceRollBubble.svelte` per
  spec §10.3:
  - Monospaced, muted background, left-aligned regardless of source.
  - Displays `purpose`, `notation`, individual results, total, and
    target/success-or-failure when `target` is non-null.
  - Source indicator (system vs player) via inline icon or label.
- Frontend parity: imports `parseDiceNotation` and `executeDiceRoll` from
  `@uv/game-systems` — guarantees identical behaviour with backend
  `roll_dice`. Confirm the package is already in `zoltar-fe`'s deps; add
  if not.
- Tests in `apps/zoltar-fe/src/lib/components/__tests__/`:
  - `DicePrompt.test.ts` — renders one card per request, submit disabled
    until all filled, "Roll for me" populates fields with valid results,
    manual entry accepts valid values and rejects out-of-range.
  - `DiceRollBubble.test.ts` — renders notation and result, distinguishes
    source visually, handles target/success annotations.

**Review gate:** component tests green. `tsc --noEmit` on `zoltar-fe` green.
Storybook or ad-hoc preview page renders both components across all prop
permutations (multiple requests, commitment mode, with/without target,
both source types). Commit.

---

## Part 13 — Frontend Play View Integration (spec Part 10.2)

Wires the part-12 components into the live play view and fetches
`dice_roll` events for the message log. Depends on part 9's bootstrap
endpoint already returning `pendingDiceRequests`.

- Modify `apps/zoltar-fe/src/routes/.../Play.svelte` (exact path from M6):
  - `$state` variable `pendingDiceRequests`, populated from:
    (a) the most recent `submit_gm_response` response, and
    (b) the adventure bootstrap endpoint on mount.
  - When `pendingDiceRequests.length > 0`, narrative input textarea is
    disabled and `DicePrompt` renders above it.
  - On `DicePrompt.onSubmit`, POST each result to `/actions` as a
    `diceResult` action. Optimistically clear the prompt; reconcile on
    server response. On the final result (server returns
    `pendingRequestIds: []`), re-enable the narrative input.
  - Extend the initial-load and post-turn event fetch to include
    `dice_roll` events from `game_events` for the current adventure.
    Merge into the message log timeline by `sequence_number`; render via
    `DiceRollBubble`.
- Handle the returning-user case: a user who closed the tab mid-roll and
  reloads lands in the prompt because the bootstrap response includes
  persisted pending rows (implemented in part 9).
- Tests:
  - `Play.svelte` integration test — mounting with `pendingDiceRequests`
    shows the prompt; narrative input disabled; submit clears the prompt;
    log renders dice events interleaved with messages.
  - Optional: one e2e-style test driving a full turn with a roll.
- Run the dev server and manually exercise the feature per
  `CLAUDE.md`'s UI testing guidance:
  - Golden path: Claude issues a `diceRequests` entry → DicePrompt shows
    → "Roll for me" → submit → next turn narrates the result.
  - Manual entry path: ditto, but raw-entry fields.
  - Multi-request cascade: two `diceRequests` in one turn; both must
    resolve before narrative input re-enables.
  - Mid-roll reload: refresh browser mid-roll, confirm prompt re-appears
    from bootstrap.
  - System-generated roll from Claude shows up in the log as a
    `DiceRollBubble` with the system indicator.

**Review gate:** manual UI verification passes for all five scenarios
above; FE tests green; `tsc --noEmit` on `zoltar-fe` green; no
regressions in the existing play view (message log still renders M6
player/GM messages correctly). Commit.

---

## Cross-cutting checks before declaring M7 done

Not a plan part — a final gate before merging the branch:

- `tsc --noEmit` green on both apps and `@uv/game-systems`.
- All unit and integration tests green: `npm test` at repo root.
- The Done-When list from spec §Done When reads as all-checked against the
  merged branch state.
- `adventure_telemetry.payload.diceRolls` and `.rulesLookups` populate
  correctly on a real end-to-end session (manual sanity — open psql,
  inspect the latest row).
- Empty-index `rules_lookup` path exercised at least once during manual
  playtest and the `Ruled without rulebook support: <topic>` note
  actually lands in `gmUpdates.notes`. This is the signal M7.2 needs.
- Migration list in `docs/schema.md` names `V12__dice_request.sql` (not
  V10 from the spec). Spec patched in part 1 if that route was chosen.
- Roadmap: M7 items checked off; M7.2 milestone visible.
