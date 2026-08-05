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

### Embedding model: `voyage-4-lite`, chosen together with the column dimension

M7 shipped with `VOYAGE_EMBED_MODEL` defaulting to `voyage-3-lite` on the stated assumption that it matched the `vector(1024)` declaration on `rules_chunk.embedding`. It does not — `voyage-3-lite` emits 512 dimensions; `voyage-3` is the 1024-dimensional model of that generation. The error was invisible for the whole of M7 because the index is empty: `RulesRepository.findByCosineSimilarity` filters `embedding IS NOT NULL`, so pgvector never evaluated `<=>` against a row and never raised the dimension mismatch. It would have surfaced on the first M7.2 ingestion run.

The default is now `voyage-4-lite`, which emits 1024 dimensions by default and leaves the column, the `game_system.embedding_dim` seed, and every existing migration unchanged. Choosing it over `voyage-3` also avoids adopting a model Voyage now lists as legacy; the voyage-4 family is current, `voyage-4-lite` is the same $0.02/M as `voyage-3-lite`, and legacy models no longer carry a free-token allowance. `voyage-4` and `voyage-4-large` are drop-in step-ups if retrieval quality warrants the cost — same default dimension, no migration.

Two constraints follow, and neither is enforced by the type system: the ingestion model and the runtime `VOYAGE_EMBED_MODEL` must be the *same model*, not merely two models of the same width, or similarity scores are meaningless while looking healthy; and any future model swap must be checked against the column dimension before ingesting rather than after. M7.2's pipeline should validate the returned vector length against `game_system.embedding_dim` before insert — that check is the cheap guard that would have caught this at M7 time.

No eval re-baseline is owed for this change on its own. Both existing baselines ran against an empty index, so no graded turn ever consumed an embedding; the re-baseline that `docs/decisions.md § Warden model upgraded to claude-sonnet-5` anticipates is owed to ingestion itself, not to the model swap.

---

## Claude Integration — Tool Schemas & State

### Warden model upgraded to `claude-sonnet-5`

Declared 2026-08-03 on the evidence of the 4.6 → Sonnet 5 full-corpus baseline, re-scored under the migrated checkers. Sonnet 5 improves on every axis the harness measures where either model is passable at all, and the two axes where it doesn't are axes where *neither* model is acceptable — which makes them prompt targets rather than arguments against the swap.

Same prompt (`97feadbd`), same corpus (`88fa84bd8329`), same N, no orchestration work, single-grader:

| Check | 4.6 | Sonnet 5 |
| --- | --- | --- |
| `out-of-order-resolution` | 0.39 (7/18) | **1.00 (20/20)** |
| `system-rolled-player-action` | 0.18 (3/17) | **0.90 (18/20)** |
| `turn03-unsurfaced-check` | 0.00 (0/10) | **0.70 (7/10)** |
| `turn24-scene-jump` | 0.50 (3/6) | **0.90 (9/10)** |
| `turn24-over-resolution` | 0.33 (2/6) | **0.80 (8/10)** |
| `turn24-hidden-info-leak` | 0.40 (2/5) | **0.89 (8/9)** |
| `turn28-hidden-info-leak` | 0.67 (6/9) | **1.00 (10/10)** |
| `turn21-narrating-past-a-block` | 1.00 (9/9) | 1.00 (10/10) |
| `turn16-narrating-past-a-block` | 0.00 (0/10) | 0.00 (0/10) |
| `unauditable-mapping` (3 fixtures) | 2/29 | 0/16 |

`unauditable-mapping` is nominally *worse* under Sonnet 5, and should not be read that way: 2-of-29 against 0-of-16 is un-rankable on its numerators alone, the same defect described under "Un-rankable is a numerator problem" in `eval-methodology.md`. The correct reading is that both models essentially never state a result-to-meaning mapping before a spontaneous roll, and the harness cannot currently tell them apart on it.

Secondary but not minor: **errors dropped from 18 of 150 rows to 4**, almost all of them the inner tool loop hitting its 20-iteration cap on the `turn24-*` family. That is why three of the 4.6 rates above rest on N=5–6 and should be read as directional. It also means part of the apparent gap on those three fixtures is a difference in error rate rather than in quality — the honest reading is that Sonnet 5 both scores better and finishes, and the second is what makes the first measurable.

Two failure modes survive the swap with real denominators behind them: `unauditable-mapping` (2 passes across 45 judged inputs spanning both models) and `turn16-narrating-past-a-block` (0/10 under both). Both are now confirmed genuine rather than checker artifacts, which is the useful outcome — they are prompt work, and they are the two places prompt work should go first.

