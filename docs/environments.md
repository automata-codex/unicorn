# Environments

This document describes the environments in use for Zoltar and Unicorn VTT development and deployment.

## Local Development

**Branch:** `main`
**Deployment mode:** `selfhosted`

The standard development environment. The Docker Compose stack defines four services — `db`, `flyway`, `backend`, `frontend` — but two distinct workflows are supported.

```
AUTH_PROVIDER=authjs
REALTIME_PROVIDER=noop
STORAGE_PROVIDER=local
DEPLOYMENT_MODE=selfhosted
```

The Anthropic API key is a personal key for development use. The NoopRealtimeService is active — real-time features (live typing preview, presence indicators) are not available in this environment.

### Workflow A — Full stack in Docker (first run, sanity checks, CI)

```sh
task up:all
```

Brings up Postgres + pgvector, runs Flyway migrations to completion, then starts the backend (`http://localhost:3000`) and frontend (`http://localhost:5173`) in containers. Logs stream in the foreground; Ctrl-C to stop. Use this when:

- Setting up a fresh clone for the first time
- Sanity-checking that the whole stack still composes after a non-trivial change
- Reproducing a CI failure locally
- Onboarding a new contributor (no need to install Node, just Docker)

The `backend` service has `depends_on: { flyway: { condition: service_completed_successfully } }`, so the API waits for migrations before starting. Under the hood, `task up:all` runs `docker compose up --build`.

### Workflow B — Host-run apps with infra in Docker (daily development)

The recommended day-to-day loop. Run only the database and Flyway in Docker; run the apps directly on your host. This gives you native debugger attach, fast file watch, IDE-integrated test runners, and simpler stack traces — all of which are clunky through a container.

```sh
# Start infra (db + flyway migrate, blocks until migrations are applied)
task up

# Backend (terminal 1)
cd apps/zoltar-be
npm run start:dev      # or `npm run start:debug` for the inspector

# Frontend (terminal 2)
cd apps/zoltar-fe
npm run dev

# When done
task down
```

`task up` starts the `db` service, waits until it reports healthy, then runs `flyway migrate` as a separate blocking step (rather than relying on Compose `--wait`, which only confirms the container is running, not that the one-shot job has finished). `task down` stops and removes the Docker stack but preserves the `pgdata` volume, so your database survives across sessions.

Two important notes:

1. **Do not also start the `backend` / `frontend` compose services** in this mode — they'll fight the host processes for ports 3000 and 5173. `task up` brings up only the two infra services. If you previously used `task up:all`, run `task down` before switching modes.
2. **`DATABASE_URL` differs by mode.** Inside compose, the database host is the service name `db`; from the host, it's `localhost`. The `.env.example` value is the compose form. For host-run development, override `DATABASE_URL` to `postgresql://zoltar:zoltar_dev@localhost:5432/zoltar` via shell env, a per-app `.env.local`, or your IDE run configuration.

### Database / Flyway commands

Database migrations are managed by Flyway, run as a one-shot container in the Compose stack. The `task` wrappers (defined in `infra/db/Taskfile.yml` and namespaced from the root `Taskfile.yml`) are the recommended interface:

| Command               | What it does                                                              |
|-----------------------|---------------------------------------------------------------------------|
| `task flyway:migrate` | Apply pending migrations against the local dev database                   |
| `task flyway:info`    | Show the status of all migrations                                         |
| `task flyway:clean`   | Drop all objects in the configured schemas (destructive — local dev only) |
| `task flyway:repair`  | Repair the schema history table after a failed migration                  |

Each verb runs `docker compose run --rm flyway <verb>`, so the same connection config and migration volume mount is used regardless of how Flyway is invoked. The `flyway` compose service also has `command: migrate` set and the `backend` service depends on it via `service_completed_successfully`, so `docker compose up` applies migrations automatically as part of stack startup.

### Local Dev Reverse Proxy

Traefik runs as a reverse proxy in the Docker Compose stack, routing all local dev traffic via
Host-based rules over HTTPS. mkcert issues a wildcard certificate trusted by the local machine.
This gives SSL parity with production and means Auth.js session cookies and OAuth redirect URIs
behave identically in local dev and on the Droplet.

| Hostname                | Target                  | Port |
|-------------------------|-------------------------|------|
| `app.zoltar.local`      | `zoltar-fe` (SvelteKit) | 5173 |
| `api.zoltar.local`      | `zoltar-be` (NestJS)    | 3000 |
| `playtest.zoltar.local` | `zoltar-playtest`       | 5174 |

HTTP (port 80) redirects to HTTPS automatically. The Traefik dashboard is available at
`https://api.zoltar.local:8080` in local dev.

#### One-time setup (per dev machine)

```sh
# Install mkcert and trust the local CA
brew install mkcert   # macOS; see https://github.com/FiloSottile/mkcert for other platforms
mkcert -install

# Generate the wildcard cert (run from repo root)
# Output goes to infra/traefik/certs/ — this directory is gitignored
mkcert -cert-file infra/traefik/certs/local.crt \
       -key-file  infra/traefik/certs/local.key \
       "*.zoltar.local" zoltar.local

# Add /etc/hosts entries
echo "127.0.0.1 app.zoltar.local api.zoltar.local playtest.zoltar.local" \
  | sudo tee -a /etc/hosts
```

Certs are per-machine and must be generated locally — they are not committed to the repository.
Each developer runs this once. The `infra/traefik/certs/` directory is in `.gitignore`.

#### Verify the setup

```sh
# Health check through Traefik
curl -k https://api.zoltar.local/health   # should return {"status":"ok"}

# Frontend
curl -k https://app.zoltar.local/         # should return SvelteKit HTML

# MailHog web UI (magic link emails)
open http://localhost:8025
```

#### MailHog

MailHog runs as a service in the Compose stack, providing an SMTP sink for local dev. Auth.js magic
link emails are delivered via `SmtpEmailService` configured to `mailhog:1025`. Click magic links by
visiting the MailHog web UI at `http://localhost:8025` — emails do not leave the local machine.

## Personal DigitalOcean Droplet (Self-Hosted)

**Branch:** tagged releases
**Deployment mode:** `selfhosted`

A personal DigitalOcean Droplet running the self-hosted open-core build. This is the primary dogfooding environment — it runs tagged releases, not `main`. Deployment is manual: tag a release, pull on the Droplet, restart via Docker Compose.

```
AUTH_PROVIDER=authjs
REALTIME_PROVIDER=noop
STORAGE_PROVIDER=local
DEPLOYMENT_MODE=selfhosted
```

This environment represents the experience a self-hoster would have running Zoltar on their own infrastructure.

## Local SaaS Profile

**Status:** Not yet configured — planned for Phase 3

A local environment that mirrors the SaaS configuration: Clerk auth, Ably real-time, S3-compatible storage (MinIO locally), and multi-tenant RLS policies active on Postgres. Used for developing and testing SaaS-layer features before deploying to production.

This environment will be documented fully when SaaS infrastructure development begins in Phase 3.

## SaaS Production

**Status:** Not yet configured — planned for Phase 3

The managed hosted offering. Runs on DigitalOcean App Platform with a managed Postgres database. Multi-tenant via Row Level Security on `org_id`. Clerk auth, S3 asset storage, Ably real-time, Stripe billing.

```
AUTH_PROVIDER=clerk
REALTIME_PROVIDER=ably
STORAGE_PROVIDER=s3
DEPLOYMENT_MODE=saas
```

This environment will be documented fully when SaaS infrastructure development begins in Phase 3.
