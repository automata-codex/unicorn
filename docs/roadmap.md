# Roadmap

This document tracks planned work by phase. Per-feature specs live in `docs/specs/` and are written when a feature is about to be built. This roadmap is scope-focused — no time estimates.

Phase 1 is organized in two sections:

- **Feature Requirements** — the full inventory of what needs to be built, organized by domain. These are the canonical task lists.
- **Delivery Milestones** — the sequence in which work is built and shipped. Each milestone is independently testable and represents a meaningful step toward the phase target. Most milestones include both frontend and backend work.

---

## Phase 1 — MVP (Open Core, Self-Hosted)

Target: a playable solo Mothership adventure on a personal Droplet.

---

### Completed

#### Milestone 1.0 — Manual GM Context Prototyping

Validate the campaign creation and play loop manually before building any pipeline. This milestone produces no shippable code — it produces confidence that the GM context design is right and that oracle table entries are rich enough to sustain a session. Discoveries here are cheap to act on. Discoveries after the pipeline is built are not.

- [x] Write a rough synthesis prompt by hand
- [x] Select oracle results manually (no filtering UI — just pick entries)
- [x] Paste in a Mothership character sheet
- [x] Ask Claude to produce a GM context blob in a plain conversation
- [x] Run one or two sessions manually — construct the state snapshot by hand each turn, no backend
- [x] Evaluate: is the GM context rich enough? Does the oracle entry `claude_text` produce strong output or generic output? Are the interface hints doing useful work? How long does the GM context get in practice?
- [x] Revise oracle table entries and synthesis prompt until output is consistently good
- [x] Document what the structured section needs to contain based on what the manual sessions revealed
- [x] Document the gold-standard GM context quality bar based on playtest findings — what the Persephone's Wake context got right, as a written rubric for evaluating future synthesis outputs

---

### Feature Requirements

#### Backend Foundation

The NestJS application structure, database connectivity, and core data model. No game logic — just the skeleton everything else hangs on.

- NestJS module hierarchy established (`CampaignModule`, `AdventureModule`, `GridModule`, `AuthModule`, etc.)
- PostgreSQL connection via Drizzle ORM with `node-postgres` driver
- Flyway migration setup in Docker Compose (`infra/db/migrations/`)
- Initial migration: core relational tables (`campaigns`, `adventures`, `messages`, `gm_context`, `character_sheets`, `campaign_state`)
- Initial migration: grid tables (`grid_cells`, `grid_entities`)
- Initial migration: `game_events` audit table
- Initial migration: `adventure_telemetry` table (append-only, one row per turn, JSONB payload column) — infrastructure-level diagnostic telemetry, distinct from the player-facing session export format
- `map_geometry` stub table (not implemented, reserved for Phase 3)
- Docker Compose setup for local development (Postgres + NestJS + Svelte + Flyway)
- Environment config loading and validation

#### Auth & CRUD

- Auth.js integration (`AuthService` interface + `AuthJsService` implementation)
- Service interface stubs: `EntitlementsService`, `MeteringService`, `EmailService`, `AssetStorageService`, `RealtimeService`, `FeatureFlagService`
- Noop implementations for all deferred service interfaces
- Mothership Zod schemas — campaign state shape and character sheet shape
- Basic CRUD endpoints for campaigns and adventures
- Frontend: auth flow (login, adventure management), campaign list, adventure list shell

#### Oracle Tables & Character Creation

- Mothership oracle tables — survivors, threats, secrets, vessel type, tone (versioned JSON files)
- Oracle table filtering data model — active/inactive entries per category, range dials
- Character creation flow — Mothership mechanical character creation producing a character sheet that seeds oracle weighting
- Frontend: oracle filtering UI (activate/deactivate entries, range dials), character creation UI

#### Campaign Creation (Solo Blind)

The Solo Blind campaign creation pipeline: oracle table filtering, coherence check, and GM context synthesis. This is a significant Phase 1 feature — the adventure is only as good as the GM context that seeds it. Milestone 1.0 must be complete before this pipeline is built.

