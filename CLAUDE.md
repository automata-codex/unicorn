# CLAUDE.md

This file provides context for AI assistants working in this repository.

## What This Is

Unicorn is a monorepo housing two Automata Codex tabletop RPG products:

- **Zoltar** — an AI-powered GM-in-a-box for solo and small-group TTRPG play
- **Unicorn VTT** — a traditional virtual tabletop (planned, not yet scaffolded)

Both products share workspace packages for auth interfaces, rules engine, and (eventually) a 2D renderer.

The full design document is at `docs/zoltar-design-doc.md`.

## Repository Structure

```
unicorn/
  apps/
    zoltar-fe/        # Svelte SPA — Zoltar frontend
    zoltar-be/        # NestJS API — Zoltar backend
  packages/
    auth-core/        # @uv/auth-core — AuthService interface definitions
    rules-engine/     # @uv/rules-engine — dice, constraint evaluator (planned)
  infra/              # Docker Compose, deployment config
  docs/               # Design docs, ADRs
```

Packages are internal workspace packages — they are not published to npm.

## Tech Stack

| Layer              | Technology                               |
|--------------------|------------------------------------------|
| Frontend           | Svelte 5 / SvelteKit                     |
| Backend            | NestJS 11                                |
| Database           | PostgreSQL                               |
| AI                 | Anthropic Claude API (claude-sonnet-4-6) |
| Auth (self-hosted) | Auth.js                                  |
| Auth (SaaS)        | Clerk                                    |
| Real-time (SaaS)   | Ably                                     |
| Language           | TypeScript throughout                    |
| Package manager    | npm workspaces                           |
| Node version       | >=22.0.0                                 |

## Key Architectural Decisions

**Claude as consequence engine, not state holder.** The backend constructs a visibility-filtered state snapshot, sends it to Claude with each request, and Claude issues structured change requests via the `submit_gm_response` tool. The backend validates and applies all state changes. Claude never holds authoritative state between requests.

**Two-mechanism hidden information model.** GM context secrets (NPC agendas, mystery answers, faction loyalties) are included in Claude's prompt and withheld behaviorally — Claude is playing the Warden role faithfully. Spatial secrets (entities outside the player's line of sight) are structurally absent from the state snapshot — Claude genuinely doesn't receive that data.

**Typed envelope + JSONB.** Universal concepts (campaigns, sessions, grid) use proper relational tables. System-specific state uses JSONB with Zod validation. Adding a new game system means writing a Zod schema, not a migration.

**Service interface abstraction.** Every SaaS/self-hosted divergence point is a NestJS provider interface. Self-hosted defaults ship in this repo. SaaS implementations live in a separate closed-source package. Deployment mode is selected via environment config, not code changes.

**Open core, self-hosted first.** SaaS infrastructure is intentionally deferred until the 2D renderer ships. The self-hosted version is the primary development target.

## Naming Conventions

- Generic abstractions over system-specific names: `resource_pool` not `spell_slots`, `condition` not `poisoned`
- Package namespace: `@uv/` (short for Unicorn)
- App names: `zoltar-fe`, `zoltar-be` (frontend/backend suffix convention)
- Entity identifiers use underscores only — no dots, hyphens, or other separators: `corporate_spy_1`, `dr_chen`, not `corporate-spy-1` or `dr.chen`
- Resource pool names use underscores and follow the pattern `{entity_id}_{pool_name}`: `dr_chen_hp`, `dr_chen_stress`, `vasquez_ammo`

## Design System

For all frontend work, read `docs/design-system.md` before writing any code. It covers the token architecture, semantic token reference, and component conventions.

## Testing Standards

Testing expectations apply uniformly across all milestones — they are not tracked per-feature in the roadmap.

**Backend**
- All service-layer code requires unit tests. Mock dependencies at the service boundary; do not hit the database in unit tests.
- Integration tests are required for any endpoint that touches the database. Use a dedicated test database spun up via Docker Compose.
- Tool handlers (`roll_dice`, `submit_gm_response`, etc.) require unit tests covering valid input, malformed input, and boundary conditions.
- Zod schemas require unit tests covering valid shapes and representative invalid shapes.

**Frontend**
- Component logic that can be extracted into plain functions should be tested as plain functions.
- UI integration tests are not required in Phase 1 but should not be actively avoided.

**General**
- Do not mock what you own. Prefer thin integration tests over heavily mocked unit tests for code where the behavior is the integration.
- Tests live adjacent to the code they test (`*.test.ts` or `*.spec.ts`), not in a separate top-level directory.

## License

Elastic License 2.0. Self-hosting for personal or internal use is unrestricted. Offering the software as a managed service to third parties is not permitted without authorization.
