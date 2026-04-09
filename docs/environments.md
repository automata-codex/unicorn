# Environments

This document describes the environments in use for Zoltar and Unicorn VTT development and deployment.

## Local Development

**Branch:** `main`
**Deployment mode:** `selfhosted`

The standard development environment. All services run locally via Docker Compose.

```
AUTH_PROVIDER=authjs
REALTIME_PROVIDER=noop
STORAGE_PROVIDER=local
DEPLOYMENT_MODE=selfhosted
```

The Anthropic API key is a personal key for development use. The NoopRealtimeService is active — real-time features (live typing preview, presence indicators) are not available in this environment.

### Local Dev Reverse Proxy (Deferred)

The intended local dev setup uses **Traefik** as a reverse proxy with `*.zoltar.local` hostnames and
mkcert-issued TLS certificates. This gives SSL parity with production, catches secure-cookie and
CORS issues early, and routes multiple services without manual port management:

| Hostname                | Target                  |
|-------------------------|-------------------------|
| `app.zoltar.local`      | `zoltar-fe` (SvelteKit) |
| `api.zoltar.local`      | `zoltar-be` (NestJS)    |
| `playtest.zoltar.local` | `zoltar-playtest`       |

**This is not set up yet.** It becomes worthwhile once the frontend and backend are integrated and
Auth.js is in place — secure cookies and OAuth redirect URIs are where the SSL gap actually bites.
Until then, services run on their assigned ports and are accessed directly.

When the time comes, setup will require:
- [`mkcert`](https://github.com/FiloSottile/mkcert) installed and CA trusted on each dev machine
- `/etc/hosts` entries for each `*.zoltar.local` hostname
- A Traefik service added to `docker-compose.yml` with label-based routing per service

Document the setup procedure here when it's implemented.

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
