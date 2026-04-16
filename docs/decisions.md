# Decisions Log

Lightweight record of significant technical and architectural decisions made during design and development. The design document (`docs/zoltar-design-doc.md`) captures the major product and architecture decisions; this log covers decisions made during implementation planning that aren't fully documented there.

Each entry records what was decided, what the alternatives were, and why.

---

## Database

**ORM: Drizzle over TypeORM**
Drizzle's approach to Row Level Security is cleaner than TypeORM's — setting Postgres session variables and working with RLS policies requires less ceremony. Drizzle also produces more predictable SQL and infers TypeScript types directly from the schema definition at compile time, with no generation step. TypeORM is the NestJS default but not the right fit here.

**Migrations: Flyway over drizzle-kit**
Flyway is ORM-agnostic and produces plain SQL migration files that are inspectable, version-controlled, and portable. Drizzle-kit generates SQL from schema diffs, which is useful during development but ties migration management to the ORM. Running Flyway from a Docker container in the Compose stack eliminates the JVM overhead concern. The two tools are not in conflict — drizzle-kit can be used for schema diffing during development while Flyway owns what actually gets applied.

**No circular FK between `adventure` and `gm_context`**
An earlier design put `gm_context_id` on `adventure` as well as `adventure_id` on `gm_context`, creating a circular FK that required a nullable column and a three-step insert (adventure → gm_context → update adventure). Dropped in favour of a unidirectional reference: `gm_context.adventure_id` with a unique index. Lookup in either direction is a single indexed query.

**`session` renamed to `adventure`**
The domain concept is an adventure, not a session. Sessions in the traditional sense are a social scheduling artifact that dissolves in solo async play. Adventures are the first-class domain concept — they own the GM context, messages, and game events. The table is named `adventure` rather than `session` throughout.

---

## Backend Architecture

**No `@nestjs/cqrs`**
The API follows a CQRS-flavored pattern with clean separation between the command path (GM pipeline) and the query path (direct DB reads), enforced by NestJS module boundaries. The formal `@nestjs/cqrs` command/query bus infrastructure adds overhead without meaningful benefit at this scale. Module separation achieves the same discipline.

**No event sourcing**
ES is a natural fit for games in theory but awkward with an AI GM layer — Claude's responses aren't deterministic, so replaying events doesn't reproduce the same narrative. The message log plus state snapshot approach provides most of the practical ES benefits (audit trail, session reconstruction, correction without deletion) without the full ceremony.

**`@uv/auth-core` and `@uv/service-interfaces` are separate packages**

Both packages exist so the future closed-source SaaS implementation repo can import abstract classes without depending on the open-source backend app. The split between the two packages reflects a difference in consumer profile: `AuthService` is a cross-cutting concern relevant to frontend-adjacent code (session validation, future SSR auth checks) and may be consumed outside a pure backend context. The six remaining service interfaces (`EntitlementsService`, `MeteringService`, `EmailService`, `AssetStorageService`, `RealtimeService`, `FeatureFlagService`) are backend-only concerns with no plausible frontend consumer. Keeping `auth-core` separate preserves the existing package boundary established in M1 and avoids mixing concerns that evolve at different rates.

**Explicit `status` column on `adventures` table; no inference from `gm_context` row presence**

An earlier design derived adventure status from whether a `gm_context` row existed for the adventure. Row absence is ambiguous: it could mean synthesis is in progress, synthesis failed, or a bug prevented row creation. There is no clean way to represent synthesis failure without an explicit status field. An explicit `adventure_status` enum column (`synthesizing`, `ready`, `completed`, `failed`) makes status queryable without a join and allows the `failed` state to be surfaced to users rather than leaving them with a stuck adventure. The column is added in V9 migration with a back-fill for any existing adventures.

**Magic link auth is backend-owned; Auth.js is not used**

