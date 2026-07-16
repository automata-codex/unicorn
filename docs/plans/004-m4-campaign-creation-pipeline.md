# M4 — Campaign Creation Pipeline: Implementation Plan

Phased implementation plan for `docs/specs/zoltar/m4-campaign-creation-pipeline.md`.
Each phase is sized for a manual code review and a single commit.

---

## Phase 1 — Schemas & Game-System Registry

Pure type/schema work, no runtime wiring. Easy to eyeball.

- Create `apps/zoltar-be/src/synthesis/synthesis.schema.ts` with `submitGmContextSchema`
  (merged `flags`, top-level `openingNarration`, no `initialFlags`/`flagTriggers`).
- Create `packages/game-systems/src/mothership/oracle.schema.ts`: `OracleEntrySchema`,
  `MothershipOracleSelectionsSchema`.
- Add `oracleSchemas` registry to `packages/game-systems/src/index.ts`.
- Update `docs/tools.md` to match (remove `initialFlags`, add merged `flags`, add
  `openingNarration`).
- Unit tests for the schemas (valid + representative invalid shapes).

**Review gate:** schema shapes match spec, docs consistent. Commit.

---

## Phase 2 — Anthropic Client + Synthesis Prompts & Coherence

No write path, no endpoint. Pure outbound logic, fully unit-testable with mocks.

- `apps/zoltar-be/src/anthropic/` module + service: `callMessages()` wrapping
  `@anthropic-ai/sdk`, model/maxTokens defaults, key from `ConfigService`. Add
  `zod-to-json-schema` dep.
- `synthesis.prompts.ts`: `SYNTHESIS_SYSTEM_PROMPT`, `formatCharacterProse`,
  `formatOracleEntry`, `buildMothershipSynthesisPrompt`, `SYNTHESIS_TOOLS`, plus
  coherence prompt + `coherenceReportSchema`.
- `SynthesisService` skeleton with `checkCoherence()` and `runSynthesis()` methods
  that call `AnthropicService` — no DB writes yet, returns parsed tool input.
- Unit tests: prompt string shape, coherence `proceed`/`reroll`/`surface` branches
  (reroll substitution, pool-exhaustion → surface), Anthropic mocked throughout.

**Review gate:** prompts verbatim from spec, coherence tiering correct. Commit.

---

## Phase 3 — `submit_gm_context` Write Path + Auto-Promote

The DB-touching core. Transactional, self-contained — ideal standalone review.

- Pre-write validation: `adventure_complete` present, `initialState` parses against
  `MothershipStateSchema`, no duplicate entity ids.
- Transaction: insert `gm_context`, upsert `campaign_state` (merging with existing
  player HP/stress pools via `buildResourcePools` helper), insert `grid_entity` rows
  for positioned entities, flip `adventures.status` to `ready`.
- `autoPromoteCanon(adventureId)` shared helper (will be reused in M6).
- Follow existing repository pattern — extract the DB ops into
  `synthesis.repository.ts` rather than calling Drizzle from the service.
- Unit tests for validation failures; integration test (`*.spec-int.ts`) against the
  test DB with a mocked Anthropic payload verifying all four tables + auto-promote.

**Review gate:** transaction rollback behavior, resource-pool merge correctness,
repo pattern respected. Commit.

---

## Phase 4 — Synthesis Endpoint + Adventure GET Update

Thin HTTP layer wiring everything together.

- `synthesis.controller.ts` + `synthesis.module.ts`, register in `AppModule`.
- `POST /api/v1/campaigns/:campaignId/adventures/:adventureId/synthesize`: auth,
  membership check, preconditions (status `synthesizing`, character sheet exists),
  system-specific oracle validation (422), async kickoff returning `202`.
- Failure path: on any Claude or write failure, set `adventure.status = 'failed'`,
  persist `{ error }` into `gm_context.blob` for debug, never leak SDK error text.
- Extend `GET /campaigns/:id/adventures/:id` to include `openingNarration` when
  `status === 'ready'` (read from `gm_context.blob`).
- Controller unit tests + one integration test covering the happy path end-to-end
  with mocked `AnthropicService`.

**Review gate:** auth/preconditions/response codes match spec, async kickoff
behaves. Commit.

---

## Phase 5 — Frontend Solo Blind Flow

Wire existing M3 components to the real backend.

- On "Synthesize Adventure": POST to the endpoint with oracle selections + optional
  addendum.
- Loading state: poll `GET /campaigns/:id/adventures/:id` every 2s; handle `failed`
  with retry, 60s timeout message.
- 409 `coherence_conflict` handling on the oracle step with inline conflict
  descriptions.
- Review screen: render `openingNarration`, GM-layer entity summary panel,
  "Begin Adventure" button; inject opening narration as first assistant message in
  the log.
- Manual browser check of golden path + failure/conflict/timeout flows.

**Review gate:** full end-to-end creation works against real backend. Commit.

---

## Phase 6 — Character Sheet Schema Cleanup

Remove `currentHp` and `stress.current` from `MothershipCharacterSheetSchema`.
These fields are creation-time noise: a fresh Mothership character always starts
at full HP (`maxHp`) and zero stress. The live values live in
`campaign_state.data.resourcePools` once `deriveMothershipCharacterResourcePools`
seeds them at character creation.

- `packages/game-systems/src/mothership/character-sheet.schema.ts`: drop
  `currentHp`, rename `stress` to `maxStress: z.number().int().min(1)`.
- `packages/game-systems/src/mothership/character-pools.ts`: update derivation
  to use `maxHp` for both `current` and `max`; stress derives as
  `{ current: 0, max: maxStress }`.
- `apps/zoltar-be/src/synthesis/mothership/synthesis.prompts.ts`: update
  `formatMothershipCharacterProse` to drop the now-absent fields.
- Frontend character creation form: stop sending `currentHp` and
  `stress.current`; adjust field bindings.
- Migration: write a V10 (or next) Flyway migration that strips the removed
  fields from any existing `character_sheet.data` JSONB blobs in-place.
- Update all affected tests (schema specs, character-pools spec, prompt spec,
  character service spec, integration tests with character fixtures).
- `docs/decisions.md`: add entry clarifying that `character_sheet.data` stores
  the character's identity and build (class, stats, saves, skills, equipment)
  while live mutable numeric state (HP, stress, ammo) lives exclusively in
  `campaign_state.data.resourcePools`. The character sheet has no `current`
  fields — only ceilings (`maxHp`, `maxStress`) used to derive the initial
  pool values at creation time.

**Review gate:** schema, derivation, prompts, frontend form, and migration all
consistent; existing tests updated, no regressions. Commit.
