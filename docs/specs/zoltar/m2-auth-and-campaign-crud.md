# M2 — Auth, Campaign & Adventure CRUD

**Spec status:** Claude Code handoff  
**Depends on:** M1 complete (Docker Compose stack running, all migrations applied, NestJS skeleton with module hierarchy and service stubs in `apps/zoltar-be/src/services/interfaces/`)

---

## Goal

First shippable frontend + backend slice. After M2 a user can sign in via magic link, create a campaign, and see a list of adventures. No game logic — no synthesis, no GM pipeline, no oracle tables.

**Frontend note:** `apps/zoltar-fe` is a pure Svelte 5 SPA — no SvelteKit, no SSR, no server-side hooks. Auth is owned entirely by the NestJS backend. The frontend makes API calls and manages session state client-side.

---

## Part 1: V9 Migration — Adventure Status Column

M1 produced migrations V1–V8. This milestone adds V9, which must be applied before any backend code that references `adventures.status`.

**Why a new migration:** The original design inferred adventure status from the presence or absence of a `gm_context` row. Row absence is ambiguous — it could mean synthesis is in progress, synthesis failed, or a bug prevented row creation. An explicit column is required to represent failure states and to make status queryable without a join.

Create `infra/db/migrations/V9__adventure_status.sql`:

```sql
CREATE TYPE adventure_status AS ENUM ('synthesizing', 'ready', 'completed', 'failed');

ALTER TABLE adventure
  ADD COLUMN status adventure_status NOT NULL DEFAULT 'synthesizing';

-- Back-fill: adventures that already have a gm_context row are 'ready'.
UPDATE adventure a
SET status = 'ready'
WHERE EXISTS (
  SELECT 1 FROM gm_context g WHERE g.adventure_id = a.id
);

-- Adventures with completed_at set are 'completed'.
UPDATE adventure
SET status = 'completed'
WHERE completed_at IS NOT NULL;
```

Update the Drizzle schema in `apps/zoltar-be/src/db/schema.ts` — add `adventureStatusEnum` and the `status` column to the `adventures` table:

```typescript
export const adventureStatusEnum = pgEnum('adventure_status', [
  'synthesizing', 'ready', 'completed', 'failed',
]);

// In the adventures table definition, add:
status: adventureStatusEnum('status').notNull().default('synthesizing'),
```

State machine:
- Adventure created → `synthesizing`
- `submit_gm_context` tool called, gm_context written → `ready` (M4 sets this)
- `completed_at` set → `completed`
- Synthesis error → `failed`

In M2, newly created adventures always start as `synthesizing` and stay there (synthesis pipeline is M4). The `failed` and `ready` transitions are wired in M4. Status is read and returned in all adventure responses from M2 onward.

---

## Part 2: `packages/service-interfaces`

### 2.1 Rationale

The six abstract service classes currently stubbed in `apps/zoltar-be/src/services/interfaces/` need to be importable by the future closed-source SaaS implementation package without pulling in the entire backend app. They belong in a published workspace package, exactly like `@uv/auth-core`.

`@uv/auth-core` (`packages/auth-core/`) stays separate. `AuthService` has a different consumer profile — it is relevant to frontend-adjacent concerns and may be consumed outside the backend context. The six remaining service interfaces are backend-only concerns. See DECISIONS.md for the full rationale.

### 2.2 New package: `packages/service-interfaces/`

`packages/service-interfaces/package.json`:

```json
{
  "name": "@uv/service-interfaces",
  "version": "0.0.1",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  },
  "volta": {
    "extends": "../../package.json"
  }
}
```

Move the six abstract classes from `apps/zoltar-be/src/services/interfaces/` into `packages/service-interfaces/src/`. The noop implementations stay in `apps/zoltar-be/src/services/noop/` — they are backend-internal and do not move.

`index.ts` re-exports all six. Add `@uv/service-interfaces` to `apps/zoltar-be/package.json`. Update all import paths from the old local paths to the package import. Delete `apps/zoltar-be/src/services/interfaces/` once all imports are updated.

### 2.3 Resolve the `packages/auth-core` TODO

`packages/auth-core/src/index.ts` contains a TODO block. Remove it and replace with the real abstract class:

```typescript
export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export abstract class AuthService {
  abstract validateSession(sessionToken: string): Promise<AuthUser | null>;
  abstract getUserById(id: string): Promise<AuthUser | null>;
}
```

---

## Part 3: Backend Auth — Magic Link (Backend-Owned)

Auth.js is not used. The NestJS backend owns the full magic link lifecycle: token generation, email delivery, session creation, and session validation. The `user`, `session`, and `verification_token` tables from V1 are the right shape and are used as-is — we write to them directly.

