# Roadmap

This document tracks planned work by phase and milestone. Per-feature specs live in `docs/specs/` and are written when a feature is about to be built. This roadmap is scope-focused — no time estimates.

---

## Phase 1 — MVP (Open Core, Self-Hosted)

Target: a playable solo Mothership adventure on a personal Droplet.

Milestones within a phase are logical groupings, not a strict sequence. Frontend work should be interleaved with backend milestones as features become available rather than deferred to a single frontend milestone. The hard dependencies within Phase 1 are: 

- 1.0 gates 1.2 (validate the GM context design manually before building the pipeline)
- 1.1 gates everything else (the data model must exist first)
- 1.2 and 1.3 should be sketched together since the two tool definitions are closely related

### Milestone 1.0 — Manual GM Context Prototyping

Validate the campaign creation and play loop manually before building any pipeline. This milestone produces no shippable code — it produces confidence that the GM context design is right and that oracle table entries are rich enough to sustain a session. Discoveries here are cheap to act on. Discoveries after the pipeline is built are not.

- [ ] Write a rough synthesis prompt by hand
- [ ] Select oracle results manually (no filtering UI — just pick entries)
- [ ] Paste in a Mothership character sheet
- [ ] Ask Claude to produce a GM context blob in a plain conversation
- [ ] Run one or two sessions manually — construct the state snapshot by hand each turn, no backend
- [ ] Evaluate: is the GM context rich enough? Does the oracle entry `claude_text` produce strong output or generic output? Are the interface hints doing useful work? How long does the GM context get in practice?
- [ ] Revise oracle table entries and synthesis prompt until output is consistently good
- [ ] Document what the structured section needs to contain based on what the manual sessions revealed
- [ ] Document the gold-standard GM context quality bar based on playtest findings — what the Persephone's Wake context got right, as a written rubric for evaluating future synthesis outputs

### Milestone 1.1 — Backend Foundation

The NestJS application structure, database connectivity, and core data model. No game logic yet — just the skeleton everything else hangs on.

- [ ] NestJS module hierarchy established (`CampaignModule`, `AdventureModule`, `GridModule`, `AuthModule`, etc.)
- [ ] PostgreSQL connection via Drizzle ORM with `node-postgres` driver
- [ ] Flyway migration setup in Docker Compose (`infra/db/migrations/`)
- [ ] Initial migration: core relational tables (`campaigns`, `adventures`, `messages`, `gm_context`, `character_sheets`, `campaign_state`)
- [ ] Initial migration: grid tables (`grid_cells`, `grid_entities`)
- [ ] Initial migration: `game_events` audit table
- [ ] Initial migration: `adventure_telemetry` table (append-only, one row per turn, JSONB payload column) — infrastructure-level diagnostic telemetry, distinct from the player-facing session export format
- [ ] `map_geometry` stub table (not implemented, reserved for Phase 3)
- [ ] Mothership Zod schemas — campaign state shape and character sheet shape
- [ ] Basic CRUD endpoints for campaigns and adventures
- [ ] Auth.js integration (`AuthService` interface + `AuthJsService` implementation)
- [ ] Service interface stubs: `EntitlementsService`, `MeteringService`, `EmailService`, `AssetStorageService`, `RealtimeService`, `FeatureFlagService`
- [ ] Noop implementations for all deferred service interfaces
- [ ] Docker Compose setup for local development (Postgres + NestJS + Svelte + Flyway)
- [ ] Environment config loading and validation

### Milestone 1.2 — Campaign Creation (Solo Blind)

The Solo Blind campaign creation pipeline: oracle table filtering, coherence check, and GM context synthesis. This is a significant Phase 1 feature — the adventure is only as good as the GM context that seeds it. Milestone 1.0 gates this milestone: oracle table entries and the synthesis prompt should be validated manually before the pipeline is built.

- [ ] `submit_gm_context` tool definition (Zod schema)
- [ ] Mothership oracle tables — survivors, threats, secrets, vessel type, tone (versioned JSON files)
- [ ] Oracle table filtering data model — active/inactive entries per category, range dials
- [ ] Character creation flow — Mothership mechanical character creation producing a character sheet that seeds oracle weighting
- [ ] Coherence check — three-tier resolution (silent reroll, silent synthesis resolution, player surfacing)
- [ ] GM context synthesis — Claude constructs GM context blob from resolved oracle results and calls `submit_gm_context`
- [ ] `submit_gm_context` write path — validates structured section, writes GM context blob and initial entities to DB
- [ ] Entity ID alignment — entity identifiers in the structured section match what session tools reference from turn one
- [ ] Pending canon queue — auto-promote in Solo Blind; queue infrastructure in place for other modes (Phase 2)

### Milestone 1.3 — Claude Integration