Auth.js (`@auth/sveltekit`) requires SvelteKit's server-side hooks infrastructure to function. The frontend is a pure Svelte 5 SPA with no SSR or server-side hooks, so Auth.js cannot be used. Rather than pull in SvelteKit as a dependency for a single feature, magic link auth is implemented natively in the NestJS backend: the backend owns token generation, email delivery, session creation, and session validation. The `user`, `session`, and `verification_token` tables from V1 (originally created in the Auth.js schema format) are used as-is — we write to them directly. `AuthService.validateSession()` is unchanged: it reads the `session` table regardless of how the session was created.

**Frontend is Svelte 5 SPA, not SvelteKit**

SvelteKit's SSR and routing conventions add complexity without meaningful benefit for this product: the GM pipeline is entirely backend-driven, there is no SEO requirement, and the auth flow is owned by the backend. A plain Svelte 5 + Vite SPA is simpler to reason about, has no server-side rendering surface, and makes the frontend/backend boundary explicit. The tech stack entry in the design doc and README reflects this: "Svelte 5 (SPA)" not "SvelteKit."

---

## Claude Integration

**Tool use over prompt instructions for structured output**
Claude is required to call `submit_gm_response` and `submit_gm_context` rather than producing structured JSON in plain text. Tool use enforces the schema at the API level and eliminates a whole category of malformed response runtime errors. Prompt instructions alone are not sufficient for this guarantee.

**HP and all numeric resources in `resourcePools`, not a separate `entities.hp` field**
An earlier design gave entities a special `hp` field alongside `resourcePools`. Folded into `resourcePools` for consistency — HP is a resource pool mechanically, and the threshold behavior (death, unconscious) is handled by the validator reading pool definitions from the system Zod schema, not by special-casing field names. This keeps the schema extensible across systems that track hit points differently.

**Character sheet stores identity and build, not live mutable state**
`character_sheet.data` carries the character's identity (name, class, entityId), build (stats, saves, skills, equipment), and ceilings (`maxHp`, `maxStress`). It does not carry current HP or current stress — those are mutable values that change during play and live exclusively in `campaign_state.data.resourcePools` as `{entityId}_hp` and `{entityId}_stress`. At character creation time, `deriveMothershipCharacterResourcePools` seeds the pools at full HP and zero stress from the ceilings. An earlier design kept `currentHp` and `stress: { current, max }` on the sheet, but these drifted from the authoritative pool values the moment play began and served no purpose after creation.

**Pool validator applies full delta before threshold detection**
When a resource pool delta would cross a threshold (death, panic, etc.), the full delta is applied first and threshold crossings are detected on the resulting value. The delta is never pre-capped. If a goblin with 7 HP takes 9 damage, the result is -2 HP — the death threshold is crossed and Claude is notified of both the final value and which thresholds fired. Pre-capping would silently discard mechanically meaningful information.

**Pool behavior defined in system Zod schema, not hardcoded in validator**
Each pool definition in the system Zod schema carries `min`, `max`, and `thresholds` metadata. The validator reads this rather than hardcoding HP-specific or system-specific logic. A pool with `min: null` can go negative; `min: 0` is floored at zero. This keeps the validator generic and system-agnostic.

**Entity and resource pool identifiers use underscores only**
Dots in identifier strings cause subtle bugs when code uses dot-notation property access on JSON keys. Hyphens are legal but inconsistent with TypeScript naming conventions. Underscores are unambiguous. Resource pools follow the pattern `{entity_id}_{pool_name}`: `dr_chen_hp`, `vasquez_stress`.

**`diceRequests` IDs assigned by the backend, not Claude**
An earlier design had Claude generate UUIDs for dice request entries. Claude doesn't generate UUIDs reliably. The backend assigns IDs after receiving `submit_gm_response` and returns them in the action response. Claude omits the ID field entirely.

**State snapshot field consolidation deferred to Milestone 1.2.** 
The snapshot has accumulated fields across playtesting — `initialState` counters, `world_facts` scratchpad, character state, entity positions, and flags — each solving a distinct problem as it was discovered. At 1.2, when the tool schema is being locked, both sides of the read/write contract should be rationalized together: what Claude reads in the snapshot and what it writes via tools. Doing this earlier would be premature; the playtest data doesn't exist yet to inform good consolidation decisions.

