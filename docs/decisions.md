# Decisions Log

Zoltar is an AI-GM platform for solo and small-group tabletop RPG play.

This log is a lightweight record of significant technical and architectural decisions made during design and development.

The design document (`docs/zoltar-design-doc.md`) captures the major product and architecture decisions; this log covers decisions made during implementation planning that aren't fully documented there.

Each entry records what was decided, what the alternatives were, and why.

---

## Architecture & Backend

### ORM: Drizzle over TypeORM

Drizzle's approach to Row Level Security is cleaner than TypeORM's — setting Postgres session variables and working with RLS policies requires less ceremony. Drizzle also produces more predictable SQL and infers TypeScript types directly from the schema definition at compile time, with no generation step. TypeORM is the NestJS default but not the right fit here.

### Migrations: Flyway over drizzle-kit

Flyway is ORM-agnostic and produces plain SQL migration files that are inspectable, version-controlled, and portable. Drizzle-kit generates SQL from schema diffs, which is useful during development but ties migration management to the ORM. Running Flyway from a Docker container in the Compose stack eliminates the JVM overhead concern. The two tools are not in conflict — drizzle-kit can be used for schema diffing during development while Flyway owns what actually gets applied.

### No circular FK between `adventure` and `gm_context`

An earlier design put `gm_context_id` on `adventure` as well as `adventure_id` on `gm_context`, creating a circular FK that required a nullable column and a three-step insert (adventure → gm_context → update adventure). Dropped in favour of a unidirectional reference: `gm_context.adventure_id` with a unique index. Lookup in either direction is a single indexed query.

### `session` renamed to `adventure`

The domain concept is an adventure, not a session. Sessions in the traditional sense are a social scheduling artifact that dissolves in solo async play. Adventures are the first-class domain concept — they own the GM context, messages, and game events. The table is named `adventure` rather than `session` throughout.

### No `@nestjs/cqrs`

The API follows a CQRS-flavored pattern with clean separation between the command path (GM pipeline) and the query path (direct DB reads), enforced by NestJS module boundaries. The formal `@nestjs/cqrs` command/query bus infrastructure adds overhead without meaningful benefit at this scale. Module separation achieves the same discipline.

### No event sourcing

ES is a natural fit for games in theory but awkward with an AI GM layer — Claude's responses aren't deterministic, so replaying events doesn't reproduce the same narrative. The message log plus state snapshot approach provides most of the practical ES benefits (audit trail, session reconstruction, correction without deletion) without the full ceremony.

### `@uv/auth-core` and `@uv/service-interfaces` are separate packages

Both packages exist so the future closed-source SaaS implementation repo can import abstract classes without depending on the open-source backend app. The split between the two packages reflects a difference in consumer profile: `AuthService` is a cross-cutting concern relevant to frontend-adjacent code (session validation, future SSR auth checks) and may be consumed outside a pure backend context. The six remaining service interfaces (`EntitlementsService`, `MeteringService`, `EmailService`, `AssetStorageService`, `RealtimeService`, `FeatureFlagService`) are backend-only concerns with no plausible frontend consumer. Keeping `auth-core` separate preserves the existing package boundary established in M1 and avoids mixing concerns that evolve at different rates.

### Explicit `status` column on `adventures` table; no inference from `gm_context` row presence

An earlier design derived adventure status from whether a `gm_context` row existed for the adventure. Row absence is ambiguous: it could mean synthesis is in progress, synthesis failed, or a bug prevented row creation. There is no clean way to represent synthesis failure without an explicit status field. An explicit `adventure_status` enum column (`synthesizing`, `ready`, `completed`, `failed`) makes status queryable without a join and allows the `failed` state to be surfaced to users rather than leaving them with a stuck adventure. The column is added in V9 migration with a back-fill for any existing adventures.

### Magic link auth is backend-owned; Auth.js is not used

Auth.js (`@auth/sveltekit`) requires SvelteKit's server-side hooks infrastructure to function. The frontend is a pure Svelte 5 SPA with no SSR or server-side hooks, so Auth.js cannot be used. Rather than pull in SvelteKit as a dependency for a single feature, magic link auth is implemented natively in the NestJS backend: the backend owns token generation, email delivery, session creation, and session validation. The `user`, `session`, and `verification_token` tables from V1 (originally created in the Auth.js schema format) are used as-is — we write to them directly. `AuthService.validateSession()` is unchanged: it reads the `session` table regardless of how the session was created.

### Frontend is Svelte 5 SPA, not SvelteKit

SvelteKit's SSR and routing conventions add complexity without meaningful benefit for this product: the GM pipeline is entirely backend-driven, there is no SEO requirement, and the auth flow is owned by the backend. A plain Svelte 5 + Vite SPA is simpler to reason about, has no server-side rendering surface, and makes the frontend/backend boundary explicit. The tech stack entry in the design doc and README reflects this: "Svelte 5 (SPA)" not "SvelteKit."

---

## Claude Integration — Tool Schemas & State

### Tool use over prompt instructions for structured output

Claude is required to call `submit_gm_response` and `submit_gm_context` rather than producing structured JSON in plain text. Tool use enforces the schema at the API level and eliminates a whole category of malformed response runtime errors. Prompt instructions alone are not sufficient for this guarantee.