**What this decision does not claim.** All figures are single-grader. Both baselines executed against an empty `rules_chunk` index, so nothing here accounts for how rules availability changes reach-for-dice behaviour; the M7.2 re-baseline is the real test of these numbers. At N=10 the 95% CI half-width at p=0.5 is ~±31pp, so individual rates near the middle are unsettled even where the direction is not. And a first run against a new model audits the harness as much as the model — the two defects that audit surfaced are recorded in `eval-methodology.md`, and the rates above are the post-correction ones.

**The judged half of that table is now self-graded, and was already half-way there.** `JUDGE_MODEL` has been `claude-sonnet-5` since the judged checks were built — deliberately above the Warden's 4.6, so a more capable grader sat over the model under test. This decision closes that gap: the Warden and its judge are now the same model. The consequence is retroactive as well as forward-looking, and it is a real confound in the comparison above: on the 4.6 side a Sonnet 5 judge graded a 4.6 generator, while on the Sonnet 5 side it graded itself. Every judged row in the table therefore has an asymmetry the structural rows don't.

Two things bound the damage. `out-of-order-resolution` and `system-rolled-player-action` — which happen to be the two largest and cleanest gains, 0.39 → 1.00 and 0.18 → 0.90 — are structural and reach a verdict with no model in the loop at all. And `eval:judge-variance` measures grader stability against frozen input, which is unaffected by which model produced that input. The judged rows should still be read as directional rather than as clean measurements until an independent grader confirms them.

The alternative — pinning the judge to 4.6 to preserve the gap — was rejected: it trades a self-grading bias for grader drift against a model we no longer ship, which is the worse of the two because nobody would be watching it. Raise the judge above the Warden again when an Opus-tier grader is affordable for routine comparisons.

Mechanically the change is `DEFAULT_SYNTHESIS_MODEL` in `apps/zoltar-be/src/anthropic/anthropic.service.ts`, plus the tech-stack row in `CLAUDE.md`. The eval harness already takes `--model` and needs nothing.

**One runtime consequence to watch.** Sonnet 5 runs adaptive thinking when the `thinking` parameter is omitted; Sonnet 4.6 ran without thinking. `max_tokens` caps thinking *and* response text together, so `DEFAULT_SESSION_MAX_TOKENS` (4096) and `DEFAULT_SYNTHESIS_MAX_TOKENS` (8192) now cover strictly more. No code change was needed — the inner tool loop and `buildCorrectionRequest` both echo `response.content` verbatim, which is exactly what round-tripping thinking blocks requires — and the Sonnet 5 baseline already ran this path at 4096 with 4 errored rows in 150 against 4.6's 18. Watch for `stop_reason: 'max_tokens'` on long combat turns anyway; the headroom is smaller than it was.

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

### Agentic graph decomposition stays deferred; dice-arbitration evidence weakens the case without closing it

The standing deferral on a LangGraph-style decomposition of the turn loop carried a falsifiable criterion: harness results should first show which failure categories resist prompt-level fixes. Dice arbitration reliability was the lead candidate for a category that would, on the theory that reliable sequencing of request → resolution → narration is a control-flow problem a single prompt can't be made to solve.

The 4.6 → Sonnet 5 baseline is evidence against that theory for at least half the category. Under corrected applicability gating, `SYSTEM-ROLLED-PLAYER-ACTION` moved from 3/17 (0.18) to 18/20 (0.90) — with an unchanged prompt (`97feadbd`), unchanged fixture content, and no orchestration work of any kind. A category that responds that strongly to a model swap is not a category that resists non-structural fixes, and rebuilding the turn loop to solve something a model upgrade largely solved would have been the expensive answer to the wrong question.

Three reasons this doesn't close the question:

- **The residual is not cosmetic.** 2/20 means the Warden takes a player's declared action out of their hands roughly one combat turn in ten. In solo play, where the player has no table to appeal to, that's an agency violation rather than a polish item. "Mostly fixed" is a weaker result here than the rate suggests.
- **The measurement predates M7.2.** Both runs executed against an empty `rules_chunk` index, and the runaway-lookup errors show a Warden repeatedly unable to resolve what it was looking for. Rules availability plausibly affects when and how it reaches for dice. Re-measure after ingestion before treating 0.90 as the model's actual ceiling.
- **The sequencing half is measured, and agrees.** `OUT-OF-ORDER-RESOLUTION` reads 0.39 (7/18)
  on 4.6 and 1.00 (20/20) on Sonnet 5 under the structural deferred-gate rule. Both
  dice-arbitration categories therefore respond to a model swap alone. The caveat is that only
  the deferred-gate half is measurable: the in-turn case reports `not_applicable` pending
  `gatedByRollId`. Sonnet 5 defers on every rep, so nothing is currently being missed for the
  model we'd be building against — but that is a property of this model's behaviour, not a
  guarantee, and it will need re-checking whenever roll behaviour moves.