**`flags` structure merges value and trigger into a single object**

An earlier design kept flags and flag triggers as two parallel top-level maps in campaign state: `flags: Record<string, boolean>` and `flagTriggers: Record<string, string>`. These were merged into a single structure keyed by flag name:

```typescript
flags: Record<string, { value: boolean, trigger: string }>
```

Keeping them parallel required maintaining two maps in sync — a flag with no corresponding trigger entry was an invisible bug waiting to happen. The merged structure makes each flag self-contained. The trigger is immutable after initialization (it describes the in-fiction condition that flips the flag, which doesn't change). `stateChanges.flagTriggers` on the `submit_gm_response` write path only carries the new value (`{ flagName: newValue }`) — it does not restate the trigger.

**Player resource pools are derived at character creation, not at synthesis**

Player HP and stress pools (e.g. `vasquez_hp`, `vasquez_stress`) are written into `campaign_state.data.resourcePools` at the moment the character sheet is created — not later, and not re-derived by synthesis. The derivation is a pure function in `@uv/game-systems` (`deriveMothershipCharacterResourcePools`) that maps `{ currentHp, maxHp, stress }` from the sheet onto the canonical `{entity_id}_{pool_name}` naming convention. `CharacterService.create` calls `CampaignRepository.mergePlayerResourcePools` immediately after inserting the sheet; the merge is transactional and preserves any existing pools on key conflict.

An earlier approach deferred the derivation to the synthesis write path, on the theory that state-population should happen in one place. This coupled synthesis to character-sheet internals across systems and created an ordering hazard: if synthesis ever runs before character creation (e.g. pre-generated adventures, Collaborative mode), the player pools would never exist. Doing the write at character creation makes the invariant easy to state — "once a character sheet exists, its pools exist" — and means the synthesis path only writes NPC/threat/timer pools generated by Claude. `buildResourcePools` in the synthesis write path preserves any pool keys already present, so the two writers never race each other.

**Synthesis prompts are system-specific; no driver registry yet**

Each supported game system owns its own synthesis prompt module under `apps/zoltar-be/src/synthesis/<system>/synthesis.prompts.ts` (currently only `mothership/`). System-specific exports — system prompt, character-sheet prose formatter, synthesis user prompt, coherence check prompt, and the canonical oracle-category list — are all prefixed with the system name (`MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT`, `formatMothershipCharacterProse`, etc.) so names never falsely suggest cross-system generality. Universals — the `submit_gm_context` and `report_coherence` tool definitions and the coherence report Zod schema — live in `src/synthesis/synthesis.tools.ts` and `synthesis.schema.ts` and are imported by every system module.

A generic prompt module was rejected because oracle category counts, character sheet structure, and tonal framing all differ across systems; a single parameterized builder would either be the least common denominator or a tangle of per-system branches. A `synthesisDrivers[systemId]` registry was also considered and deferred: until a second system exists, any interface we define is a guess shaped entirely by Mothership's needs, and the second system is more likely to reveal the right abstraction than to conform to a premature one. When UVG (or the next system) lands, the registry pattern can be introduced at that moment with two concrete implementations to compare against.

---

## Monorepo and Tooling

**Repo named `unicorn`, not `unicorn-vtt`**
The monorepo houses Zoltar and Unicorn VTT. Zoltar is not a VTT — `unicorn-vtt` misrepresents the contents. `unicorn` names the product family correctly.

**npm workspaces over Turborepo**
Turborepo deferred until there is a concrete need — parallel builds across many packages, remote caching, a CI pipeline that would benefit from task graph optimization. For a small monorepo in early development, npm workspaces is sufficient and has no additional tooling overhead. Migration to Turborepo is straightforward when the time comes.

**License: Elastic License 2.0**
Consistent with existing Automata Codex projects. Short, readable, and clear on the one restriction that matters: cannot offer the software as a managed service to third parties without permission. Self-hosting for personal or internal use is unrestricted.

**Traefik routes defined in file provider, not Docker labels**
Traefik routes for `app.zoltar.local` and `api.zoltar.local` are defined as file-based dynamic config (`infra/traefik/dynamic/host-routes.yml`) rather than as Docker labels on the `backend` and `frontend` compose services. Docker labels only exist on running containers — in Workflow B (the daily development loop), those containers aren't running, so label-based routes produce a 404. File-based routes pointing to `host.docker.internal` work in both workflows: in Workflow B the apps run directly on the host, and in Workflow A Docker publishes container ports to the host. One routing mechanism covers both cases.

**Single `main` branch**
No `main`/`develop` split. The value of a develop branch is protecting a stable branch from in-progress work when there are multiple contributors or a CI/CD pipeline deploying from `main`. Neither applies for solo development at this stage. Tagged releases provide the stable reference point. Revisit when there are collaborators or a deployment pipeline that warrants it.

---

## Telemetry and Data Portability

**`adventure_telemetry` vs session export are distinct artifacts**
These are two different things that were originally both called `adventure_log`. They serve different purposes and must not be conflated. `adventure_telemetry` is infrastructure-level diagnostic telemetry — one row per turn in a DB table, containing the full `submit_gm_response` payload, all `roll_dice` calls with purpose annotations and results, the state snapshot sent to Claude, and prompt/completion token counts. It exists to diagnose pipeline bugs and is not player-facing. The session export is the player-facing portable format — a single JSON file containing the message log (with turn numbers and timestamps), canon log, turn-level state deltas, final state snapshot, and GM context. It supports session restore and post-session analysis. It is produced on demand, not written per-turn to a DB table. Mixing these concerns into a single artifact would make `game_events` harder to query for its application-level purpose and would conflate player-facing data portability with internal diagnostic tooling.

---

## Security

**Prompt injection risk acknowledged, not addressed at MVP**
Prompt injection — the risk of a player crafting action text that manipulates Claude's behavior or extracts hidden state — is a known risk and is not addressed in Phase 1. At MVP scale (self-hosted, single player, no adversarial users), the risk is low and the engineering investment is not justified. The natural mitigation in SaaS deployment is that prompts are server-side and player input is clearly delimited in the message structure. Revisit before player input is injected into production prompts in a multi-tenant SaaS context. At that point, input sanitization and structural prompt hardening should be specced.

---

## Frontend & Design System

**No utility framework — plain Svelte scoped styles**
Tailwind and similar utility frameworks were considered and rejected. The atomic class approach makes HTML harder to read and works against a strong per-system visual identity. More importantly, genre-specific theming (horror for Mothership, high fantasy for OSE, etc.) requires styles that are closely coupled to a semantic token layer — a utility framework adds friction without meaningful benefit in that model. Component styles live in Svelte's scoped `<style>` blocks. No utility framework is a dependency.

**Two-tier CSS custom property token system**
Theming is implemented via a two-tier CSS variable system. Primitive tokens (`--color-slate-950`, `--font-size-lg`) define the raw design vocabulary and never change between themes. Semantic tokens (`--color-surface`, `--color-text-primary`, `--color-accent`) map purpose to primitives and are what themes actually swap. Components reference semantic tokens only — never primitives directly. This ensures a theme swap is a single token layer substitution, not a component change.

**Theme switching via `data-theme` attribute**
The active theme is applied by setting a `data-theme` attribute on the root element. Each theme is a CSS file defining the semantic token layer (e.g. `themes/mothership.css`, `themes/fantasy.css`). The primitive token definitions live in `themes/base.css` and are always loaded. This approach requires no JavaScript theming library and works naturally with Svelte's reactivity.

**Bits UI for headless accessibility primitives**
No opinionated component library is used. Bits UI (the Svelte 5 headless primitive library, successor to Melt UI) is used for accessibility-critical interactive patterns — modals, dropdowns, tooltips, focus traps — where rolling bespoke implementations would be high-risk. All visual styling of Bits UI primitives is owned by the application. This gives accessibility correctness without importing a competing design language.

**Mobile-first design — layouts originate at mobile size**
All UI layouts are designed at mobile size first and expanded for larger viewports. This applies from the pre-M3 design sprint forward and is a constraint on all subsequent frontend work. The M9 "layout pass" is a responsive polish pass, not the origin of mobile layout decisions. The play view in particular — message log, input field, character status, dice UI — is a constrained layout problem better solved small-to-large than large-to-small.

---

## Oracle Tables

**Oracle filtering data model includes count fields despite range UI being deferred**
Each oracle category preference record stores `count_min` and `count_max` fields (defaulting to `1/1`) even though the range dial UI is not built in Phase 1. The activate/deactivate pool and the pick-count concept are cleanly separable — the pool model is identical regardless of how many entries are drawn. Adding the fields now avoids a schema migration when variable counts are introduced. The UI commitment is deferred until there is a concrete scenario requiring it (likely Phase 2).

**Oracle filtering UI: activate/deactivate only, no range controls in Phase 1**
The oracle filtering UI exposes entry-level activation toggles, select all/deselect all per category, and a submission gate requiring at least one active entry per category. Range dial controls are out of scope for Phase 1. The data model supports variable counts from day one, but the UI will default to picking exactly one entry per category until range controls are designed and built. This keeps the MVP UI simple and avoids designing a UX pattern before there is a concrete use case to design against.

---

## Misc.

**One active adventure per campaign**
Campaigns are limited to one adventure in a non-completed, non-failed state at a time. A new adventure cannot be created while another is `synthesizing`, `ready`, or `in progress`. This matches solo play conventions and simplifies the state model. Completed and failed adventures remain visible (toggled by default) but do not block new adventure creation.

**Campaign canon is separate from adventure canon**
Adventure GM context blobs are scoped to a single narrative arc. Promoted canon within an adventure is correct at that scope. But facts with campaign-level significance — an overarching antagonist's scheme, a surviving NPC, a faction relationship — need a persistent home that synthesis for future adventures can read.

`campaign_canon` is that home. It mirrors the `pending_canon` lifecycle (same status enum, same review pattern) but scoped to the campaign. Promotion to campaign canon is a second, deliberate editorial step at adventure completion — not automatic, because not every adventure-level fact warrants permanence at the campaign level.

The alternative (feeding prior adventure summaries and GM context blobs directly into synthesis) was rejected because synthesis complexity would grow with campaign length, and there would be no explicit record of what the campaign author considered canonical world truth vs. adventure-local detail.

---

## Spatial System

**Phase 1 spatial consistency is prose-based, not structured**

The `grid_cell` and `grid_entity` tables exist and are migrated, but no generation pipeline populates them and no runtime system queries them. Phase 1 spatial consistency — making sure the ship layout stays coherent across turns — is handled by `worldFacts` entries authored by Claude during synthesis and maintained during play. The Warden prompt directs Claude to record the location's overall layout in `worldFacts` at synthesis time and to consult and extend those entries when narrating spatial relationships.

This matches how Mothership is designed to play: theater-of-the-mind, where the fiction is the map. It also matches the mechanism already validated in Playtest 3 for the same class of problem (corridor lengths, named spatial attributes) — the existing scratchpad generalizes cleanly to "overall layout" as one more first-mention detail that must stay consistent.

A structured map model — generated room graphs, cell grids, LOS computation — is a significant engineering investment with no playtest evidence that it's needed. Deferring it keeps M5 unblocked and avoids building against imagined rather than observed failure modes. The grid tables remain migrated but unused; they cost nothing to leave in place, and the `map_geometry` stub reservation still stands.

This decision is a deferral under uncertainty, not a final answer. The next Phase 1 playtests should watch for spatial-consistency failures — contradictory room connections, forgotten deck assignments, layout drift across long sessions. If prose-based layout holds up, the deferral is validated. If it breaks down in characteristic ways, those failure modes become the design input for a real spatial system, to be built with evidence rather than speculation. The M5 roadmap entry is updated accordingly: LOS computation service is removed, and the state snapshot builder's "no entity positions" note no longer points to a pending spec.