### HP and all numeric resources in `resourcePools`, not a separate `entities.hp` field

An earlier design gave entities a special `hp` field alongside `resourcePools`. Folded into `resourcePools` for consistency — HP is a resource pool mechanically, and the threshold behavior (death, unconscious) is handled by the validator reading pool definitions from the system Zod schema, not by special-casing field names. This keeps the schema extensible across systems that track hit points differently.

### Character sheet stores identity and build, not live mutable state

`character_sheet.data` carries the character's identity (name, class, entityId), build (stats, saves, skills, equipment), and ceilings (`maxHp`, `maxStress`). It does not carry current HP or current stress — those are mutable values that change during play and live exclusively in `campaign_state.data.resourcePools` as `{entityId}_hp` and `{entityId}_stress`. At character creation time, `deriveMothershipCharacterResourcePools` seeds the pools at full HP and zero stress from the ceilings. An earlier design kept `currentHp` and `stress: { current, max }` on the sheet, but these drifted from the authoritative pool values the moment play began and served no purpose after creation.

### Pool validator applies full delta before threshold detection

When a resource pool delta would cross a threshold (death, panic, etc.), the full delta is applied first and threshold crossings are detected on the resulting value. The delta is never pre-capped. If a goblin with 7 HP takes 9 damage, the result is -2 HP — the death threshold is crossed and Claude is notified of both the final value and which thresholds fired. Pre-capping would silently discard mechanically meaningful information.

### Pool behavior defined in system Zod schema, not hardcoded in validator

Each pool definition in the system Zod schema carries `min`, `max`, and `thresholds` metadata. The validator reads this rather than hardcoding HP-specific or system-specific logic. A pool with `min: null` can go negative; `min: 0` is floored at zero. This keeps the validator generic and system-agnostic.

### Entity death does not auto-zero prefixed pools

When an entity's `status` flips to `'dead'`, the validator does not automatically zero resource pools whose keys are prefixed with that entity's id. Claude must send explicit pool deltas alongside the status change. An earlier playtest-tool prototype auto-zeroed to work around Claude forgetting; M6 opts for explicit behavior to keep the correction mechanism as the single channel for state-change feedback. Revisit if playtest data shows the omission happens often enough to cause drift.

### Entity and resource pool identifiers use underscores only

Dots in identifier strings cause subtle bugs when code uses dot-notation property access on JSON keys. Hyphens are legal but inconsistent with TypeScript naming conventions. Underscores are unambiguous. Resource pools follow the pattern `{entity_id}_{pool_name}`: `dr_chen_hp`, `vasquez_stress`.

### `diceRequests` IDs assigned by the backend, not Claude

An earlier design had Claude generate UUIDs for dice request entries. Claude doesn't generate UUIDs reliably. The backend assigns IDs after receiving `submit_gm_response` and returns them in the action response. Claude omits the ID field entirely.

### State snapshot field consolidation deferred to Milestone 1.2

The snapshot has accumulated fields across playtesting — `initialState` counters, `world_facts` scratchpad, character state, entity positions, and flags — each solving a distinct problem as it was discovered. At 1.2, when the tool schema is being locked, both sides of the read/write contract should be rationalized together: what Claude reads in the snapshot and what it writes via tools. Doing this earlier would be premature; the playtest data doesn't exist yet to inform good consolidation decisions.

### `flags` structure merges value and trigger into a single object

An earlier design kept flags and flag triggers as two parallel top-level maps in campaign state: `flags: Record<string, boolean>` and `flagTriggers: Record<string, string>`. These were merged into a single structure keyed by flag name:

```typescript
flags: Record<string, { value: boolean, trigger: string }>
```