- `submit_gm_context` tool definition (Zod schema)
- Rationalize state snapshot fields and finalize read/write contract between snapshot and tool schema
- Coherence check — three-tier resolution (silent reroll, silent synthesis resolution, player surfacing)
- GM context synthesis — Claude constructs GM context blob from resolved oracle results and calls `submit_gm_context`
- `submit_gm_context` write path — validates structured section, writes GM context blob and initial entities to DB
- Entity ID alignment — entity identifiers in the structured section match what session tools reference from turn one
- Pending canon queue — auto-promote in Solo Blind; queue infrastructure in place for other modes (Phase 2)
- Frontend: full Solo Blind adventure creation flow wired end-to-end

#### Claude API Client & Prompt Assembly

A spatial system spec must be written and agreed before this area is implemented. LOS computation approach and entity position tracking design are to be decided in a dedicated conversation.

- `submit_gm_response` tool definition (Zod schema) including `proposed_canon` field
- State snapshot builder — visibility-filtered, GM context injected; must include `flagTriggers` object adjacent to flag values (mutable, updated when new flags are added during play via `stateChanges.flagTriggers`), `characterAttributes` block for persistent qualitative character state (armor mode, weapon loadout, active conditions); must omit entity position fields — position tracking is deferred to the spatial system spec
- LOS computation service (shadowcasting or Bresenham — decision in spec)
- Claude API client with prompt caching for GM context blob
- Prompt structure: `[GM context blob] → [state snapshot] → [rolling summary] → [last N kb of messages]`
- Rolling N-kb message window — measure in kb not message count; threshold TBD in spec (32–48 kb likely)
- Rolling summary — stored in `adventures.rolling_summary`; lazy generation at adventure resume time
- Summarization prompt guidance — prioritize uncanonized improvised fiction over mechanical events; exclude facts already in GM context

#### GmService & State Management

- `GmService` orchestrating the full request/response cycle
- Backend state change validation (resource deductions, HP thresholds, flag changes)
- State change application to DB
- `proposed_canon` routing — write entries to pending canon queue; auto-promote in Solo Blind
- `game_events` write path (all state changes logged with sequence numbers)
- Correction mechanic (`superseded_by` write path)
- `adventure_telemetry` write path — per-turn record of player input, full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, prompt and completion token counts
- Frontend: play view (message log, input field)

#### Tools

> **Adjudication scope note:** Phase 1 has no formal rule evaluator. Mechanical adjudication for Mothership is Claude's responsibility, informed by the rules lookup tool rather than confabulation. The backend enforces structural constraints only (resource availability, HP thresholds, death triggers). The full constraint module system and rule evaluation engine are Phase 3 work. This is an acceptable tradeoff for Mothership — it's a slim ruleset and the horror is in the fiction more than the mechanics.

- `roll_dice` tool — dice notation parser, server-side execution, audit log write; audit log records player-entered vs system-generated rolls
- Rules lookup tool — vector embedding pipeline for Mothership rules text; pgvector extension on Postgres; query endpoint
- Tool call routing in `GmService`
- Frontend: dice entry UI — "roll for me" button and manual raw roll entry (with explicit modifier language: "enter the number showing on the die")

#### Multiplayer Foundation

- Caller role enforcement — only the caller can submit input
- Voluntary caller transfer
- Caller request with configurable auto-approve timeout
- Offline claim (caller disconnected)
- Narrative transfer via `caller_transfer` in `submit_gm_response`
- Initiative mode — adventure mode flip, initiative order stored in adventure record
- `advance_initiative` handling in `GmService`
- Frontend: caller indicator and transfer UI, initiative order display and active player highlighting

#### Self-Hosted Deployment

- Docker Compose production configuration
- Environment variable documentation
- Self-hosted setup guide
- DigitalOcean Droplet deployment walkthrough
- Responsive polish pass on frontend (thumb reach, viewport refinement)
- First tagged release (`v0.1.0`)

---

### Delivery Milestones

#### M1 — Dev Environment & Data Model

*Infrastructure only — no game logic, no UI. Everything else depends on this.*

