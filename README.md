# Unicorn Monorepo

**Unicorn** is a monorepo housing the Automata Codex tabletop RPG platforms. It contains Zoltar, an AI-powered GM-in-a-box for solo and small-group play, and Unicorn VTT, a traditional virtual tabletop. Both products share a common rules engine, 2D renderer, and authentication layer maintained as workspace packages.

This repository contains the open-core versions of both products, licensed under the Elastic License 2.0. Self-hosters can run Zoltar and Unicorn VTT on their own infrastructure by bringing their own Anthropic API key. Managed hosting, multi-tenancy, and real-time sync are SaaS-layer features not included here.

## Local Development

### Prerequisites

- [Docker](https://www.docker.com/) (Compose v2)
- [Task](https://taskfile.dev/) — `brew install go-task` on macOS
- Node.js `>=22` (a `volta` pin is set in `package.json`)

### First run (full stack in Docker)

```sh
cp .env.example .env
task up:all
```

This brings up Postgres + pgvector, applies all Flyway migrations, starts the NestJS backend on `http://localhost:3000`, and starts the SvelteKit frontend dev server on `http://localhost:5173`. Use this path for first-clone setup, sanity checks, or when you want a one-command stack. Logs stream in the foreground; Ctrl-C to stop.

### Daily development (host-run backend / frontend)

For day-to-day development the recommended workflow is to run only the infrastructure services in Docker and run the apps directly on the host. This gives you native debugger attach, fast file watch, and IDE-integrated test runners — all of which are clunkier through a container.

```sh
# Start infra (Postgres + Flyway migrations)
task up

# In one terminal: backend
cd apps/zoltar-be
npm run start:dev

# In another terminal: frontend
cd apps/zoltar-fe
npm run dev
```

When you're done:

```sh
task down
```

`task down` stops and removes the Docker stack. Volumes (and database data) are preserved across sessions.

Two important notes about the host-run mode:

1. **Do not also start the `backend` / `frontend` compose services** — they'll fight the host processes for ports 3000 and 5173. `task up` only brings up the two infra services. If you previously ran `task up:all`, run `task down` before switching modes.
2. **`DATABASE_URL` differs by mode.** Inside compose the database host is `db` (the service name); from the host it's `localhost`. The `.env.example` value is the compose form. For host-run development, override `DATABASE_URL` to `postgresql://zoltar:zoltar_dev@localhost:5432/zoltar` — either via shell env, a per-app `.env.local`, or your run configuration.

### Database / Flyway commands

Flyway runs in a one-shot container managed by Docker Compose. The `task` wrappers are the recommended interface:

| Command              | What it does                                                            |
|----------------------|-------------------------------------------------------------------------|
| `task flyway:migrate` | Apply pending migrations against the local dev database                 |
| `task flyway:info`    | Show the status of all migrations                                       |
| `task flyway:clean`   | Drop all objects in the configured schemas (destructive — local dev only) |
| `task flyway:repair`  | Repair the schema history table after a failed migration                |

Migration files live in `infra/db/migrations/` and follow Flyway's `V{N}__{description}.sql` naming convention. The Drizzle TypeScript schema in `apps/zoltar-be/src/db/schema.ts` is the source of truth for inferred types and must be kept in sync with migrations manually.