Revised criterion for revisiting: re-baseline after M7.2, and try the cheaper structural option first — the deferred `rollType` / `gatedByRollId` / `actingEntityId` fields on `roll_dice`, which enforce sequencing at the tool schema without decomposing the loop. A graph becomes the right answer only if a measured residual survives both.

An earlier version of this criterion also called for extending the `turn19`/`turn21` fixtures through the follow-up turn, on the theory that a model which splits a to-hit request from its resolution puts the ordering evidence on a turn the fixture doesn't contain. **That is withdrawn.** The violation window is the captured turn: once a gate is deferred, the turn ends, so any dependent roll landing on the follow-up turn is necessarily *after* the gate resolved. Extending the fixtures would have produced a structurally guaranteed PASS and read as evidence of correct sequencing.

### `rollType` / `gatedByRollId` / `actingEntityId` on `roll_dice` stay deferred, but they are measurement infrastructure

These three fields were introduced in the M7.4 spec as a fixture-schema compatibility example and carried forward as a candidate structural fix for the Warden's own sequencing — tighten the tool schema so a dependent roll must name its gate, and out-of-order resolution becomes unrepresentable rather than merely detectable. That framing is incomplete. The checker audit established that the same two fields are what two structural checks need in order to *measure* anything at all:

- `gatedByRollId` — `out-of-order-resolution` can adjudicate the deferred-gate case from a pending `dice_request`, but the in-turn case is undecidable without it. Sequence numbers record what happened first, not what gated what.
- `actingEntityId` — `system-rolled-player-action` cannot attribute a Warden-side roll without it, because `actorType` is `'gm'` for every such roll whether it stands in for an NPC or the player, which is exactly the distinction the check draws. The current binding is a prose convention and is the last prose dependency in the structural checks.

So the fields are not only a possible fix; they are the precondition for knowing whether a fix is needed. Until they land, both checks report `not_applicable` naming the missing field rather than approximating it with a regex — the deliberate cost being denominator, per "Structural checks report undecided rather than guessing" below.

**Still deferred**, and the reason is unchanged: adding fields to `roll_dice` changes the tool schema, which changes what reaches the Warden, which invalidates every frozen artifact and forces a fresh baseline on both models. That is affordable once, not repeatedly, and the M7.2 rules-ingestion work is already going to force one — both existing baselines ran against an empty `rules_chunk` index. Re-check after M7.2, and land the fields with that re-baseline rather than paying for a second one.

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

**Amendment — the deferral scope was too broad; static build data was never blocked**

This entry conflated two different claims under one deferral: the qualitative `characterAttributes` block (armor mode, loadout, conditions), which genuinely lacks a data source, and character-sheet *build* data — stats, saves — which does not. `character_sheets.data` already carries `Strength`/`Speed`/`Intellect`/`Combat` and the saves as structured fields, populated at character creation (see `§ Player resource pools are derived at character creation, not at synthesis`), and rendering them into the snapshot requires no schema addition and no synthesis write path — only a render function and a call site, the same shape already anticipated above for the qualitative block.

"Reactivate at the milestone that first needs the data" was the intended trigger, and for this narrower slice it already fired: Phase 1 has no rule evaluator, so Claude adjudicates every stat check itself, and without these fields in the snapshot its only source for the check target is the player stating their own stat in the action text — the system asking the player for data the system already has. That gap has existed since M6/M7 started resolving checks, not from some future milestone.

Scheduled for M8.1. The qualitative block — armor mode, loadout, conditions — remains deferred exactly as described above; it is the part that actually needs new schema and a character-sheet shape extension to separate armor/loadout/conditions.

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

### A warning's suggested remedy must produce a correct comparison, not merely a homogeneous one

Three separate warnings in this harness converged on the same defect, which is worth naming as a class rather than fixing three times. Each detected a real inconsistency between the two sides of a comparison, and each printed a remedy that resolved the inconsistency by **deleting** it — making the sides *look* consistent without making the comparison correct:

