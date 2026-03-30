# Roadmap

This document tracks planned work by phase and milestone. Per-feature specs live in `docs/specs/` and are written when a feature is about to be built. This roadmap is scope-focused — no time estimates.

---

## Phase 1 — MVP (Open Core, Self-Hosted)

Target: a playable solo Mothership session on a personal Droplet.

### Milestone 1.1 — Backend Foundation

The NestJS application structure, database connectivity, and core data model. No game logic yet — just the skeleton everything else hangs on.

- [ ] NestJS module hierarchy established (`CampaignModule`, `SessionModule`, `GridModule`, `AuthModule`, etc.)
- [ ] PostgreSQL connection via Drizzle ORM with `node-postgres` driver
- [ ] Flyway migration setup in Docker Compose (`infra/db/migrations/`)
- [ ] Initial migration: universal relational tables (`campaigns`, `sessions`, `messages`, `gm_context`, `character_sheets`, `campaign_state`)
- [ ] Initial migration: grid tables (`grid_cells`, `grid_entities`)
- [ ] Initial migration: `game_events` audit table
- [ ] `map_geometry` stub table (not implemented, reserved for Phase 3)
- [ ] Mothership Zod schemas — campaign state shape and character sheet shape
- [ ] Basic CRUD endpoints for campaigns and sessions
- [ ] Auth.js integration (`AuthService` interface + `AuthJsService` implementation)
- [ ] Service interface stubs: `EntitlementsService`, `MeteringService`, `EmailService`, `AssetStorageService`, `RealtimeService`, `FeatureFlagService`
- [ ] Noop implementations for all deferred service interfaces
- [ ] Docker Compose setup for local development (Postgres + NestJS + Svelte)
- [ ] Environment config loading and validation

### Milestone 1.2 — Claude Integration

The GM-in-a-box core: state snapshot construction, Claude API communication, and structured response handling.

- [ ] `submit_gm_response` tool definition (Zod schema)
- [ ] State snapshot builder — visibility-filtered, GM context injected
- [ ] LOS computation service (shadowcasting or Bresenham — decision in spec)
- [ ] Claude API client with prompt caching for GM context
- [ ] `GmService` orchestrating the request/response cycle
- [ ] Backend state change validation (resource deductions, HP thresholds, flag changes)
- [ ] State change application to DB
- [ ] `game_events` write path (all state changes logged with sequence numbers)
- [ ] Correction mechanic (`superseded_by` write path)

### Milestone 1.3 — Tools

The day-one tool implementations Claude can call during a session.

> **Adjudication scope note:** Phase 1 has no formal rule evaluator. Mechanical adjudication for Mothership is Claude's responsibility, informed by the rules lookup tool rather than confabulation. The backend enforces structural constraints only (resource availability, HP thresholds, death triggers). The full constraint module system and rule evaluation engine are Phase 3 work. This is an acceptable tradeoff for Mothership — it's a slim ruleset and the horror is in the fiction more than the mechanics.

- [ ] `roll_dice` tool — dice notation parser, server-side execution, audit log write
- [ ] Rules lookup tool — vector embedding pipeline for Mothership rules text, query endpoint; pgvector extension on Postgres
- [ ] Tool call routing in `GmService`
- [ ] Audit log records player-entered vs system-generated rolls

### Milestone 1.4 — Multiplayer Foundation

The caller model and session mode management.

- [ ] Caller role enforcement — only the caller can submit input
- [ ] Voluntary caller transfer
- [ ] Caller request with configurable auto-approve timeout
- [ ] Offline claim (caller disconnected)
- [ ] Narrative transfer via `caller_transfer` in `submit_gm_response`
- [ ] Initiative mode — session mode flip, initiative order stored in session record
- [ ] `advance_initiative` handling in `GmService`

### Milestone 1.5 — Frontend

The Svelte SPA for solo and async multiplayer play.

- [ ] Campaign creation flow (system selection, GM context entry, dice mode selection)
- [ ] Session view — message log, input field, dice entry
- [ ] Raw roll entry UI with explicit modifier language ("enter the number showing on the die")
- [ ] Both roll paths presented: "roll for me" button and manual entry
- [ ] Caller indicator and transfer UI
- [ ] Initiative order display and active player highlighting
- [ ] Mobile-first layout (thumb reach, responsive)
- [ ] Auth flow (login, session management)

### Milestone 1.6 — Self-Hosted Deployment

The open-core product running on a Droplet and usable by a self-hoster.

- [ ] Docker Compose production configuration
- [ ] Environment variable documentation
- [ ] Self-hosted setup guide
- [ ] DigitalOcean Droplet deployment walkthrough
- [ ] First tagged release (`v0.1.0`)

---

## Phase 2 — Expanded Systems and Real-Time

Target: UVG and OSE support, synchronous multiplayer, and the first wave of quality-of-life tooling.

### Milestones (to be broken down when Phase 1 ships)

- UVG and OSE Zod schemas (campaign state and character sheet shapes) and rules-as-code backend validation
- Location and random table generation tool (UVG)
- Faction/NPC agenda advancement tool
- Session summarization tool
- Structured override layer (rest rules, crit rules, death saves, spell systems)
- Initiative mode polish
- Ably real-time integration (`RealtimeService` implementation)
- Live typing preview for caller input (requires Ably)
- Presence indicators (requires Ably)
- Private action affordance
- Caller transfer UI polish

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
- Multi-tenant Postgres RLS migration
- DigitalOcean App Platform deployment

---

## Phase 4+ — Full VTT and Creator Economy

Target: 3D renderer, additional system support, and creator economy if demand justifies.

- 3D BabylonJS/STL renderer (separate private repository)
- Additional game system support based on user demand
- Creator economy / Stripe Connect (if demand justifies)
- Campaign Manager evaluation (separate product or Unicorn module — decide when Phase 3 is complete)

---

## Deferred Indefinitely

Items that are explicitly out of scope until there is a specific reason to revisit:

- Image generation tool (Phase 3+ at earliest — pure polish)
- Cryptographic enforcement of GM information secrecy
- Undo mechanic (by design — corrections replace undo)
- Publishing `@uv` packages to npm