Keeping them parallel required maintaining two maps in sync — a flag with no corresponding trigger entry was an invisible bug waiting to happen. The merged structure makes each flag self-contained. The trigger is immutable after initialization (it describes the in-fiction condition that flips the flag, which doesn't change). `stateChanges.flagTriggers` on the `submit_gm_response` write path only carries the new value (`{ flagName: newValue }`) — it does not restate the trigger.

### Player resource pools are derived at character creation, not at synthesis

Player HP and stress pools (e.g. `vasquez_hp`, `vasquez_stress`) are written into `campaign_state.data.resourcePools` at the moment the character sheet is created — not later, and not re-derived by synthesis. The derivation is a pure function in `@uv/game-systems` (`deriveMothershipCharacterResourcePools`) that maps `{ currentHp, maxHp, stress }` from the sheet onto the canonical `{entity_id}_{pool_name}` naming convention. `CharacterService.create` calls `CampaignRepository.mergePlayerResourcePools` immediately after inserting the sheet; the merge is transactional and preserves any existing pools on key conflict.

An earlier approach deferred the derivation to the synthesis write path, on the theory that state-population should happen in one place. This coupled synthesis to character-sheet internals across systems and created an ordering hazard: if synthesis ever runs before character creation (e.g. pre-generated adventures, Collaborative mode), the player pools would never exist. Doing the write at character creation makes the invariant easy to state — "once a character sheet exists, its pools exist" — and means the synthesis path only writes NPC/threat/timer pools generated by Claude. `buildResourcePools` in the synthesis write path preserves any pool keys already present, so the two writers never race each other.

### Synthesis prompts are system-specific; no driver registry yet

Each supported game system owns its own synthesis prompt module under `apps/zoltar-be/src/synthesis/<system>/synthesis.prompts.ts` (currently only `mothership/`). System-specific exports — system prompt, character-sheet prose formatter, synthesis user prompt, coherence check prompt, and the canonical oracle-category list — are all prefixed with the system name (`MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT`, `formatMothershipCharacterProse`, etc.) so names never falsely suggest cross-system generality. Universals — the `submit_gm_context` and `report_coherence` tool definitions and the coherence report Zod schema — live in `src/synthesis/synthesis.tools.ts` and `synthesis.schema.ts` and are imported by every system module.

A generic prompt module was rejected because oracle category counts, character sheet structure, and tonal framing all differ across systems; a single parameterized builder would either be the least common denominator or a tangle of per-system branches. A `synthesisDrivers[systemId]` registry was also considered and deferred: until a second system exists, any interface we define is a guess shaped entirely by Mothership's needs, and the second system is more likely to reveal the right abstraction than to conform to a premature one. When UVG (or the next system) lands, the registry pattern can be introduced at that moment with two concrete implementations to compare against.

---

## Claude Integration — Turn Loop & Correction

### Correction loop bounded at one re-prompt

When Claude's proposed state changes fail validation, the backend re-prompts once with a structured `tool_result` describing the rejections and waits for a corrected `submit_gm_response`. If that second response also fails validation, the turn aborts with 502 and the entire turn transaction rolls back — leaving only the player-message row that was persisted before the Claude call. Not two retries, not a budget — a hard cap at one re-prompt.

The cost of a correction round is one extra Claude API call on a path that should be rare in practice; compounding two rounds doubles that cost and masks the real problem, which is either a bug in the validator rules or a model that needs prompt work. Playtest evidence should drive validator tuning and prompt revision, not a larger retry budget. If the cap proves too aggressive, loosen it only after identifying a specific class of rejection that a second retry would have fixed without just papering over a validator-or-prompt bug.

### The correction loop does not re-enter the inner tool loop

M7 introduces an inner tool-use loop in `SessionService.sendMessage`: Claude may call `roll_dice` and `rules_lookup` any number of times before issuing `submit_gm_response`. When the M6 validator subsequently rejects the proposed `stateChanges`, the correction pass re-prompts Claude with `tool_choice: { type: 'tool', name: 'submit_gm_response' }` — explicitly narrowing away from `{ type: 'any' }` — so the correction cannot invoke additional tools. The rejection is handed to Claude as a `tool_result { is_error: true }` and Claude must resubmit directly.

Rationale: dice and rules retrieval are inputs to Claude's reasoning. By the time `submit_gm_response` arrives, those tools have already done their work against the live fiction. If the proposed state changes are invalid, the fix is narrative (restate the same fiction with a valid delta), not mechanical (re-roll). Letting the correction path re-invoke `roll_dice` would also make dice-outcome manipulation possible ("that wasn't the result I wanted, reroll until validation passes") — a principle violation that's easy to avoid by construction.

Implementation: `buildCorrectionRequest` in `session.correction.ts` hardcodes `toolChoice: { type: 'tool', name: 'submit_gm_response' }` in its return, overriding whatever was on the original request. The unit test `session.correction.spec.ts` asserts this override explicitly.

### `rules_lookup` calls are captured in `adventure_telemetry.payload.rulesLookups`, not in `game_events`

Every `roll_dice` call writes a `dice_roll` row to `game_events` — dice are mechanically consequential, part of the turn's audit trail, and rolls (like player actions and GM responses) carry sequence numbers so the full turn can be replayed from the event log.

`rules_lookup` calls are different in kind. They are metadata about how Claude arrived at a ruling, not state changes. The player is not entitled to see every query the Warden made; the tool is a reasoning aid. Recording lookups in `game_events` would (a) pollute the player-visible event stream with Warden internals, (b) require inventing a "lookup" actor_type / payload shape for data that never affects state, and (c) couple the lookup-telemetry schema to the game_events sequence-number contract for no operational benefit.

Instead, `rulesLookups: RulesLookupRecord[]` lives in `adventure_telemetry.payload` alongside the turn's prompt snapshot, Claude request/response metadata, and validator output. Playtest review tooling (M7.1) reads from that row and can surface lookups — including empty-result ones, which are the primary signal for M7.2 ingestion prioritization — without touching the event log.

The record carries `query`, `limit`, `resultCount`, `topSimilarity`, and `sources` (citation strings). Full chunk text is deliberately omitted: re-running the query at review time reproduces the chunks deterministically until the index is re-ingested, and storing them inline would bloat the telemetry JSONB without marginal benefit. If Phase 2 review surfaces a need for full-text capture, a `texts: string[]` field can be added.

---

## Claude Integration — Continuity & Spatial

### Phase 1 spatial consistency is prose-based, not structured

The `grid_cell` and `grid_entity` tables exist and are migrated, but no generation pipeline populates them and no runtime system queries them. Phase 1 spatial consistency — making sure the ship layout stays coherent across turns — is handled by `worldFacts` entries authored by Claude during synthesis and maintained during play. The Warden prompt directs Claude to record the location's overall layout in `worldFacts` at synthesis time and to consult and extend those entries when narrating spatial relationships.

This matches how Mothership is designed to play: theater-of-the-mind, where the fiction is the map. It also matches the mechanism already validated in Playtest 3 for the same class of problem (corridor lengths, named spatial attributes) — the existing scratchpad generalizes cleanly to "overall layout" as one more first-mention detail that must stay consistent.

A structured map model — generated room graphs, cell grids, LOS computation — is a significant engineering investment with no playtest evidence that it's needed. Deferring it keeps M5 unblocked and avoids building against imagined rather than observed failure modes. The grid tables remain migrated but unused; they cost nothing to leave in place, and the `map_geometry` stub reservation still stands.

This decision is a deferral under uncertainty, not a final answer. The next Phase 1 playtests should watch for spatial-consistency failures — contradictory room connections, forgotten deck assignments, layout drift across long sessions. If prose-based layout holds up, the deferral is validated. If it breaks down in characteristic ways, those failure modes become the design input for a real spatial system, to be built with evidence rather than speculation. The M5 roadmap entry is updated accordingly: LOS computation service is removed, and the state snapshot builder's "no entity positions" note no longer points to a pending spec.

### Phase 1 continuity is carried by cached GM context and working-memory fields, not a rolling summary

The original M5 design included a rolling summary stored in `adventures.rolling_summary`, lazily generated at adventure resume to carry continuity across messages that age out of the rolling window. Dropped from M5 pending playtest evidence that the gap exists.

The cached GM context — which in Solo Blind mode accumulates auto-promoted canon as play progresses — plus `npcStates` and `worldFacts` in `campaign_state.data` already cover most of what the summary was specified to capture. The design doc's summarization guidance ("prioritize uncanonized improvised fiction, NPC behavior, lies told, relationships formed, specific physical details") maps almost entirely onto what the canon queue and the working-memory fields already preserve. The summary's unique contribution is narrow: narrative texture and sequence that didn't produce discrete canonizable facts, only relevant in adventures long enough that the message window can no longer hold the arc.

Shipping the summary now would add a second Claude call per resume, a new column for cutoff tracking, and a prompt that can't be tuned without evidence. Observing whether Phase 1 play actually suffers from narrative-continuity loss without the summary is a cheaper first step than engineering against a failure mode that may not occur.

The `adventure.rolling_summary` column from M1 remains in the schema and stays null through Phase 1. If the gap surfaces in playtest — contradictions about fiction that aged out of the window, forgotten relationships or lies, sequence errors across long adventures — the rolling summary can be added as its own milestone, likely alongside campaign canon promotion tooling in Phase 2 where the related "what persists across adventures" questions already need answering.

This decision is a deferral under uncertainty, not a final answer. The next Phase 1 playtests should watch for narrative-continuity failures of the specific kind the summary was designed to prevent. If the cached GM context plus working-memory fields hold up, the deferral is validated. If it breaks down in characteristic ways, those failure modes become the design input for the summary, to be built with evidence rather than speculation.

### The `<character_attributes>` snapshot block is specified but deferred until a data source exists

The M5 spec, the design doc's state-snapshot section, and the M5 roadmap bullet all reference a `<character_attributes>` block — persistent qualitative character state (armor mode, weapon loadout, active conditions) emitted in the per-turn snapshot. The M5 snapshot builder has no source to populate this block from: `MothershipCampaignState` carries no `characterAttributes` field, synthesis does not write one, and the Mothership character sheet shape (`equipment: string[]`, `saves.armor: number`) does not cleanly separate armor from loadout or carry conditions. The block is omitted in M5 per the spec's "omit an entire block if its source is empty or missing" rule.

This is not a question of whether the concept is right — it clearly is, and the design doc describes it correctly. The question is *what writes it*. Populating the block requires either a schema addition plus a synthesis write path, or a derivation from character-sheet data that would require extending the character-sheet shape to separate armor/loadout/conditions. Neither is load-bearing for M5's goal of closing the outer GM turn loop; all mechanically critical state lives in resource pools, entities, flags, and world facts.

The block becomes genuinely useful when the game engine starts reading armor/conditions mechanically — that's M6 (state-change application of condition toggles) or M7 (roll resolution that consults armor). Reactivate at the milestone that first needs the data. At that point the schema, the write path, and the snapshot rendering can be designed together against concrete usage, rather than guessed at now.

The three doc references stand unchanged — they describe the intended end state. The M5 snapshot builder simply does not render this block. When the data source lands, the builder is a two-line addition (one render function, one call site) following the same pattern as the other blocks.

### Message ordering relies on `createdAt` only; no shared sequence key with `game_events`

The `messages` table has no `sequence_number` column, unlike `game_events`. Reconstruction and message-window ordering (`buildMessageWindow`) rely purely on `createdAt` timestamps. Player and GM messages for the same turn are not written in the same transaction — the player message commits first, in its own transaction, before the GM call runs (intentionally, so a retry can reproduce the player's action) — so there is no transactional guarantee of ordering either, only the practical guarantee that a player's message is always written before the GM's response to it.

This is adequate today and is not being changed. The current production shape — a single backend instance, self-hosted, solo async play with human-paced turns seconds-to-minutes apart — has essentially no exposure to ordering ambiguity: Postgres timestamp precision is far finer than the gap between any two real messages, and there is only one clock in play.

Two conditions would change that:

- **Multi-instance deployment** (Phase 3+ SaaS, per the stateless-scaling design), if `createdAt` values are ever assigned application-side (each Node process reading its own clock) rather than DB-side. Cross-instance clock skew becomes a live vector for inverted ordering only once there's more than one clock generating timestamps.
- **Synchronous multiplayer with tight timing** (Phase 2 — Ably, live typing preview, initiative-mode combat), where sub-second sequencing might actually matter for narrative correctness in a way solo async play never surfaces.

Deferred under uncertainty, consistent with the project's general bias against fixing failure modes that haven't been observed. Revisit — adding a per-adventure sequence key to `messages`, mirroring `game_events`' existing `(adventureId, sequenceNumber)` pattern — if or when multi-instance deployment or synchronous multiplayer work begins, rather than before.

---

## API & Data Model

### Narrative and dice-result submissions are separate endpoints, not a discriminated union under `POST /actions`

Earlier drafts of `docs/api.md` specified a single `POST /api/v1/campaigns/:id/adventures/:id/actions` endpoint with a discriminated-union request body: `{ type: 'narrative', content } | { type: 'diceResult', requestId, notation, results, source }`. The M7 implementation ships two separate endpoints instead: `POST /messages` for narrative turns and `POST /dice-results` for dice submissions. `docs/api.md` has been updated to match what actually ships; this entry records why.

The two operations turned out to diverge on every substantive axis — different Claude-invocation behaviour (narrative always calls, dice only when `autoAdvance` resolves the last pending request), different response shapes (turn payload vs. resolution metadata with an optional nested turn), different failure modes (`dice_pending` vs. `dice_request_conflict` / `dice_result_invalid`), different resource semantics (a GM turn vs. a resolution of a specific `dice_request`). A discriminated union would reconcile the request bodies but not the responses; the FE still branches on `type` to know what to render, so the union is ceremony rather than simplification.

Two endpoints with distinct error codes also self-document failure modes better than one endpoint with a union of error shapes. The controller already shares the turn-error translator (`translateTurnError`) and the `SendMessageResult → TurnPayload` serializer (`serializeTurn`) across both paths, so there is no duplication to amortize by merging the URLs.

The tradeoff accepted here: if M8 adds further player actions (caller transfer, advance initiative), those will live at their own nouns (`/caller`, `/initiative`, etc.) rather than being bundled under `/actions`. This is acceptable — the surface area stays small per endpoint, each gets its own test file and failure taxonomy, and the alternative (growing a union-typed action endpoint) would accumulate branch complexity inside one handler faster than it accumulates URL count. Revisit if the endpoint list becomes genuinely unwieldy (> 8–10 player-action endpoints) or if M8's caller/initiative work surfaces tight coupling that a unified endpoint would simplify.

### Campaign canon is separate from adventure canon

Adventure GM context blobs are scoped to a single narrative arc. Promoted canon within an adventure is correct at that scope. But facts with campaign-level significance — an overarching antagonist's scheme, a surviving NPC, a faction relationship — need a persistent home that synthesis for future adventures can read.

`campaign_canon` is that home. It mirrors the `pending_canon` lifecycle (same status enum, same review pattern) but scoped to the campaign. Promotion to campaign canon is a second, deliberate editorial step at adventure completion — not automatic, because not every adventure-level fact warrants permanence at the campaign level.

The alternative (feeding prior adventure summaries and GM context blobs directly into synthesis) was rejected because synthesis complexity would grow with campaign length, and there would be no explicit record of what the campaign author considered canonical world truth vs. adventure-local detail.

### One active adventure per campaign

Campaigns are limited to one adventure in a non-completed, non-failed state at a time. A new adventure cannot be created while another is `synthesizing`, `ready`, or `in progress`. This matches solo play conventions and simplifies the state model. Completed and failed adventures remain visible (toggled by default) but do not block new adventure creation.

### `adventure_telemetry` vs session export are distinct artifacts

These are two different things that were originally both called `adventure_log`. They serve different purposes and must not be conflated. `adventure_telemetry` is infrastructure-level diagnostic telemetry — one row per turn in a DB table, containing the full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, the state snapshot sent to Claude, and prompt/completion token counts. It exists to diagnose pipeline bugs and is not player-facing. The session export is the player-facing portable format — a single JSON file containing the message log (with turn numbers and timestamps), canon log, turn-level state deltas, final state snapshot, and GM context. It supports session restore and post-session analysis. It is produced on demand, not written per-turn to a DB table. Mixing these concerns into a single artifact would make `game_events` harder to query for its application-level purpose and would conflate player-facing data portability with internal diagnostic tooling.

---

## Frontend & Design System

### No utility framework — plain Svelte scoped styles

Tailwind and similar utility frameworks were considered and rejected. The atomic class approach makes HTML harder to read and works against a strong per-system visual identity. More importantly, genre-specific theming (horror for Mothership, high fantasy for OSE, etc.) requires styles that are closely coupled to a semantic token layer — a utility framework adds friction without meaningful benefit in that model. Component styles live in Svelte's scoped `<style>` blocks. No utility framework is a dependency.

### Two-tier CSS custom property token system

Theming is implemented via a two-tier CSS variable system. Primitive tokens (`--color-slate-950`, `--font-size-lg`) define the raw design vocabulary and never change between themes. Semantic tokens (`--color-surface`, `--color-text-primary`, `--color-accent`) map purpose to primitives and are what themes actually swap. Components reference semantic tokens only — never primitives directly. This ensures a theme swap is a single token layer substitution, not a component change.

### Theme switching via `data-theme` attribute

The active theme is applied by setting a `data-theme` attribute on the root element. Each theme is a CSS file defining the semantic token layer (e.g. `themes/mothership.css`, `themes/fantasy.css`). The primitive token definitions live in `themes/base.css` and are always loaded. This approach requires no JavaScript theming library and works naturally with Svelte's reactivity.

### Bits UI for headless accessibility primitives

No opinionated component library is used. Bits UI (the Svelte 5 headless primitive library, successor to Melt UI) is used for accessibility-critical interactive patterns — modals, dropdowns, tooltips, focus traps — where rolling bespoke implementations would be high-risk. All visual styling of Bits UI primitives is owned by the application. This gives accessibility correctness without importing a competing design language.

### Mobile-first design — layouts originate at mobile size

All UI layouts are designed at mobile size first and expanded for larger viewports. This applies from the pre-M3 design sprint forward and is a constraint on all subsequent frontend work. The M9 "layout pass" is a responsive polish pass, not the origin of mobile layout decisions. The play view in particular — message log, input field, character status, dice UI — is a constrained layout problem better solved small-to-large than large-to-small.

---

## Oracle Tables

### Oracle filtering data model includes count fields despite range UI being deferred

Each oracle category preference record stores `count_min` and `count_max` fields (defaulting to `1/1`) even though the range dial UI is not built in Phase 1. The activate/deactivate pool and the pick-count concept are cleanly separable — the pool model is identical regardless of how many entries are drawn. Adding the fields now avoids a schema migration when variable counts are introduced. The UI commitment is deferred until there is a concrete scenario requiring it (likely Phase 2).

### Oracle filtering UI: activate/deactivate only, no range controls in Phase 1

The oracle filtering UI exposes entry-level activation toggles, select all/deselect all per category, and a submission gate requiring at least one active entry per category. Range dial controls are out of scope for Phase 1. The data model supports variable counts from day one, but the UI will default to picking exactly one entry per category until range controls are designed and built. This keeps the MVP UI simple and avoids designing a UX pattern before there is a concrete use case to design against.

---

## Eval Harness

### `checkId` does not encode `checkMode`

A check's `id` (`out-of-order-resolution`, `hidden-info-leak`) is the failure-mode tag in lower-kebab, deliberately never including `structural`/`judged`. `UNSURFACED-CHECK` has already migrated modes once in this repo — its regex-based structural classifier missed a stakes-gating roll phrased as a question ("Does anything react to Alvarez moving...") rather than using a fixed keyword, so it moved to a judge call after a real-run false pass. `eval:compare` pairs history on `(fixtureId, checkId)`; if the id encoded mode, that migration would have silently un-paired every historical comparison for the check the moment it moved. `checkMode` stays its own column on the score row instead, so a check can migrate modes without breaking the very comparisons that would tell you whether the migration helped.

### One check per fixture today, but the row format is N-ready

`selectChecksForFixture` returns an array, and every downstream reader — score rows, rate computation, comparison — is built against "a fixture may have N checks." Today it always returns exactly one, because a judged check needs per-fixture `assertion.facts` (`perceptionBoundary`, `expectedScope`, …) that only exist for the fixture's own tag: running `HIDDEN-INFO-LEAK` against a `SCENE-JUMP` fixture has no boundary text to grade against, and would cost an API call per fixture-check pair to produce one that doesn't exist. The corpus is what's 1:1 today, not the format — giving a fixture a second check later is a registry change, not a schema migration.

### `warden-output.json` is the full serialized `TurnExecutionResult`, not just `submit_gm_response`

The spec describes the artifact as "full `submit_gm_response` payload." That's not enough on its own: `eval:judge-variance` re-runs judged checks against a frozen artifact with **no database at all** — the scratch campaign is torn down at the end of every fixture run by default — so the artifact has to carry everything a structural checker or the judge needs to re-evaluate the turn. The judge summarizes the whole tool-call sequence, not just the narration, so it needs `gameEvents`; structural checkers additionally need `telemetry`/`pendingCanon`/`diceRequests`/`campaignState`. `warden-output.json` is a strict superset of `submit_gm_response`'s payload — the serialized `TurnExecutionResult`, with the narration living inside its `gm_response` game event. Anything narrower makes `eval:judge-variance` impossible without either re-seeding a scratch campaign per re-evaluation or keeping every scratch campaign alive forever, which would defeat the reason `--keep-scratch` defaults to off.

### `harnessVersion` is the git short SHA, not a hand-maintained constant

Recorded per rep and per row as `git rev-parse --short HEAD`, with a `-dirty` suffix when `apps/zoltar-be` has uncommitted changes, and `unknown` outside a git checkout. Same argument as `corpusVersion` being a content hash rather than a hand-bumped string: a manually maintained version fails silently when someone forgets to bump it, and the failure mode — two reps labeled identically under different checker semantics — poisons exactly the weeks-apart append the field exists to disambiguate.

### `error` is a fourth verdict, not folded into `fail`

M7.4's `runHarness` mapped any turn that didn't complete — a live model call producing output that failed schema validation, the inner tool loop exhausting its iteration cap, a checker rejecting a malformed fixture — to a **failed** `FixtureResult`, with a comment explaining that aborting the whole run over one flaky turn was worse than mislabeling it. That comment was right about the tradeoff and wrong about the fix: a transient failure and a real regression are different events, and conflating them under `fail` corrupts the one number (`pass / (pass + fail)`) the harness exists to produce. `error` is its own verdict — excluded from the denominator but counted and surfaced in `eval:report`'s Errors section, so it can never be silently absorbed into a regression-looking rate. Confirmed for real during the multi-run harness's own manual verification: the inner tool loop hit its 20-iteration cap on a busy off-screen-combat turn, and the resulting row correctly read as `error`, not as a phantom SCENE-JUMP failure.

### `eval:judge-variance` writes beside the run, not into `reps/`

`reps/*/scores.jsonl` rows mean "one observation of generator and grader together" — every pass-rate denominator in `eval:report`/`eval:compare` assumes that. A grader-only re-run against frozen input is a different measurement and would corrupt those denominators if appended there. Its output lives in `<run-dir>/judge-variance/<timestamp>.jsonl` instead — an extension beyond the spec, which doesn't say where this command's output goes.

### `eval:harness` retired, not kept alongside `eval:run`

The multi-run harness's whole premise is separating execution from rendering — `eval:run` writes score rows, `eval:report` reads them, and nothing downstream parses markdown. Leaving `eval:harness` in place would have kept a second write path producing no score rows, which is the thing this milestone existed to eliminate. `eval:replay` survives — repointed at the unified check registry — and gained an artifact-based mode (`--run-dir --rep`, no database), covering the quick single-fixture-iteration use `eval:harness` was also serving.

### Judge verdicts stay binary — no confidence scoring

`judgeVerdictSchema` is `{passed, rationale}` and always has been. A row schema drafted for this milestone listed `judgeConfidence?: number` as a field a rubric could conditionally emit, but no rubric does, because self-reported LLM confidence was rejected earlier in this project's design. That decision predates the multi-run harness and was never written down anywhere except the shape of `judgeVerdictSchema` — recorded here because the new score row was the first place a reviewer might reasonably ask "where's the confidence column," and the honest answer is that a permanently-empty optional field reads as an invitation to fill it, not as a decision. JSONL rows are append-friendly, so if a rubric ever does emit one, adding the field later is non-breaking — old rows simply lack it.

### `eval:compare`'s mixed-rubric warning groups by `checkId`, and `--filter-rubric` is scoped to one check

`detectHeterogeneity` originally counted distinct `rubricHash` values across an entire run and warned whenever there was more than one. Since `rubricHashFor(checkId)` hashes one rubric template per judged check, any run covering more than one judged check spans more than one hash by construction — the warning fired on every multi-check run, unconditionally, and named nothing useful. Worse, `--filter-rubric <hash>` filtered every judged row in both runs against a single hash, so following the printed remedy silently dropped every judged check except one.

The fix groups rubric hashes per `checkId` (not per `tag`, though the M7.4 spec's "one rubric per tag" language and the two are 1:1 in the current corpus) and warns only when one check's own rows span more than one hash — the real signal of a rubric template edited mid-run. `--filter-rubric` became `CHECK=HASH`, repeatable, so a filter aimed at one drifting check can never zero out an unrelated check's rows; the bare-hash form is now a usage error. A filter that would still zero a fixture's denominator is reported on stderr rather than rendered as an unremarkable empty row. `checkId` was chosen over `tag` as the grouping key because the actual data model — `manifest.completedReps[].rubricHashes: Record<checkId, rubricHash>` and `rubricHashFor(checkId)` — is keyed on check, not tag; if a tag ever gains a second check, `tag`-based grouping would coarsen incorrectly where `checkId`-based grouping stays precise.

---

## Monorepo, Tooling & Deployment

### Repo named `unicorn`, not `unicorn-vtt`

The monorepo houses Zoltar and Unicorn VTT. Zoltar is not a VTT — `unicorn-vtt` misrepresents the contents. `unicorn` names the product family correctly.

### npm workspaces over Turborepo

Turborepo deferred until there is a concrete need — parallel builds across many packages, remote caching, a CI pipeline that would benefit from task graph optimization. For a small monorepo in early development, npm workspaces is sufficient and has no additional tooling overhead. Migration to Turborepo is straightforward when the time comes.

### Traefik routes defined in file provider, not Docker labels

Traefik routes for `app.zoltar.local` and `api.zoltar.local` are defined as file-based dynamic config (`infra/traefik/dynamic/host-routes.yml`) rather than as Docker labels on the `backend` and `frontend` compose services. Docker labels only exist on running containers — in Workflow B (the daily development loop), those containers aren't running, so label-based routes produce a 404. File-based routes pointing to `host.docker.internal` work in both workflows: in Workflow B the apps run directly on the host, and in Workflow A Docker publishes container ports to the host. One routing mechanism covers both cases.

### Single `main` branch

No `main`/`develop` split. The value of a develop branch is protecting a stable branch from in-progress work when there are multiple contributors or a CI/CD pipeline deploying from `main`. Neither applies for solo development at this stage. Tagged releases provide the stable reference point. Revisit when there are collaborators or a deployment pipeline that warrants it.

---

## Licensing & Business Strategy

### License: Elastic License 2.0

Consistent with existing Automata Codex projects. Short, readable, and clear on the one restriction that matters: cannot offer the software as a managed service to third parties without permission. Self-hosting for personal or internal use is unrestricted.

### Open-source release proceeds as designed; no closed-source carve-out for prompts or graph orchestration

Considered and rejected: closing the Warden prompts, and/or any future LangGraph-style orchestration logic, as a competitive moat against a funded competitor forking the public repo.

Rejected on threat-model grounds, not technical ones. The TTRPG tooling space doesn't attract funded competition at this scale — campaign/worldbuilding tools have ~3 players with no direct head-to-head competition (e.g. Dungeon Scrawl), VTTs consolidate rather than multiply despite looking easy to enter, and the hobby's active resistance to AI shrinks the addressable market in a way that makes it a poor target for outside funding in the first place. A funded competitor materializing at all is judged unlikely.

Even granting a funded competitor with 3 FTEs, estimated time-to-market with full repo access (architecture, schemas, tool definitions, oracle table structure, and prompts) is ~4-7 months to reach current parity, versus ~7-11 months reverse-engineering from the live app alone — a gap of roughly 2-4 months. That gap is smaller than a plausible solo-dev hiatus and is mostly attributable to the architecture/schema decisions in this log, not the prompt text specifically — so a prompt-only closure wouldn't meaningfully close it anyway, and closing the architecture layer instead would break the self-hosted config-only story (`AUTH_PROVIDER`, `REALTIME_PROVIDER`, etc.) that depends on that layer staying legible.

Real protection against a funded competitor, if one ever appears, is shipping velocity and the eval harness / fixture corpus / failure-mode taxonomy — accumulated evidence that isn't copyable by reading code — plus per-user `campaign_canon` accumulation as a retention moat. These require no licensing decision and are being built regardless.

ELv2 remains the license for the reasons already in this log (managed-service restriction, consistency with other Automata Codex projects) — not as competitive protection, since it offers no real recourse against a "probably but not provably" copy in any case.

This closes the "open-source release decision" previously flagged as unresolved. Public repo, self-hosted-first build sequence, and M9 milestone scope (Docker Compose production config, self-hosted setup guide, DigitalOcean walkthrough) all stand as currently planned.

### SaaS service implementations stay closed source — enforcement rationale, not competitive secrecy

Unlike the Warden prompts and any future graph orchestration logic, the concrete SaaS implementations of the service interfaces (`ClerkAuthService`, `StripeEntitlementsService`, `AblyRealtimeService`, the RLS migration scripts and tenant-aware middleware, etc.) remain closed source when built. This is a different rationale from the open-source decision above and should not be read as contradicting it.

These implementations carry little competitive-secrecy value on their own — they are mostly integration glue against third-party APIs (Stripe, Clerk, Ably) that a competent engineer could reproduce in days regardless of prior access. The moat reasoning that justified keeping the Warden prompts and graph open does not argue for closing these; there was never much moat value here to protect.

The reason to keep them closed is that they are the literal technical mechanism that makes the ELv2 single-tenant restriction real. The open core is single-tenant by omission, not by enforcement — no RLS policies, no tenant-aware query layer, no `org_id` isolation, no billing wiring. If the multi-tenant RLS migrations and Stripe billing logic were included in the public repo, anyone would have the missing piece needed to stand up a competing managed service on top of Zoltar's own code — precisely the outcome the ELv2 restriction exists to prevent, and a more concrete risk than a competitor reading a prompt file.

This costs nothing to maintain, unlike a prompt/graph closed-source boundary would have: self-hosted already runs on structurally different implementations (Noop and local defaults per the service-interface table), so there is no shared artifact to split or distribution boundary to police. It is closed by the natural shape of the interface/implementation split, not by extra engineering effort spent defending it.

---

## Security

### Prompt injection risk acknowledged, not addressed at MVP

Prompt injection — the risk of a player crafting action text that manipulates Claude's behavior or extracts hidden state — is a known risk and is not addressed in Phase 1. At MVP scale (self-hosted, single player, no adversarial users), the risk is low and the engineering investment is not justified. The natural mitigation in SaaS deployment is that prompts are server-side and player input is clearly delimited in the message structure. Revisit before player input is injected into production prompts in a multi-tenant SaaS context. At that point, input sanitization and structural prompt hardening should be specced.