- **The mixed-rubric warning** printed `--filter-rubric <hash>`, which filtered every judged row in both runs against one hash. Following it on a run covering four judged checks silently dropped three of them. The warning was about one check's rubric drifting mid-run; the remedy discarded the other three checks' results, which were never in question.
- **The harness-version warning** flagged rows scored under different `harnessVersion`s and effectively suggested reverting to a common one — which, after a checker-migration cycle, means throwing away every migration and re-reading the numbers the migrations were performed to correct.
- **A proposed `--filter-harness`** would have done the same thing structurally: shrink both denominators to the intersection, quietly, which is precisely the failure the `App` column was added to make visible.

The rule: a warning may only suggest a remedy that leaves the resulting comparison *valid*. Where no such remedy exists, the honest output is the warning plus an explanation of what the reader must do by hand — re-score both sides under one grading, re-run one side, or read the two sides separately — not a flag that restores apparent homogeneity. Homogeneity is a property of the row set; correctness is a property of what the rows mean, and only the second is what the warning was defending.

A related fix belongs to the same principle. Carried-forward rows (`eval:rescore` preserves rows for reps that errored before producing an artifact) are heterogeneous by construction and must never be counted as rubric or harness drift. That filtering now happens **inside `detectHeterogeneity`**, not at its call site. Filtering at the call site is correct exactly as long as every caller remembers to do it, which makes the invariant a convention rather than a property; moving it inside means a new caller cannot reintroduce the false alarm by omission.

### Applicability is fixture-authored, keyed by `checkId`, never inferred from the turn's own output

`system-rolled-player-action` and `out-of-order-resolution` originally decided applicability by asking "did this turn produce a `dice_roll` event?" — a consequence of the model's own choice, not a property of the fixture's scenario. When the correct behaviour was declining to roll (deferring to a pending `dice_request` instead), the harness scored the turn as `not_applicable` rather than as a pass, silently shrinking the denominator to exactly the reps where the model happened to roll — selection on the outcome variable. Confirmed against a real Sonnet 5 run: 38 of 40 reps across the two checks read `not_applicable` for this reason, and the two reps that didn't were themselves a false pass — a system-rolled to-hit roll the old pattern-only rule didn't match.

The fix adds `applicability: Record<checkId, {applies, playerEntity?, situation}>` to `evalFixtureSchema` (`FIXTURE_SCHEMA_VERSION` 1 → 2), authored once at fixture-capture time rather than derived at eval-run time from `campaignState` or the presence of any event. Keyed by `checkId`, not nested under `assertion` or flat on the fixture, because `selectChecksForFixture` already models "a fixture may carry more than one check" — turn19/turn21 exist as separate fixture *files* per tag today, but the schema shouldn't assume that stays true. `playerEntity` on the `applies: true` branch also replaces `system-rolled-player-action`'s old `campaignState.resourcePools`-key-guessing heuristic for identifying "the player" — the fixture author already knows who the player is.

Checks that need this declare `requiresFixtureSchema: 2` (the field existed, unused, since M7.4 anticipated exactly this situation) so a fixture below that version reports `not_applicable` through `runCheck`'s existing gate rather than a checker guessing or crashing. `capture-fixture` writes a fail-closed placeholder (`applies: false`, TODO reason) for every newly captured fixture, matching the existing `playerInput`/`assertion` placeholder convention — an unedited stub can never silently read as "situation confirmed."

`out-of-order-resolution` is only half-migrated: situation gating is real, but the in-turn ordering case needs a `gatedByRollId` the payload does not record, so the check reports `not_applicable` with a reason naming the missing field rather than the old model-artifact phrasing. An earlier version of this paragraph proposed extending turn19/21 through the follow-up turn to recover that evidence; that proposal is withdrawn — see "`out-of-order-resolution` reads the deferred gate, and declines the in-turn case" below.

### A structural check may read event and state structure; it may not classify prose

