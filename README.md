# Unicorn Monorepo

**Unicorn** is a monorepo housing the Automata Codex tabletop RPG platforms. It contains Zoltar, an AI-powered GM-in-a-box for solo and small-group play, and Unicorn VTT, a traditional virtual tabletop. Both products share a common rules engine, 2D renderer, and authentication layer maintained as workspace packages.

This repository contains the open-core versions of both products, licensed under the Elastic License 2.0. Self-hosters can run Zoltar and Unicorn VTT on their own infrastructure by bringing their own Anthropic API key. Managed hosting, multi-tenancy, and real-time sync are SaaS-layer features not included here.

## Local Development

### Prerequisites

- [Docker](https://www.docker.com/) (Compose v2)
- [Task](https://taskfile.dev/) — `brew install go-task` on macOS
- Node.js `>=22` (a `volta` pin is set in `package.json`)

### First run

```sh
cp .env.example .env
docker compose up -d db
task flyway:migrate
```

This brings up Postgres with `pgvector` and applies all schema migrations. The backend and frontend services are not yet wired into the compose stack — that lands later in milestone M1. See `docs/specs/zoltar/m1-local-dev-environment.md` for the in-progress spec.

### Database / Flyway commands

Flyway runs in a one-shot container managed by Docker Compose. The `task` wrappers are the recommended interface:

| Command              | What it does                                                            |
|----------------------|-------------------------------------------------------------------------|
| `task flyway:migrate` | Apply pending migrations against the local dev database                 |
| `task flyway:info`    | Show the status of all migrations                                       |
| `task flyway:clean`   | Drop all objects in the configured schemas (destructive — local dev only) |
| `task flyway:repair`  | Repair the schema history table after a failed migration                |

Migration files live in `infra/db/migrations/` and follow Flyway's `V{N}__{description}.sql` naming convention. The Drizzle TypeScript schema in `apps/zoltar-be/src/db/schema.ts` is the source of truth for inferred types and must be kept in sync with migrations manually.