### 3.1 `LocalAuthService`

Create `apps/zoltar-be/src/auth/local-auth.service.ts`. This is the `AuthService` implementation — it reads sessions from the DB:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuthService, AuthUser } from '@uv/auth-core';
import { DB_TOKEN } from '../db/db.module';
import * as schema from '../db/schema';

@Injectable()
export class LocalAuthService extends AuthService {
  constructor(@Inject(DB_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {
    super();
  }

  async validateSession(sessionToken: string): Promise<AuthUser | null> {
    const rows = await this.db
      .select({
        userId:  schema.sessions.userId,
        expires: schema.sessions.expires,
        name:    schema.users.name,
        email:   schema.users.email,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(eq(schema.sessions.sessionToken, sessionToken))
      .limit(1);

    const row = rows[0];
    if (!row || row.expires < new Date()) return null;
    return { id: row.userId, email: row.email, name: row.name };
  }

  async getUserById(id: string): Promise<AuthUser | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    const u = rows[0];
    if (!u) return null;
    return { id: u.id, email: u.email, name: u.name };
  }
}
```

### 3.2 Magic Link Endpoints

Four endpoints in `AuthController`. None except `/me` and `/signout` require `SessionGuard`.

**`POST /api/v1/auth/magic-link`** — unauthenticated.

1. Look up or create a `user` row for the submitted email (`id` = `nanoid()` or `crypto.randomUUID()`).
2. Generate a cryptographically random raw token: `crypto.randomBytes(32).toString('hex')`.
3. Hash it: `SHA-256(rawToken)`.
4. Upsert `verification_token`: `{ identifier: email, token: hashedToken, expires: now + 24h }`.
5. Call `EmailService.sendTransactional()` with the magic link: `${PUBLIC_APP_URL}/auth/verify?token=${rawToken}&email=${encodeURIComponent(email)}`.
6. Return `202` — no body. Do not reveal whether the email exists (prevents enumeration).

**`GET /api/v1/auth/verify`** — unauthenticated. Query params: `token`, `email`.

1. Hash the token. Look up `verification_token` by `{ identifier: email, token: hashedToken }`.
2. Not found or expired → redirect to `${PUBLIC_APP_URL}/signin?error=invalid_token`.
3. Delete the `verification_token` row (single-use).
4. Ensure `user` row exists (it should from the magic-link step).
5. Generate session token: `crypto.randomBytes(32).toString('hex')`.
6. Insert `session`: `{ sessionToken, userId, expires: now + 30d }`.
7. Set `Set-Cookie` header: `authjs.session-token=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=${COOKIE_DOMAIN}; Max-Age=2592000`.
8. Redirect to `${PUBLIC_APP_URL}/campaigns`.

**`POST /api/v1/auth/signout`** — protected by `SessionGuard`. Deletes the session row, clears the cookie (`Max-Age=0`). Returns `204`.

**`GET /api/v1/auth/me`** — protected by `SessionGuard`. Returns `{ id, email, name }`. Frontend calls this on app load to establish session state.

### 3.3 Cookie Domain

Set with `Domain=${COOKIE_DOMAIN}` from env (`.zoltar.local` in local dev, the actual domain in production). The leading dot allows the cookie to be sent to both `app.zoltar.local` and `api.zoltar.local`.

### 3.4 `SessionGuard`

Create `apps/zoltar-be/src/auth/session.guard.ts`:

- Reads `authjs.session-token` cookie from the Fastify request. Falls back to `Authorization: Bearer <token>` for curl/testing.
- Calls `AuthService.validateSession(token)`.
- `null` → `UnauthorizedException`.
- Valid → attaches `AuthUser` to `request.user`.

Create `apps/zoltar-be/src/auth/current-user.decorator.ts` extracting `request.user`. Controllers use `@CurrentUser() user: AuthUser`.

### 3.5 `AuthModule`

```typescript
@Module({
  providers: [
    { provide: AuthService, useClass: LocalAuthService },
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

Import in `AppModule`. Not global.

---

## Part 4: Email — `SmtpEmailService`

No Auth.js packages anywhere. Email delivery flows directly through `EmailService`.

Create `apps/zoltar-be/src/services/smtp-email.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '@uv/service-interfaces';
import * as nodemailer from 'nodemailer';

@Injectable()
export class SmtpEmailService extends EmailService {
  private readonly logger = new Logger(SmtpEmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    super();
    this.transporter = nodemailer.createTransport({
      host:   config.get('SMTP_HOST'),
      port:   config.get<number>('SMTP_PORT'),
      secure: false,
    });
  }

  async sendTransactional(to: string, subject: string, body: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.get('AUTH_EMAIL_FROM'),
      to,
      subject,
      html: body,
    });
    this.logger.debug(`Email sent to ${to}: ${subject}`);
  }
}
```

Wire `SmtpEmailService` as the `EmailService` binding in `ServicesModule` for local dev. `NoopEmailService` is retained for test contexts only.

Add to `apps/zoltar-be/package.json`:
```json
"nodemailer": "^6.9.0",
"@types/nodemailer": "^6.4.0"
```

---

## Part 5: Traefik + MailHog in Docker Compose

### 5.1 Routing Table

| Hostname                | Target            | Port |
|-------------------------|-------------------|------|
| `app.zoltar.local`      | `zoltar-fe`       | 5173 |
| `api.zoltar.local`      | `zoltar-be`       | 3000 |
| `playtest.zoltar.local` | `zoltar-playtest` | 5174 |

HTTP (port 80) redirects to HTTPS automatically.

### 5.2 Developer Prerequisites (document in README.md)

```sh
brew install mkcert
mkcert -install

# From repo root — infra/traefik/certs/ is gitignored
mkcert -cert-file infra/traefik/certs/local.crt \
       -key-file  infra/traefik/certs/local.key \
       "*.zoltar.local" zoltar.local

echo "127.0.0.1 app.zoltar.local api.zoltar.local playtest.zoltar.local" \
  | sudo tee -a /etc/hosts
```

### 5.3 `infra/traefik/traefik.yml`

```yaml
api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entrypoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    exposedByDefault: false

tls:
  certificates:
    - certFile: /certs/local.crt
      keyFile:  /certs/local.key
```

### 5.4 `docker-compose.yml` additions

```yaml
traefik:
  image: traefik:v3.0
  ports:
    - "80:80"
    - "443:443"
    - "8080:8080"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
    - ./infra/traefik/traefik.yml:/traefik.yml:ro
    - ./infra/traefik/certs:/certs:ro
  depends_on:
    - backend
    - frontend

mailhog:
  image: mailhog/mailhog
  ports:
    - "1025:1025"
    - "8025:8025"
```

Backend labels:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.backend.rule=Host(`api.zoltar.local`)"
  - "traefik.http.routers.backend.entrypoints=websecure"
  - "traefik.http.routers.backend.tls=true"
  - "traefik.http.services.backend.loadbalancer.server.port=3000"
```

Frontend labels:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.frontend.rule=Host(`app.zoltar.local`)"
  - "traefik.http.routers.frontend.entrypoints=websecure"
  - "traefik.http.routers.frontend.tls=true"
  - "traefik.http.services.frontend.loadbalancer.server.port=5173"
```

### 5.5 Environment Variables

Add to `.env.example`:

```env
# Auth
AUTH_EMAIL_FROM=noreply@zoltar.local
COOKIE_DOMAIN=.zoltar.local

# SMTP (MailHog in local dev)
SMTP_HOST=mailhog
SMTP_PORT=1025

# Public URLs
PUBLIC_APP_URL=https://app.zoltar.local
PUBLIC_API_URL=https://api.zoltar.local
```

---

## Part 6: Mothership Zod Schemas

Create `packages/game-systems/` (`@uv/game-systems`). Both `apps/zoltar-fe` and `apps/zoltar-be` declare it as a workspace dependency.

### 6.1 `packages/game-systems/src/shared.ts`

```typescript
import { z } from 'zod';

export const ResourcePoolSchema = z.object({
  current: z.number().int(),
  max:     z.number().int().nullable(),
});

export const EntitySchema = z.object({
  visible:  z.boolean(),
  status:   z.enum(['alive', 'dead', 'unknown']).default('unknown'),
  npcState: z.string().optional(),
  // npcState: update whenever NPC disposition or knowledge changes.
});

export const FlagSchema = z.object({
  value:   z.boolean(),
  trigger: z.string(),
  // trigger: in-fiction condition that flips this flag. Immutable after init.
  // stateChanges.flag_triggers carries only { flagName: newBooleanValue }.
});

export const ScenarioStateEntrySchema = z.object({
  current: z.number().int(),
  max:     z.number().int().nullable(),
  note:    z.string().default(''),
});
```

### 6.2 `packages/game-systems/src/mothership/campaign-state.schema.ts`

```typescript
import { z } from 'zod';
import { ResourcePoolSchema, EntitySchema, FlagSchema, ScenarioStateEntrySchema } from '../shared';

export const MothershipCampaignStateSchema = z.object({
  schemaVersion: z.literal(1),
  // Flat map keyed as {entity_id}_{pool_name}: dr_chen_hp, vasquez_stress
  resourcePools: z.record(z.string(), ResourcePoolSchema).default({}),
  // Visibility, status, NPC narrative state. Positions live in grid_entities.
  entities:      z.record(z.string(), EntitySchema).default({}),
  // Each flag carries its value and the in-fiction condition that flips it.
  flags:         z.record(z.string(), FlagSchema).default({}),
  // Non-entity numeric state: oxygen, reactor power, countdown timers, etc.
  scenarioState: z.record(z.string(), ScenarioStateEntrySchema).default({}),
  // Environmental scratchpad: first-mention details that must stay consistent.
  worldFacts:    z.record(z.string(), z.string()).default({}),
});

export type MothershipCampaignState = z.infer<typeof MothershipCampaignStateSchema>;

export const emptyMothershipState = (): MothershipCampaignState => ({
  schemaVersion: 1,
  resourcePools: {},
  entities:      {},
  flags:         {},
  scenarioState: {},
  worldFacts:    {},
});
```

### 6.3 `packages/game-systems/src/mothership/character-sheet.schema.ts`

```typescript
import { z } from 'zod';

export const MothershipCharacterSheetSchema = z.object({
  name:      z.string().min(1).max(100),
  pronouns:  z.string().max(50).optional(),
  class:     z.enum(['teamster', 'scientist', 'android', 'marine']),
  level:     z.number().int().min(1).max(10).default(1),
  stats: z.object({
    strength:  z.number().int().min(0).max(100),
    speed:     z.number().int().min(0).max(100),
    intellect: z.number().int().min(0).max(100),
    combat:    z.number().int().min(0).max(100),
  }),
  saves: z.object({
    fear:   z.number().int().min(0).max(100),
    sanity: z.number().int().min(0).max(100),
    body:   z.number().int().min(0).max(100),
    armor:  z.number().int().min(0).max(100),
  }),
  maxHp:     z.number().int().min(1),
  skills:    z.array(z.string()).default([]),
  equipment: z.array(z.string()).default([]),
  notes:     z.string().max(2000).optional(),
});

export type MothershipCharacterSheet = z.infer<typeof MothershipCharacterSheetSchema>;
```

---

## Part 7: Backend — CRUD Endpoints

### 7.1 Shared Patterns

- `app.setGlobalPrefix('api/v1')` in `main.ts`.
- All controllers except `AuthController`: `@UseGuards(SessionGuard)` at class level.
- `CampaignService.assertMember(campaignId, userId)` — `ForbiddenException` if not a member.
- `CampaignService.assertOwner(campaignId, userId)` — scaffold now, used from M3+.
- Validation: `ZodValidationPipe`.
- CORS: configure `@fastify/cors` in `main.ts` — `origin: process.env.PUBLIC_APP_URL, credentials: true`.

### 7.2 `CampaignModule`

**`POST /campaigns`** — create campaign + `campaign_member` (owner) + `campaign_state` (empty Mothership state). Response `201`.

```typescript
z.object({
  name:       z.string().min(1).max(120),
  visibility: z.enum(['private', 'invite', 'org']).default('private'),
  diceMode:   z.enum(['soft_accountability', 'commitment']).default('soft_accountability'),
})
```

**`GET /campaigns`** — list campaigns the authenticated user is a member of.

**`GET /campaigns/:campaignId`** — membership check. `403`/`404` as appropriate.

### 7.3 `AdventureModule`

**`POST /campaigns/:campaignId/adventures`** — membership check. Creates adventure with `status: 'synthesizing'`, `caller_id` = authenticated user. Oracle selections accepted but ignored (M4). Response `202`.

**`GET /campaigns/:campaignId/adventures`** — membership check. Most recent first.

Adventure response object: `id`, `campaignId`, `status`, `adventureMode`, `callerId`, `createdAt`, `completedAt`.

**`GET /campaigns/:campaignId/adventures/:adventureId`** — membership check.

---

## Part 8: Frontend — Svelte SPA

`apps/zoltar-fe` is a plain Svelte 5 + Vite SPA. No SvelteKit.

### 8.1 Project Setup

If the existing project was scaffolded as SvelteKit, strip it back:

```sh
cd apps/zoltar-fe
npm remove @sveltejs/kit @sveltejs/adapter-auto
npm install svelte@^5 vite @sveltejs/vite-plugin-svelte
```

`vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: { port: 5173, host: '0.0.0.0' },
});
```

`index.html` → `src/main.ts` → mounts `App.svelte` to `#app`. Standard Vite SPA entry point.

### 8.2 Session State

The session cookie is `HttpOnly` — JS cannot read it. Call `GET /api/v1/auth/me` on app load to establish session state.

```typescript
// src/lib/session.svelte.ts
import { writable } from 'svelte/store';

export type SessionUser = { id: string; email: string | null; name: string | null };
export const session = writable<SessionUser | null>(null);
export const sessionLoading = writable(true);

export async function loadSession() {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/auth/me`, {
      credentials: 'include',
    });
    session.set(res.ok ? await res.json() : null);
  } catch {
    session.set(null);
  } finally {
    sessionLoading.set(false);
  }
}
```

`credentials: 'include'` is required on all API calls so the session cookie is sent cross-origin.

Add to `.env` (frontend):
```env
VITE_API_URL=https://api.zoltar.local
```

### 8.3 Client-Side Routing

Simple history-based router is sufficient for M2:

```typescript
// src/lib/router.svelte.ts
import { writable } from 'svelte/store';

export const route = writable(window.location.pathname);
window.addEventListener('popstate', () => route.set(window.location.pathname));
export function navigate(path: string) {
  window.history.pushState({}, '', path);
  route.set(path);
}
```

`App.svelte` switches on `$route` after session load completes. Unauthenticated users are redirected to `/signin` client-side.

### 8.4 Sign-In Page

```typescript
async function handleSignIn(email: string) {
  await fetch(`${import.meta.env.VITE_API_URL}/api/v1/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });
  showConfirmation = true;  // "Check your email"
}
```

Include a local-dev note: "Check MailHog at http://localhost:8025 for your link."

The `/auth/verify` route is handled entirely by the backend — the verify endpoint redirects to `/campaigns` after writing the session cookie. No frontend route needed for it.

### 8.5 Campaign List and Adventure Shell

Server calls use `credentials: 'include'`. Campaign list shows cards linking to `/campaigns/:id`. "New Campaign" inline form POSTs and navigates. Adventure list shows status badges; "New Adventure" button disabled.

---

## Part 9: Documentation Updates

CC must apply these alongside the code:

- **`docs/environments.md`** — apply `m2-environments-patch.md`
- **`docs/decisions.md`** — append entries from `m2-decisions-addendum.md`
- **`docs/zoltar-design-doc.md`** — apply patches from `m2-design-doc-patches.md`

---

## Verification Checklist

1. **V9 applied** — 9 migrations. `SELECT status FROM adventure LIMIT 1;` returns a valid enum value.
2. **`@uv/service-interfaces` builds** — `tsc --noEmit` passes. `zoltar-be` imports from package cleanly.
3. **`@uv/auth-core` TODO resolved** — exports the real `AuthService` abstract class.
4. **Traefik routes** — `curl -k https://api.zoltar.local/health` → `{"status":"ok"}`. `curl -k https://app.zoltar.local/` → HTML.
5. **MailHog running** — `http://localhost:8025` opens the web UI.
6. **Magic link flow** — submit email on signin page → link appears in MailHog → clicking it sets cookie and redirects to `/campaigns`.
7. **Cookie shape** — `HttpOnly`, `Secure`, `SameSite=Lax`, `Domain=.zoltar.local`.
8. **`GET /auth/me`** — `{ id, email, name }` when authenticated. `401` when not.
9. **Sign-out** — `POST /auth/signout` deletes session row, clears cookie, returns `204`.
10. **No Auth.js packages** — `zoltar-fe/package.json` contains no `@auth/*` dependencies.
11. **No SvelteKit** — `zoltar-fe/package.json` contains no `@sveltejs/kit`. No `+page` files. No `hooks.server.ts`.
12. **CORS** — `fetch` from `app.zoltar.local` to `api.zoltar.local` with `credentials: 'include'` succeeds.
13. **Campaign CRUD** — create, list, fetch. `403` for non-member campaigns.
14. **Adventure CRUD** — create (`status = synthesizing`), list, fetch.
15. **Membership isolation** — two accounts; campaigns not visible across accounts.
16. **Zod schemas** — `tsc --noEmit` in `packages/game-systems` passes. `emptyMothershipState()` parses successfully.
17. **`tsc --noEmit`** (backend and frontend) — no type errors.
18. **Documentation updated** — all three doc patches applied.

---

## Out of Scope for M2

- Oracle tables (M3)
- Character sheet creation UI (M3)
- GM context synthesis (M4)
- Play view / action submission (M6)
- Production Dockerfile / Droplet deployment (M8)
- Campaign invite flows
- Any game logic or rule evaluation