Structural checkers began as regexes over `purpose` and `playerText` because the alternative
looked like an API call per rep for questions that seemed mechanically answerable. Every
structural check that has ever produced a verdict has since been found to misreport, in all
three possible directions: `system-rolled-player-action` returned false PASS on a
system-rolled to-hit its damage-only matcher didn't recognize; `unauditable-mapping`'s
`MAPPING_STATED_PATTERN` is content-blind enough that any `digit + (:|=|means|indicates)`
satisfies it, while `NARRATIVE_SELECTION_PATTERN` returned false NOT_APPLICABLE on twelve
turns of `"Ambient station event check"` — the model's own dominant phrasing for exactly the
roll type the check exists to grade; `narrating-past-a-block` returns false FAIL on
commitment language (`"you put two rounds into..."` before the roll is issued), which its
own doc comment already flags as the class the `\bif\b` guard was added to fix. Patching
does not converge: `NARRATIVE_SELECTION_PATTERN` and `narrating-past-a-block` have each been
widened once after a real-run miss and failed again the same way, and `UNSURFACED-CHECK`
gave up and migrated to a judge call after its own false pass. The 4.6 → Sonnet 5 swap
quantified why: `NARRATIVE_SELECTION_PATTERN` reached a verdict on 15 of 20 reps under 4.6
and 4 of 20 under Sonnet 5, against an unchanged prompt. A regex over prose encodes the idiom
of whichever model was current when it was written, and silently stops matching when that
changes.

The dividing line is what the checker reads, not how hard the question sounds. Event and
state structure — does a pending `dice_request` exist, in what sequence did events land,
what changed in `resourcePools`, does a roll resolve an antecedent request — are facts the
backend produced, identical in shape across models and across prompt revisions. Narrative
prose is where model idiom lives. So structural remains the default wherever the question
can be answered from structure, since it is deterministic, free, and carries no judge
variance; it is simply not available for questions whose answer lives in wording. A single
check may span both: `unauditable-mapping` keeps a structural pre-filter on the shape of a
spontaneous GM-side roll (single die, no modifier, no `target`, resolving no pending
request) and sends only the remaining semantic question — does `purpose` enumerate outcomes
covering the notation's range — to the judge.

The line has a third case, discovered by applying it. Some questions are neither semantic nor
answerable from current structure: they would be structural if the payload recorded a fact it
doesn't. Ordering two rolls requires knowing which depends on which — sequence numbers show
what happened first, not what gated what — and attributing a Warden-side roll to the player
requires `actingEntityId`, since `actorType` is `'gm'` for every such roll whether it stands
in for an NPC or the player. Those wait on the deferred `roll_dice` fields, and the honest
interim verdict is `not_applicable` naming the missing field, not a regex approximating it.
That reframes those fields: they are measurement infrastructure as much as a candidate fix
for the Warden's own sequencing.

The line has a second constraint, running the other way. A judged verdict is binary, so a
judge cannot say "nothing to grade" — asked about a detail the narration never introduced, it
answers "it didn't" and returns a pass, converting an honest zero denominator into a spurious
1.00. Applicability gating therefore stays structural even on judged checks. `judgeGate` is
the mechanism, and `missing-canon-capture` is the case where that constraint decided against
migrating at all.

But `judgeGate` is only available where the applicability question is *itself* structurally
answerable, which is narrower than it first reads. `narrating-past-a-block` is the
counter-case. Its pre-migration gate was prose-dependent in both directions —
`BLOCK_ACKNOWLEDGING_CONTINUATION_PATTERN` over `playerText` to decide the Warden had
acknowledged a block, `STAT_CHECK_PATTERN` over `purpose` to decide a roll was the blocked
one — so there was nothing structural to port, and `ungated` is the honest declaration rather
than a gap someone forgot to fill. The binary-verdict hazard is genuinely live for that check;
it is managed by watching exclusion counts and applicability, not by manufacturing a gate.
Gating anyway, on "was there a block at all," would have cost `turn16` 19 of its 20 reps
across the two frozen runs — deleting the corpus's clearest surviving failure to guard against
a spurious pass that was not occurring.

Applying the line as it currently stands: `system-rolled-player-action` stays structural, and
reports undecided rather than guessing when its prose binding fails. `out-of-order-resolution`
stays structural for the deferred-gate case and declines the in-turn case as schema-blocked —
it was *not* structure-only when this entry was first written; `CONDITIONAL_DAMAGE_PATTERN`
was prose classification and was the only clause firing under 4.6. `unauditable-mapping` and
`narrating-past-a-block` migrated to judged with structural gates. `missing-canon-capture`
stays structural; its zero denominator is a fixture defect, not a checker one. Migration is
cheap by construction: `checkId` deliberately does not encode `checkMode` (see above), so a
check changes mode without un-pairing its own comparison history.

### `eval:rescore` re-grades frozen artifacts; re-score rows are a distinct row kind

