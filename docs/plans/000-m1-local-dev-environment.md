# M1 Local Dev Environment — Phased Implementation Plan

Implementation plan for `docs/specs/zoltar/m1-local-dev-environment.md`. Each phase is a natural pause point for testing, review, and a git commit.

## Phase 1 — Env config + Docker Compose skeleton (DB only)

**Goal:** Postgres + pgvector running locally, env wired up. Nothing else.

- Create `.env.example` and `.env` (spec Part 4); add `.env` to `.gitignore`.
- Create `docker-compose.yml` with **only** the `db` service (`pgvector/pgvector:pg16`, healthcheck, named `pgdata` volume).

**Test:** `docker compose up db` — healthcheck goes green; `psql` connects; `CREATE EXTENSION vector` succeeds manually.

**Commit.**

## Phase 2 — Flyway + all 8 migrations

**Goal:** Full Phase 1 schema applied cleanly.

- Add `flyway` service to compose (depends_on db healthy, restart on-failure).
- Create `infra/db/migrations/V1…V8` by transcribing verbatim from `docs/schema.md`:
  - V1 auth tables
  - V2 core tables
  - V3 grid tables
  - V4 game events
  - V5 map geometry stub
  - V6 pending canon
  - V7 rules index (with `CREATE EXTENSION vector` + Mothership seed)
  - V8 adventure telemetry

**Test:** `docker compose up flyway` exits 0 with "Successfully applied 8 migrations"; verify table list, `mothership` seed row, and `vector` type per spec checklist items 5–7.

**Commit.** (Largest phase but a single coherent unit; pausing mid-migration set leaves the schema in an awkward partial state.)

## Phase 3 — NestJS skeleton conversion (Fastify + config + health)

**Goal:** Existing zoltar-be scaffold reshaped to spec, runnable on host (no Docker yet).

- Update `package.json`: swap `@nestjs/platform-express` → `@nestjs/platform-fastify`; add `@nestjs/config`, `drizzle-orm`, `pg`, `zod`, `@types/pg`, `drizzle-kit`.
- Delete the stock `app.controller.*` / `app.service.*`.
- Create `src/config/{env.schema.ts, config.module.ts}` (Zod-validated env, throws on failure).
- Create `src/health/{health.module.ts, health.controller.ts}`.
- Rewrite `src/main.ts` for Fastify adapter; rewrite `src/app.module.ts` to import ConfigModule + HealthModule only.

**Test:** `npm install`, `tsc --noEmit`, `npm run start:dev` locally with a stub `DATABASE_URL`; `curl localhost:3000/health` returns `{"status":"ok"}`. Add unit tests for the env Zod schema (valid + missing/invalid cases) per the testing standards in CLAUDE.md.

**Commit.**

## Phase 4 — Drizzle schema + DB module

**Goal:** Type-safe DB handle injectable app-wide.

- Create `src/db/schema.ts` transcribed from `docs/schema.md` § Drizzle Schema (uses `vector` from `drizzle-orm/pg-core`).
- Create `src/db/db.provider.ts` (pool + drizzle factory, `DB_TOKEN`).
- Create `src/db/db.module.ts` as a `@Global()` module exporting the provider.
- Add `drizzle.config.ts` at app root.
- Wire `DbModule` into `AppModule`.

**Test:** `tsc --noEmit` clean; start the app against the Phase-2 db (run db+flyway in compose, backend on host) and confirm it boots without pool errors. Optional: a smoke test that injects `DB_TOKEN` and runs `SELECT 1`.

**Commit.**

## Phase 5 — Deferred service interfaces + noops + feature module stubs

**Goal:** Establish the full module/provider import graph M2 will fill in.

- Create six abstract classes under `src/services/interfaces/`: entitlements, metering, email, asset-storage, realtime, feature-flag.
- Create six noop implementations under `src/services/noop/` (each with a one-shot debug warning via a `warned` flag, returning safe defaults).
- Create empty stub modules: `campaign`, `adventure`, `auth`, `grid` (`@Module({})` only).
- Register all six providers in `AppModule` and add them to `exports`; import the four feature module stubs.
- Unit tests for noops (verify defaults + that warning fires only once).

**Test:** `tsc --noEmit`; app boots and logs the full module tree including the stubs.

**Commit.**

## Phase 6 — Backend in Docker + frontend placeholder + end-to-end verification

**Goal:** Hit every item in the spec's Verification Checklist.

- Write `apps/zoltar-be/Dockerfile` (development stage only).
- Add `backend` service to compose (build context, depends_on flyway `service_completed_successfully`, port 3000, bind mount with anonymous `node_modules` volume).
- Add `frontend` placeholder service (no `depends_on backend`).

**Test:** Full `docker compose up --build` from clean state; walk the entire 9-item Verification Checklist (compose up, flyway exit 0, backend boot logs, `/health`, `\dt`, mothership seed, vector type, playtest `svelte-check`, backend `tsc --noEmit`).

**Commit.**

---

## Notes on the phasing

- Phases 1, 2, 6 are the Docker-touching ones; phases 3–5 are pure backend code that can be developed against a host-run Node and the Phase-2 db. This lets backend changes be reviewed without Docker rebuild churn in the middle.
- Phase 2 is bulky (8 migrations) but intentionally atomic — partial migration sets aren't a useful pause point.
- Phase 5 is where the spec's "module hierarchy" assertion gets validated; keeping it separate from Phase 3 means the health-check milestone stays small and easy to review.
- Tests are added inside the phase that introduces the code under test, per the CLAUDE.md testing standards (env schema in Phase 3, noops in Phase 5).