- [x] Docker Compose local dev setup (Postgres + NestJS + Svelte + Flyway)
- [x] NestJS module hierarchy, DB connection via Drizzle ORM + `node-postgres`
- [x] Flyway migration setup; all Phase 1 migrations (core tables, grid tables, audit/telemetry tables, `map_geometry` stub)
- [x] Environment config loading and validation
- [x] Service interface stubs + noop implementations for all deferred services

#### M2 — Auth, Campaign & Adventure CRUD

*First shippable frontend + backend slice.*

- [x] Auth.js integration (`AuthService` interface + `AuthJsService` implementation)
- [x] Add Traefik to local dev stack
- [x] Mothership Zod schemas (campaign state, character sheet)
- [x] Basic CRUD endpoints for campaigns and adventures
- [x] Frontend: auth flow, campaign list, adventure list shell

#### M2.5 — Design Sprint

*Establish visual foundation before any feature UI is built. Mobile-first throughout.*

- [x] Primitive token definitions (`themes/base.css`)
- [x] Mothership theme — semantic token layer (`themes/mothership.css`)
- [x] Base component set: button, input, panel, typography scale — styled against Mothership theme, mobile-first
- [x] Mobile layout sketches for play view (message log, input, character status, dice UI)
- [x] Mobile layout sketches for oracle filtering and character creation flows

#### M3 — Oracle Tables & Character Creation

*The raw material for GM context synthesis.*

- [ ] Mothership oracle tables — versioned JSON files (survivors, threats, secrets, vessel type, tone)
- [ ] Oracle table filtering data model (active/inactive entries, range dials)
- [ ] Character creation flow (mechanical Mothership character creation, seeds oracle weighting)
- [ ] Frontend: oracle filtering UI (activate/deactivate, range dials), character creation UI

#### M4 — Solo Blind Campaign Creation Pipeline

*End-to-end adventure creation: from oracle picks to GM context in DB.*

- [ ] `submit_gm_context` tool definition + write path
- [ ] State snapshot fields rationalized; read/write contract between snapshot and tool schema finalized
- [ ] Coherence check (three-tier resolution: silent reroll, silent synthesis resolution, player surfacing)
- [ ] GM context synthesis (Claude constructs blob from resolved oracle results, calls `submit_gm_context`)
- [ ] Entity ID alignment
- [ ] Pending canon queue + auto-promote for Solo Blind
- [ ] Frontend: full Solo Blind adventure creation flow wired end-to-end

#### M5 — Claude API Client & Prompt Assembly

*Get a coherent GM response back from Claude. No state changes applied yet. Write spatial system spec before starting this milestone.*

- [ ] `submit_gm_response` tool definition (including `proposed_canon` field)
- [ ] State snapshot builder (visibility-filtered, GM context injected, `flagTriggers`, `characterAttributes`, no entity positions)
- [ ] LOS computation service (shadowcasting or Bresenham — per spec)
- [ ] Claude API client with prompt caching for GM context blob
- [ ] Prompt structure: `[GM context blob] → [state snapshot] → [rolling summary] → [last N kb of messages]`
- [ ] Rolling N-kb message window (measure in kb; threshold per spec)
- [ ] Rolling summary — stored in `adventures.rolling_summary`; lazy generation at resume; summarization guidance applied

#### M6 — GmService & State Management

*Apply GM responses to game state and close the play loop.*

- [ ] `GmService` orchestrating request/response cycle
- [ ] Backend state change validation (resource deductions, HP thresholds, flag changes) + application to DB
- [ ] `proposed_canon` routing + auto-promote in Solo Blind
- [ ] `game_events` write path (all state changes, sequence numbers)
- [ ] Correction mechanic (`superseded_by` write path)
- [ ] `adventure_telemetry` write path (per-turn: player input, full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, token counts)
- [ ] Frontend: play view (message log, input field)

#### M7 — Tools

*Dice and rules lookup wired into the play loop.*

- [ ] `roll_dice` tool (dice notation parser, server-side execution, audit log; records player-entered vs system-generated rolls)
- [ ] Rules lookup tool (vector embedding pipeline, pgvector, query endpoint)
- [ ] Tool call routing in `GmService`
- [ ] Frontend: dice entry UI — "roll for me" button and manual raw roll entry paths

#### M8 — Multiplayer Foundation

*Caller model and initiative mode.*

