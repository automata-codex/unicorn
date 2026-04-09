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

---

## Claude Integration

**Tool use over prompt instructions for structured output**
Claude is required to call `submit_gm_response` and `submit_gm_context` rather than producing structured JSON in plain text. Tool use enforces the schema at the API level and eliminates a whole category of malformed response runtime errors. Prompt instructions alone are not sufficient for this guarantee.

**HP and all numeric resources in `resourcePools`, not a separate `entities.hp` field**
An earlier design gave entities a special `hp` field alongside `resourcePools`. Folded into `resourcePools` for consistency — HP is a resource pool mechanically, and the threshold behavior (death, unconscious) is handled by the validator reading pool definitions from the system Zod schema, not by special-casing field names. This keeps the schema extensible across systems that track hit points differently.

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
---

## Monorepo and Tooling

**Repo named `unicorn`, not `unicorn-vtt`**
The monorepo houses Zoltar and Unicorn VTT. Zoltar is not a VTT — `unicorn-vtt` misrepresents the contents. `unicorn` names the product family correctly.

**npm workspaces over Turborepo**
Turborepo deferred until there is a concrete need — parallel builds across many packages, remote caching, a CI pipeline that would benefit from task graph optimization. For a small monorepo in early development, npm workspaces is sufficient and has no additional tooling overhead. Migration to Turborepo is straightforward when the time comes.

**License: Elastic License 2.0**
Consistent with existing Automata Codex projects. Short, readable, and clear on the one restriction that matters: cannot offer the software as a managed service to third parties without permission. Self-hosting for personal or internal use is unrestricted.

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

## Campaign canon is separate from adventure canon

Adventure GM context blobs are scoped to a single narrative arc. Promoted canon within an adventure is correct at that scope. But facts with campaign-level significance — an overarching antagonist's scheme, a surviving NPC, a faction relationship — need a persistent home that synthesis for future adventures can read.

`campaign_canon` is that home. It mirrors the `pending_canon` lifecycle (same status enum, same review pattern) but scoped to the campaign. Promotion to campaign canon is a second, deliberate editorial step at adventure completion — not automatic, because not every adventure-level fact warrants permanence at the campaign level.

The alternative (feeding prior adventure summaries and GM context blobs directly into synthesis) was rejected because synthesis complexity would grow with campaign length, and there would be no explicit record of what the campaign author considered canonical world truth vs. adventure-local detail.