The GM-in-a-box core: state snapshot construction, Claude API communication, structured response handling, and context window management.

- [ ] `submit_gm_response` tool definition (Zod schema) including `proposed_canon` field
- [ ] State snapshot builder — visibility-filtered, GM context injected
- [ ] LOS computation service (shadowcasting or Bresenham — decision in spec)
- [ ] Claude API client with prompt caching for GM context blob
- [ ] Prompt structure: `[GM context blob] → [state snapshot] → [rolling summary] → [last N kb of messages]`
- [ ] Rolling N-kb message window — measure in kb not message count; threshold TBD in spec (32–48 kb likely)
- [ ] Rolling summary — stored in `adventures.rolling_summary`; lazy generation at adventure resume time
- [ ] Summarization prompt guidance — prioritize uncanonized improvised fiction over mechanical events; exclude facts already in GM context
- [ ] `GmService` orchestrating the full request/response cycle
- [ ] Backend state change validation (resource deductions, HP thresholds, flag changes)
- [ ] State change application to DB
- [ ] `proposed_canon` routing — write entries to pending canon queue; auto-promote in Solo Blind
- [ ] `game_events` write path (all state changes logged with sequence numbers)
- [ ] Correction mechanic (`superseded_by` write path)
- [ ] `adventure_telemetry` write path — per-turn record of player input, full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, prompt and completion token counts
- [ ] State snapshot builder must include `flagTriggers` object adjacent to flag values (mutable, updated when new flags are added during play via `stateChanges.flagTriggers`), `characterAttributes` block for persistent qualitative character state (armor mode, weapon loadout, active conditions), and must omit entity position fields — position tracking is deferred to the spatial system spec
- [ ] Spatial system spec required before implementation — LOS computation approach and entity position tracking design to be agreed in a dedicated conversation before this milestone begins

### Milestone 1.4 — Tools

The day-one tool implementations Claude can call during an adventure.

> **Adjudication scope note:** Phase 1 has no formal rule evaluator. Mechanical adjudication for Mothership is Claude's responsibility, informed by the rules lookup tool rather than confabulation. The backend enforces structural constraints only (resource availability, HP thresholds, death triggers). The full constraint module system and rule evaluation engine are Phase 3 work. This is an acceptable tradeoff for Mothership — it's a slim ruleset and the horror is in the fiction more than the mechanics.

- [ ] `roll_dice` tool — dice notation parser, server-side execution, audit log write
- [ ] Rules lookup tool — vector embedding pipeline for Mothership rules text; pgvector extension on Postgres; query endpoint
- [ ] Tool call routing in `GmService`
- [ ] Audit log records player-entered vs system-generated rolls

### Milestone 1.5 — Multiplayer Foundation

The caller model and adventure mode management.

- [ ] Caller role enforcement — only the caller can submit input
- [ ] Voluntary caller transfer
- [ ] Caller request with configurable auto-approve timeout
- [ ] Offline claim (caller disconnected)
- [ ] Narrative transfer via `caller_transfer` in `submit_gm_response`
- [ ] Initiative mode — adventure mode flip, initiative order stored in adventure record
- [ ] `advance_initiative` handling in `GmService`

### Milestone 1.6 — Frontend

The Svelte SPA for solo and async multiplayer play.

- [ ] Campaign creation flow — system selection, dice mode selection
- [ ] Solo Blind adventure creation flow — oracle table filtering (activate/deactivate entries, range dials), character creation
- [ ] Play view — message log, input field, dice entry
- [ ] Raw roll entry UI with explicit modifier language ("enter the number showing on the die")
- [ ] Both roll paths presented: "roll for me" button and manual entry
- [ ] Caller indicator and transfer UI
- [ ] Initiative order display and active player highlighting
- [ ] Mobile-first layout (thumb reach, responsive)
- [ ] Auth flow (login, adventure management)

### Milestone 1.7 — Self-Hosted Deployment

The open-core product running on a Droplet and usable by a self-hoster.

- [ ] Docker Compose production configuration
- [ ] Environment variable documentation
- [ ] Self-hosted setup guide
- [ ] DigitalOcean Droplet deployment walkthrough
- [ ] First tagged release (`v0.1.0`)

---

## Phase 2 — Expanded Systems, Campaign Modes, and Real-Time

Target: UVG and OSE support, remaining campaign creation modes, synchronous multiplayer, and the first wave of quality-of-life tooling.

### Milestones (to be broken down when Phase 1 ships)

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

---

## Phase 3 — Rules Engine, VTT Layer, and SaaS

Target: D&D 5e and Infinity 2d20 support, the 2D renderer, and the first SaaS infrastructure.

### Milestones (to be broken down when Phase 2 ships)

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