A scoring-only corpus bump or a checker change leaves every `warden-output.json` exactly as valid as it was, so re-grading in place is a real measurement rather than an approximation. `eval:rescore` does that with no Warden calls and no database. It landed alone, before any checker changed, so that it could be validated against numbers derived independently — it reproduces the hand-derived `applicability`-fix corrections in `eval-methodology.md` exactly, including the specific finding that two Sonnet 5 passes on `turn21` flip to `FAILED`.

Rows extend `scoreRowSchema` rather than forking it, so `computeRates` / `rollupByTag` / `summarizeExclusions` consume a re-score unchanged — regenerating a run's rates under new checkers is the whole point, and a second aggregation implementation would be a second thing to keep in step. The cost is that half the inherited columns change tense: `model`/`promptHash` still describe generation, while `corpusVersion`/`harnessVersion` are recomputed and describe scoring. A `rowKind` discriminator keeps the two readers from ever accepting each other's files; it is optional on the run side specifically so `eval:run`'s on-disk format stays byte-identical to every row already written, since the command exists to reproduce historical numbers and a gratuitous format change would be one more thing to rule out when a rate moves.

Rows that cannot be re-graded — the turn errored before producing an artifact — are carried forward rather than dropped, so a re-score file is a complete replacement for a run's rows. Dropping them would silently shrink the error accounting and make a re-scored report look cleaner than the run it describes.

### `applicabilitySource` is declared per check, and the third value is `'ungated'`