- [ ] Caller role enforcement, voluntary transfer, request + auto-approve timeout, offline claim
- [ ] Narrative transfer via `caller_transfer` in `submit_gm_response`
- [ ] Initiative mode (adventure mode flip, order stored in record, `advance_initiative` handling in `GmService`)
- [ ] Frontend: caller indicator and transfer UI, initiative order display and active player highlighting

#### M9 — Self-Hosted Deployment

*Shippable open-core product.*

- [ ] Docker Compose production configuration
- [ ] Environment variable documentation
- [ ] Self-hosted setup guide + DigitalOcean Droplet walkthrough
- [ ] Responsive polish pass (thumb reach, viewport refinement)
- [ ] First tagged release (`v0.1.0`)

---

## Phase 2 — Expanded Systems, Campaign Modes, and Real-Time

Target: UVG and OSE support, remaining campaign creation modes, synchronous multiplayer, and the first wave of quality-of-life tooling.

### Requirements (to be broken into milestones when Phase 1 ships)

- UVG and OSE Zod schemas (campaign state and character sheet shapes) and rules-as-code backend validation
- UVG and OSE oracle tables
- Location and random table generation tool (UVG)
- Solo Authored campaign creation mode — freeform authoring dialogue with Claude, player-reviewed proposed canon
- Collaborative campaign creation mode — human author builds GM context via authoring dialogue, author reviews proposed canon
- Solo with Overseer campaign creation mode — Solo Blind generation, designated third-party canon reviewer
- Canon review UI — pending canon queue surfaced to the appropriate reviewer per campaign mode
- Faction/NPC agenda advancement tool
- Session summarization tool
- Structured override layer (rest rules, crit rules, death saves, spell systems)
- Initiative mode polish
- Ably real-time integration (`RealtimeService` implementation)
- Live typing preview for caller input (requires Ably)
- Presence indicators (requires Ably)
- Private action affordance
- Caller transfer UI polish
- Multi-PC / caller model dedicated playtest — do not combine with mechanical coverage playtests; schedule after backend implements caller transfer and initiative sequencing
- Campaign canon — second promotion step at adventure completion; `campaign_canon` table; synthesis reads campaign canon alongside oracle results for subsequent adventures
- Campaign canon review UI — surfaces `campaign_canon` entries with `pending` status to the appropriate reviewer at adventure completion

---

## Phase 3 — Rules Engine, VTT Layer, and SaaS

Target: D&D 5e and Infinity 2d20 support, the 2D renderer, and the first SaaS infrastructure.

### Requirements (to be broken into milestones when Phase 2 ships)

- Infinity 2d20 and D&D 5e system support
- Full constraint module system and rule evaluation engine
- Community rule module library
- Rules engine arithmetic layer for 5e (attack resolution, action economy, conditions)
- 2D VTT canvas renderer (Pixi.js or BabylonJS — decision deferred to this phase)
- Asset management (token images, map backgrounds)
- Sub-cell geometry layer (`map_geometry` table implementation)
- AI map generation pipeline (Claude describes, compiler generates grid data)
- SaaS infrastructure: Clerk, Stripe, S3, EntitlementsService, RLS policies
- Subscription billing — GM pays model; adventure creation as tier gate; per-token metering internal only
- Multi-tenant Postgres RLS migration
- DigitalOcean App Platform deployment

---

## Phase 4+ — Full VTT and Creator Economy

Target: 3D renderer, additional system support, and creator economy if demand justifies.

- 3D BabylonJS/STL renderer (separate private repository)
- Additional game system support based on user demand (Feng Shui 2 is the current candidate — cinematic action fit, slim resolution mechanic, shot clock initiative; NPC schtick tracking at scale is the main open question)
- Creator economy / Stripe Connect (if demand justifies)
- Campaign Manager evaluation (separate product or Unicorn module — decide when Phase 3 is complete)

---

## Deferred Indefinitely

Items that are explicitly out of scope until there is a specific reason to revisit:

- Image generation tool (Phase 3+ at earliest — pure polish)
- Cryptographic enforcement of GM information secrecy
- Undo mechanic (by design — corrections replace undo)
- Publishing `@uv` packages to npm
