# M2 Implementation Plan — Auth, Campaign & Adventure CRUD

**Spec:** `docs/specs/zoltar/m2-auth-and-campaign-crud.md`
**Created:** 2026-04-12 | **Revised:** 2026-04-12

Pause after each phase for manual code review and git commit.

---

## Completed Work

The following spec parts are implemented and committed:

- **Part 1** — V9 migration (`adventure_status` enum + column) and Drizzle schema update
- **Part 2** — `@uv/service-interfaces` package (6 interfaces moved, imports updated), `@uv/auth-core` TODO resolved
- **Part 5** — Traefik + MailHog in Docker Compose, `.env.example` updated, certs gitignored
- **Part 6** — `@uv/game-systems` package (shared schemas, Mothership campaign state + character sheet)
- **Partial Part 3** — `SessionGuard` (cookie + dev-only Bearer fallback), `@CurrentUser` decorator, `SmtpEmailService` wired in AppModule
- **Partial Part 9** — Design doc patches applied

---

## Phase A — Rework Auth Service + Magic Link Endpoints (Spec Part 3)

Rename `AuthJsService` → `LocalAuthService`. Replace the `send-verification` endpoint with the four backend-owned magic link endpoints.

1. Rename `auth-js.service.ts` → `local-auth.service.ts`, rename class to `LocalAuthService`, update AuthModule and tests
2. `POST /auth/magic-link` — look up or create user, generate token, hash with SHA-256, upsert `verification_token`, send magic link email via `EmailService`
3. `GET /auth/verify` — hash token, look up + validate, delete token row, create session, set cookie, redirect to `/campaigns`
4. `POST /auth/signout` — guarded, delete session row, clear cookie, return `204`
5. `GET /auth/me` — guarded, return `{ id, email, name }`
6. Remove old `send-verification` endpoint and its test
7. Unit tests for all four endpoints and the token generation/hashing logic

**Verification:** `tsc --noEmit` passes. All auth unit tests pass. Manual test: `POST /auth/magic-link` → email in MailHog → click link → cookie set → `GET /auth/me` returns user → `POST /auth/signout` clears session.

---

## Phase B — .env.example Cleanup + CORS + Global Prefix (Spec Parts 5.5, 7.1)

Small backend wiring changes before CRUD endpoints.

1. Update `.env.example`: add `COOKIE_DOMAIN=.zoltar.local`, remove SvelteKit-only vars (`AUTH_SECRET`, `AUTH_URL`, `INTERNAL_API_URL`)
2. Update `docker-compose.yml` frontend service: remove SvelteKit env vars, add `VITE_API_URL`
3. Add `COOKIE_DOMAIN` and `PUBLIC_APP_URL` to backend env schema
4. `app.setGlobalPrefix('api/v1')` in `main.ts`
5. Configure `@fastify/cors` in `main.ts` — `origin: process.env.PUBLIC_APP_URL, credentials: true`
6. Zod validation pipe (minimal custom pipe)

**Verification:** `docker compose config` validates. `tsc --noEmit` passes. CORS headers present on responses.

---

## Phase C — Campaign CRUD (Spec Part 7.2)

1. `CampaignService` — `create`, `findAllForUser`, `findById`, `assertMember`, `assertOwner`
2. `CampaignController` — `POST /campaigns`, `GET /campaigns`, `GET /campaigns/:campaignId`
3. DTOs with Zod validation (`CreateCampaignSchema`)
4. Unit tests for service and controller

**Verification:** Create campaign (201), list campaigns, fetch by ID, 403 on non-member, 404 on missing.

---

## Phase D — Adventure CRUD (Spec Part 7.3)

1. `AdventureService` — `create`, `findAllForCampaign`, `findById`
2. `AdventureController` — `POST /campaigns/:campaignId/adventures`, `GET` list, `GET` single
3. DTOs with Zod validation (`CreateAdventureSchema`)
4. Unit tests for service and controller

**Verification:** Create adventure (202, status = `synthesizing`), list, fetch. Membership check on all endpoints.

---

## Phase E — Frontend: Strip SvelteKit + SPA Shell (Spec Part 8.1–8.3)

Convert `apps/zoltar-fe` from SvelteKit to a plain Svelte 5 + Vite SPA.

1. Remove SvelteKit packages (`@sveltejs/kit`, `@sveltejs/adapter-auto`), delete SvelteKit files (`+page`, `+layout`, `hooks.server.ts`, `app.d.ts` etc.)
2. Set up Vite SPA entry point: `index.html` → `src/main.ts` → `App.svelte`
3. Session store (`src/lib/session.svelte.ts`) — `loadSession()` calls `GET /auth/me`
4. Client-side router (`src/lib/router.svelte.ts`) — history-based, minimal
5. `App.svelte` — route switch after session load, redirect unauthenticated to `/signin`

**Verification:** `npm run build` succeeds. App loads and redirects to `/signin` when unauthenticated.

---

## Phase F — Frontend: Pages + Documentation (Spec Parts 8.4–8.5, 9)

1. Sign-in page — email form, `POST /auth/magic-link`, "check your email" confirmation
2. Campaign list page — fetch + render campaigns, "New Campaign" inline form
3. Adventure list shell — campaign detail with adventure list + status badges
4. Update `docs/environments.md` — Traefik section
5. Update `docs/decisions.md` — M2 addendum entries

**Verification:** Full sign-in flow through MailHog. Campaign CRUD from UI. Adventure list renders. `tsc --noEmit` passes. Docs updated. All verification checklist items from spec pass.