Every check declares where its `not_applicable` verdicts come from: `'fixture'` (fixture-authored applicability — the scenario decides, denominator fixed before the model runs), `'artifact'` (the turn's own output — the outcome-selection hazard that made 38 of 40 reps read `not_applicable` across two checks), or `'ungated'` (reaches pass or fail every rep). Required rather than optional, with a lookup that throws on an unlisted check, so adding one forces the question rather than defaulting to a guess at the thing the field records. It goes on the row rather than being looked up from the check id at read time, because a migration changes it and a row must keep describing the rules it was scored under.

`'judged-check'` was considered for the third value and rejected. It would put a `mode` value on an applicability axis, and the two coincide only while no check is hybrid — which ended immediately: `narrating-past-a-block` and `unauditable-mapping` are both `mode: 'judged'` with artifact-sourced structural gates, so six checks are judged but only four gate on nothing. A reader would infer the value meant "this check is judged" and be wrong about a third of them. `'none'` was the first choice and was also rejected: an absence-shaped value reads as "not declared yet," which is the exact ambiguity the required field exists to eliminate.

### A judged check may carry a structural pre-filter (`judgeGate`), and gated reps are excluded from judge-variance

`decisions.md` already held that a single check may span both modes. `judgeGate` is the mechanism: an optional function run before the judge call that either settles the rep structurally or returns `null` to mean "the remaining question is genuinely semantic." `mode` stays `'judged'` because that is what `runCheck` dispatches on and what the row records; a third mode value would have forced a fixture-schema change for no gain.

The non-obvious consequence is in `eval:judge-variance`. It selects candidates by `check.mode`, so a gated judged check contributes frozen inputs whose verdicts are deterministic — re-running one N times yields N identical answers, a guaranteed non-flip sitting in the denominator and pulling the measured flip rate toward zero. That is the one number the command exists to produce, and the one that must never be quietly optimistic. Gated inputs are therefore tracked via `judgeInvoked`, excluded from the flip-rate denominator, counted as `gatedInputs`, and named in the headline: a rubric validated on two inputs because a gate absorbed the other eighteen has not been validated.

`judgeContext` is the companion field. When a gate narrows *which* events the semantic question is about — as `unauditable-mapping`'s does — the judge has to be told which ones. The alternative is a rubric describing the structural filter in prose for the model to re-apply, which is a second implementation of the same rule, free to drift, in the one check being rebuilt precisely because prose descriptions of roll classification do not hold.

### Structural checks report undecided rather than guessing when a prose dependency fails

`isAttributedTo` — binding a roll to the acting entity by the Warden's leading-name convention — is the last prose dependency in the structural checks, and it is not removable: nothing in `game_events` records who acted, and `actorType` is `'gm'` for every Warden-side roll whether it represents an NPC or the player, which is exactly the distinction being drawn. It waits on an `actingEntityId` on the roll payload.

What was fixable is how it fails. A prose match failing to match is indistinguishable from the thing genuinely being absent, and the two carry opposite verdicts, so `system-rolled-player-action` treated "no roll named the player" as a pass. It now reports `not_applicable` when nothing binds *and* unattributable system-side rolls are present. Measured across both frozen runs this costs 2 of 40 reps — both on `turn21` under 4.6, where they were that fixture's only two passes against seven fails — and leaves Sonnet 5 untouched at 1.00/0.80, because a model that properly issues `dice_request`s hits the structural branch instead. Costing a denominator is the point: a rep whose verdict rests on a prose match having failed is not evidence, and counting it as one is how a rate reaches 1.00 without the behaviour improving.

The same audit found that binding a `dice_request` by prose was simply wrong. A request is player-facing by construction — `roll_dice` is documented for GM rolls, `diceRequests` for player-facing ones — so a pending request is a deferred player roll whatever its purpose text says. A manually-verified clean turn had been failing because it deferred correctly with a request that never named the player, which a request addressed *to* the player has no reason to do.

### `out-of-order-resolution` reads the deferred gate, and declines the in-turn case

A *pending* `dice_request` is an unresolved gate as a matter of structure: the backend surfaces it and the turn ends waiting on it, so anything resolved on the player's behalf while it sat pending was resolved ahead of its gate. That replaces `CONDITIONAL_DAMAGE_PATTERN`, the second regex this checker had tried, which failed the way prose matchers here always do — it flagged *NPC* damage rolls that were never gated by the player's request, on 4 of `turn19`'s 10 reps, which is most of why that fixture read 0/9.

When the turn resolves its gating roll in-turn instead, the check reports `not_applicable` naming the missing `gatedByRollId`. Sequence numbers show what happened first, not what depended on what; a to-hit followed by damage is correct and the reverse is not, the same two events either way, separable only by a link the payload does not record. Adjudicating that by regex is what the check was doing and what it stopped doing.

**Extending `turn19`/`turn21` through the follow-up turn does not recover the missing half, and the idea is withdrawn wherever this log proposed it.** The reasoning that produced it was that a model deferring a to-hit across a turn boundary puts the ordering evidence outside the captured turn. But the violation window *is* the captured turn: a deferred gate ends the turn, so any dependent roll on the follow-up turn is after the gate resolved by construction. A two-turn fixture would therefore pass structurally no matter what the Warden did, and the pass would look like evidence of correct sequencing. The in-turn case waits on the schema field; it does not wait on a longer fixture.

A known false FAIL is accepted and pinned by a `[known limitation]` test rather than patched: a player stress check triggered by NPC fire that already resolved is properly ordered but structurally identical to a pre-rolled damage roll — both GM-initiated, both without `requestId`, both after the gate in sequence. It costs 1 of 18 decided reps. The available discriminators are notation (1d10 vs 1d100) and purpose wording, and reaching for either would re-import the "works on the data in front of me" failure that produced the regex being removed. A false FAIL also names the offending roll in the report, so it is diagnosable; the alternative readings risk a false PASS, which is not.

### `missing-canon-capture` stays structural, because a judge cannot say "nothing to grade"

Reviewed on the same grounds as the others — its marker-phrase gate is a prose dependency, and it had produced zero verdicts across 20 reps — and it is the one case where the conclusion runs the other way.

The verdicts are correct. All 20 reps report `not_applicable` because the narration genuinely never introduces the detail `turn02` asks about: normalising case, whitespace and dash shape finds it in 0 of 20, and a loose search for "veridian internal" alone finds 0 of 20. The near-miss hits are about a different subject entirely.

Migrating it would have made things worse. A judge asked "did the narration introduce the detail, and if so was it captured" would answer "it didn't" on all 20 reps, and — the verdict being binary — return 20 passes. An honest zero denominator would become a spurious 1.00. `not_applicable` is the right verdict and only the structural path can express it.

The real defect is in the fixture, which asks about a detail neither model reproduces and therefore grades nothing. Recapturing it, or authoring the expectation as something other than a literal phrase, is fixture work tracked separately. What the review did change: the marker now matches across dash shape and case, and `pending_canon` is attributed to the *winning* response rather than the first `gm_response`, a latent bug that would have read canon captured by a correction as a failure to capture.

### A rate that never moves is a harness suspect, not a finding

`eval-methodology.md` listed six fixtures as "confidently zero — n large enough that the result isn't just small-sample noise." Four were measuring the harness. `turn16-narrating-past-a-block` read 0/10 under both models because the check failed every rep on a `dice_request` the *fixture* seeded with `target: null`, a value fixed at capture time before the Warden under test ever ran.

The framing is what made it hard to see: the statistical confidence was entirely real and completely beside the point, because a large n does not make a checker correct. The practical rule is the same one already recorded for large rate jumps after a model swap, extended to its mirror image — a fixture sitting at exactly 0.0 or 1.0 across every rep more likely indicates a checker that cannot move than a model that never varies, and should be treated as a harness suspect before being recorded as a finding.

**This entry was written from `turn16`, so it reads as being about zeros. It is not.** A rate pinned at 1.00 is exactly as suspect and *materially less likely to be investigated*, because nobody audits good news. The asymmetry is worse than indifference: a pinned zero at least announces itself as a problem worth opening, and it tends to present with a shrunken or lopsided denominator that draws a second look. A pinned 1.00 presents with full applicability, a healthy denominator, and an `App` column reading `1.00` — the healthiest-looking row in the report. Every diagnostic built so far watches for denominators collapsing; none of them can see a verdict that cannot be reached. `turn21-narrating-past-a-block` (1.00 on both models) and `turn{19,21}-out-of-order-resolution` under Sonnet 5 (1.00, 20/20) are the current instances, and the reason each is currently believed is hand-review, not tooling. `docs/plans/900-fixture-check-reachability-design.md` is the design for closing that gap and is deferred, so for now the ceiling half of this rule is enforced by remembering it.

### Applicability is reported alongside every rate, and errors are not in its denominator

`eval-methodology.md` already argued that a rate moving because its denominator moved looks identical to a rate moving because behaviour moved, and that reporting applicability is the only thing that separates them. The reports now do: `App` on the per-fixture and per-tag tables, `App A`/`App B`/`ΔApp` on every compare row, and an `Applicability shifts` section peer to Regressions/Improvements.

Applicability is `N / (N + NA)` — **errors are excluded from the denominator entirely.** A rep that errored never reached the point of determining whether the check applied, so counting it as "didn't apply" reports a lower applicability than the check earned and folds two different unknowns into one number. `turn14-unauditable-mapping` is the case that forced it: 7 `not_applicable`, 3 errors, `N` 0. It reads `0.00 (0/7)` with the 3 errors accounted for separately, not `0/10`. The exclusion is also what makes the fixture-gated diagnostic below sound — an errored rep can't break unanimity.

**The same applicability number carries opposite readings depending on `applicabilitySource`, so the reports render the source next to it.** For a `'fixture'`-gated check the scenario decides before the model runs, so every rep must agree: `0.00` and `1.00` are the only honest values, and anything strictly between is a harness defect — the checker is misclassifying or the fixture was mis-authored. For an `'artifact'`-gated check the same partial number is a real behavioural measure carrying the outcome-selection hazard. A `'ungated'` check reporting any `not_applicable` at all is a defect by definition: a gate fired where the registry says none exists. Reports classify each entry on those rules and separate **harness defects** from **how to read these numbers**, because the failure being prevented is a bug getting written up as a finding.

The compare report distinguishes a source *mismatch* (both sides declared, and they differ — a checker migrated between the runs) from an *indeterminate* source (either side is `'unknown'` or `'mixed'`). Only the first is a migration. `'unknown'` is the ordinary state of rows predating the field, including every row `eval:rescore` carries forward, and reporting it per check as a migration buries the real ones — the first run of this on the two frozen runs produced six such false alarms. Indeterminate pairs get one aggregated warning instead.

### `eval:report` and `eval:compare` name which grading they rendered, and share one default

Once `eval:rescore` exists a run directory holds several sets of verdicts over the same generator output: the run's own `reps/<nnn>/scores.jsonl` plus one file per re-score pass. "The report for this run" stopped being a well-defined request, and the failure mode is not a crash — it is two people quoting numbers graded by different checker code at each other.

`--scoring run | rescore | rescore=<timestamp>` selects. With no flag the most recent re-score wins, falling back to the run's own scores when there is none: a re-score exists precisely because the run's grades are known stale. That default is only defensible because it is never silent — the resolved grading appears in the report title, in a `- Scoring:` header bullet naming the exact file, and on stderr.

The flag lives on **both** commands, resolved by one shared `resolveScoring`. A default that changed `eval:report` while `eval:compare` kept reading `reps/` would have manufactured the exact cross-grader comparison the flag exists to prevent. `eval:compare` additionally warns when its two sides end up on different gradings — different kinds, or two re-scores under different harness versions — since one `--scoring auto` can still land differently on two runs.

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
