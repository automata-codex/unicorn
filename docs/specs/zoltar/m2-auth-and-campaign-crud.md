# M2 — Auth, Campaign & Adventure CRUD

**Spec status:** Claude Code handoff  
**Depends on:** M1 complete (Docker Compose stack running, all migrations applied, NestJS skeleton with module hierarchy and service stubs in `apps/zoltar-be/src/services/interfaces/`)

---

## Goal

First shippable frontend + backend slice. After M2 a user can sign in via magic link, create a campaign, and see a list of adventures. No game logic — no synthesis, no GM pipeline, no oracle tables.

---

## Part 1: V9 Migration — Adventure Status Column

M1 produced migrations V1–V8. This milestone adds V9, which must be applied before any backend code that references `adventures.status`.

**Why a new migration:** The original design inferred adventure status from the presence or absence of a `gm_context` row. This is brittle — absence is ambiguous between "synthesis in progress," "synthesis failed," and "a bug." An explicit column is necessary to represent failure states and to make status queryable without a join.

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

// In adventures table definition, add:
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

`@uv/auth-core` (`packages/auth-core/`) stays separate from this new package. The distinction: `AuthService` has a different consumer profile — it is relevant to frontend-adjacent concerns (session validation) and may be consumed outside the backend context. The six remaining service interfaces are backend-only concerns. See DECISIONS.md for the full rationale.

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

Move the six abstract classes from `apps/zoltar-be/src/services/interfaces/` into `packages/service-interfaces/src/`:

```
packages/service-interfaces/src/
  entitlements.service.ts
  metering.service.ts
  email.service.ts
  asset-storage.service.ts
  realtime.service.ts
  feature-flag.service.ts
  index.ts
```

`index.ts` re-exports all six.

The noop implementations stay in `apps/zoltar-be/src/services/noop/` — they are backend-internal and should not move.

### 2.3 Dependency wiring

Add `@uv/service-interfaces` to `apps/zoltar-be/package.json` dependencies:

```json
"@uv/service-interfaces": "*"
```

Update all import paths in `zoltar-be` from the old local paths to the package import:

```typescript
// Before
import { EmailService } from '../services/interfaces/email.service';
// After
import { EmailService } from '@uv/service-interfaces';
```

Delete `apps/zoltar-be/src/services/interfaces/` directory once all imports are updated.

### 2.4 Resolve the `packages/auth-core` TODO

`packages/auth-core/src/index.ts` contains a TODO block. Remove it and replace with the real abstract class:

```typescript
export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export abstract class AuthService {
  /** Validate a session token. Returns the associated user or null if invalid/expired. */
  abstract validateSession(sessionToken: string): Promise<AuthUser | null>;
  abstract getUserById(id: string): Promise<AuthUser | null>;
}
```

---

## Part 3: Backend Auth

### 3.1 How Auth Works in This Stack

Auth.js (`@auth/sveltekit`) runs on the SvelteKit frontend (`apps/zoltar-fe`). It owns sign-in, session creation, and the `session`, `account`, `user`, and `verification_token` DB tables (already migrated in V1). Magic link emails go through `EmailService.sendTransactional()` — see Part 4.

The NestJS backend never handles sign-in. It authenticates API requests by reading the session token from the cookie and looking it up in the `session` table.

### 3.2 `AuthJsService`

Create `apps/zoltar-be/src/auth/auth-js.service.ts`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuthService, AuthUser } from '@uv/auth-core';
import { DB_TOKEN } from '../db/db.module';
import * as schema from '../db/schema';

@Injectable()
export class AuthJsService extends AuthService {
  constructor(@Inject(DB_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {
    super();
  }

  async validateSession(sessionToken: string): Promise<AuthUser | null> {
    const rows = await this.db
      .select({
        userId: schema.sessions.userId,
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

### 3.3 `AuthModule`

Fill in `apps/zoltar-be/src/auth/auth.module.ts`:

```typescript
@Module({
  providers: [
    { provide: AuthService, useClass: AuthJsService },
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

Import in `AppModule`. Not global — feature modules import it explicitly.

### 3.4 `SessionGuard`

Create `apps/zoltar-be/src/auth/session.guard.ts`:

- Reads the `authjs.session-token` cookie from the Fastify request. Falls back to `Authorization: Bearer <token>` for curl/testing convenience.
- Calls `AuthService.validateSession(token)`.
- `null` → `UnauthorizedException`.
- Valid → attaches `AuthUser` to `request.user`.

Create `apps/zoltar-be/src/auth/current-user.decorator.ts` — a param decorator that extracts `request.user`. Controllers use `@CurrentUser() user: AuthUser` throughout.

---

## Part 4: Auth.js Frontend + EmailService Wiring

### 4.1 Install Dependencies

In `apps/zoltar-fe`:

```sh
npm install @auth/sveltekit @auth/drizzle-adapter
```

In `apps/zoltar-be` (if not already present): `nodemailer` and `@types/nodemailer` for the SMTP email implementation.

### 4.2 `SmtpEmailService`

The local dev email implementation. Sends via SMTP — in local dev this points at MailHog; in production it uses the self-hoster's SMTP server.

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
      host: config.get('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT'),
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

Wire `SmtpEmailService` in `ServicesModule` for local dev (replacing `NoopEmailService` for `EmailService`). `NoopEmailService` is retained for any context where email genuinely should not be delivered.

### 4.3 Auth.js Configuration

Create `apps/zoltar-fe/src/auth.ts`:

```typescript
import { SvelteKitAuth } from '@auth/sveltekit';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '$lib/db';
import { env } from '$env/dynamic/private';
import { EmailService } from '@uv/service-interfaces';

// EmailService is resolved via the backend API — see sendVerificationRequest below.
// Auth.js's built-in email providers are NOT used; delivery goes through the
// backend EmailService abstraction so local dev and production share one config path.

export const { handle, signIn, signOut } = SvelteKitAuth({
  adapter: DrizzleAdapter(db),
  providers: [
    {
      id: 'email',
      name: 'Email',
      type: 'email',
      from: env.AUTH_EMAIL_FROM,
      server: {},
      maxAge: 24 * 60 * 60,
      async sendVerificationRequest({ identifier: email, url }) {
        // POST to the backend's internal send-verification endpoint.
        // The backend resolves EmailService (SmtpEmailService in dev → MailHog,
        // SmtpEmailService in production → self-hoster's SMTP config).
        await fetch(`${env.INTERNAL_API_URL}/api/v1/auth/send-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, url }),
        });
      },
    },
  ],
});
```

### 4.4 Backend Verification Endpoint

Add a minimal internal endpoint to `AuthModule` that the SvelteKit layer calls to deliver magic link emails. This endpoint is not protected by `SessionGuard` (the user isn't authenticated yet).

`POST /api/v1/auth/send-verification`:

```typescript
@Post('send-verification')
async sendVerification(
  @Body() body: { email: string; url: string },
) {
  await this.emailService.sendTransactional(
    body.email,
    'Sign in to Zoltar',
    `<p>Click <a href="${body.url}">here</a> to sign in. This link expires in 24 hours.</p>`,
  );
}
```

**Security note:** This endpoint should only be reachable from the internal Docker network (not exposed through Traefik). In local dev this is naturally the case since `INTERNAL_API_URL` points to `http://backend:3000` (Docker internal). Document this in the endpoint's inline comment.

### 4.5 SvelteKit Hooks

`apps/zoltar-fe/src/hooks.server.ts`:

```typescript
import { handle as authHandle } from './auth';
import { sequence } from '@sveltejs/kit/hooks';

export const handle = sequence(authHandle);
```

---

## Part 5: Traefik + MailHog in Docker Compose

### 5.1 Overview

Traefik routes all local dev traffic through a single entry point using Host-based routing. MailHog provides an SMTP sink and web UI for inspecting magic link emails.

Routing table:

| Hostname                | Target            | Port |
|-------------------------|-------------------|------|
| `app.zoltar.local`      | `zoltar-fe`       | 5173 |
| `api.zoltar.local`      | `zoltar-be`       | 3000 |
| `playtest.zoltar.local` | `zoltar-playtest` | 5174 |

All traffic is HTTPS using mkcert-issued certificates.

### 5.2 Developer Prerequisites (document in README.md)

Each developer must complete this once per machine:

```sh
# Install mkcert
brew install mkcert        # macOS
# or: sudo apt install mkcert  (Ubuntu)

# Trust the local CA
mkcert -install

# Generate the wildcard cert for local dev
# Run from repo root — cert files are gitignored
mkcert -cert-file infra/traefik/certs/local.crt \
       -key-file  infra/traefik/certs/local.key \
       "*.zoltar.local" zoltar.local

# Add /etc/hosts entries
echo "127.0.0.1 app.zoltar.local api.zoltar.local playtest.zoltar.local" \
  | sudo tee -a /etc/hosts
```

The `infra/traefik/certs/` directory is gitignored. Certs must be generated locally on each dev machine — they are not committed.

### 5.3 Traefik Static Config

Create `infra/traefik/traefik.yml`:

```yaml
api:
  dashboard: true
  insecure: true    # dashboard available at https://api.zoltar.local:8080; disable in prod

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

HTTP (port 80) redirects to HTTPS automatically.

### 5.4 `docker-compose.yml` additions

```yaml
traefik:
  image: traefik:v3.0
  ports:
    - "80:80"
    - "443:443"
    - "8080:8080"     # dashboard
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
    - "1025:1025"     # SMTP (internal Docker network only)
    - "8025:8025"     # Web UI: http://localhost:8025
```

Add Traefik labels to `backend` and `frontend` compose services:

```yaml
# backend
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.backend.rule=Host(`api.zoltar.local`)"
  - "traefik.http.routers.backend.entrypoints=websecure"
  - "traefik.http.routers.backend.tls=true"
  - "traefik.http.services.backend.loadbalancer.server.port=3000"

# frontend
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
# Auth.js
AUTH_SECRET=                          # generate: openssl rand -base64 32
AUTH_URL=https://app.zoltar.local
AUTH_EMAIL_FROM=noreply@zoltar.local

# SMTP (MailHog in local dev)
SMTP_HOST=mailhog
SMTP_PORT=1025

# Internal API URL (Docker network — used by SvelteKit server-side)
INTERNAL_API_URL=http://backend:3000

# Public base URLs (through Traefik — used in browser)
PUBLIC_APP_URL=https://app.zoltar.local
PUBLIC_API_URL=https://api.zoltar.local
```

Update `environments.md` "Local Dev Reverse Proxy" section from "Deferred" to "Implemented in M2" and document the mkcert setup procedure.

---

## Part 6: Mothership Zod Schemas

Create `packages/game-systems/` (`@uv/game-systems`).

### 6.1 Package setup

```json
{
  "name": "@uv/game-systems",
  "version": "0.0.1",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

Both `apps/zoltar-fe` and `apps/zoltar-be` declare it as a workspace dependency.

### 6.2 Shared primitive schemas

`packages/game-systems/src/shared.ts`:

```typescript
import { z } from 'zod';

export const ResourcePoolSchema = z.object({
  current: z.number().int(),
  max:     z.number().int().nullable(),
});

export const EntityStatusSchema = z.enum(['alive', 'dead', 'unknown']);

export const EntitySchema = z.object({
  visible:  z.boolean(),
  status:   EntityStatusSchema.default('unknown'),
  npcState: z.string().optional(),
  // npcState: update whenever NPC disposition or knowledge changes.
  // e.g. "Hostile — witnessed player kill the guard" or "Frightened — cornered, low ammo"
});

export const FlagSchema = z.object({
  value:   z.boolean(),
  trigger: z.string(),
  // trigger: in-fiction condition that flips this flag.
  // Set at initialization; does not change. Carried as delta in stateChanges.flagTriggers.
});

export const ScenarioStateEntrySchema = z.object({
  current: z.number().int(),
  max:     z.number().int().nullable(),
  note:    z.string().default(''),
  // Use for non-entity numeric state: oxygen levels, power grid status, countdown timers, etc.
});
```

### 6.3 Mothership Campaign State Schema

`packages/game-systems/src/mothership/campaign-state.schema.ts`:

```typescript
import { z } from 'zod';
import {
  ResourcePoolSchema,
  EntitySchema,
  FlagSchema,
  ScenarioStateEntrySchema,
} from '../shared';

export const MothershipCampaignStateSchema = z.object({
  schemaVersion: z.literal(1),

  // Flat map keyed as {entity_id}_{pool_name}: dr_chen_hp, vasquez_stress.
  // HP and all numeric resources live here — not on the entity record.
  resourcePools: z.record(z.string(), ResourcePoolSchema).default({}),

  // Entity visibility, status, and narrative NPC state.
  // Positions are NOT stored here — they live in grid_entities.
  entities: z.record(z.string(), EntitySchema).default({}),

  // Flags with their flip conditions bundled together.
  // { adventure_complete: { value: false, trigger: "Player reaches escape pod" } }
  // stateChanges.flagTriggers only carries { flagName: newValue } — trigger is immutable.
  flags: z.record(z.string(), FlagSchema).default({}),

  // Non-entity numeric state: oxygen, reactor power, countdown timers, etc.
  scenarioState: z.record(z.string(), ScenarioStateEntrySchema).default({}),

  // Environmental scratchpad. First-mention details Claude generates on the fly
  // that must be consistent across turns: specific console display text, graffiti content, etc.
  worldFacts: z.record(z.string(), z.string()).default({}),
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

### 6.4 Mothership Character Sheet Schema

`packages/game-systems/src/mothership/character-sheet.schema.ts`:

```typescript
import { z } from 'zod';

export const MothershipClassEnum = z.enum([
  'teamster', 'scientist', 'android', 'marine',
]);

export const MothershipCharacterSheetSchema = z.object({
  name:      z.string().min(1).max(100),
  pronouns:  z.string().max(50).optional(),
  class:     MothershipClassEnum,
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

### 6.5 Index export

`packages/game-systems/src/index.ts`:

```typescript
export * from './shared';
export * from './mothership/campaign-state.schema';
export * from './mothership/character-sheet.schema';
```

---

## Part 7: Backend — CRUD Endpoints

### 7.1 Shared Patterns

- `app.setGlobalPrefix('api/v1')` in `main.ts`.
- All controllers: `@UseGuards(SessionGuard)` at class level.
- **Membership check:** `CampaignService.assertMember(campaignId, userId)` — throws `ForbiddenException` if no `campaign_member` row. Used by both `CampaignController` and `AdventureController`.
- **Owner check:** `CampaignService.assertOwner(campaignId, userId)` — used for owner-only write operations (not needed in M2 endpoints but scaffold now for M3+).
- Validation: use a `ZodValidationPipe` (install `nestjs-zod` or write a minimal custom pipe).
- Error responses: NestJS built-in exceptions (`NotFoundException`, `ForbiddenException`, `UnauthorizedException`).

### 7.2 `CampaignModule`

```
apps/zoltar-be/src/campaign/
  campaign.module.ts
  campaign.controller.ts
  campaign.service.ts
  dto/
    create-campaign.dto.ts
```

**`POST /campaigns`** — create a campaign. Authenticated. Also creates `campaign_member` row with `role: 'owner'` and initializes `campaign_state` with `emptyMothershipState()` (Mothership only in Phase 1; system is hardcoded).

Request DTO:
```typescript
const CreateCampaignSchema = z.object({
  name:       z.string().min(1).max(120),
  visibility: z.enum(['private', 'invite', 'org']).default('private'),
  diceMode:   z.enum(['soft_accountability', 'commitment']).default('soft_accountability'),
});
```

Response `201`:
```json
{
  "id": "uuid",
  "name": "The Persephone Incident",
  "system": "mothership",
  "visibility": "private",
  "diceMode": "soft_accountability",
  "createdAt": "2026-03-01T00:00:00Z"
}
```

**`GET /campaigns`** — list campaigns the authenticated user is a member of. No pagination in M2.

**`GET /campaigns/:campaignId`** — membership check, return campaign. `403` if not a member. `404` if not found.

### 7.3 `AdventureModule`

```
apps/zoltar-be/src/adventure/
  adventure.module.ts
  adventure.controller.ts
  adventure.service.ts
  dto/
    create-adventure.dto.ts
```

**`POST /campaigns/:campaignId/adventures`** — membership check. Creates adventure row with `status: 'synthesizing'` and `caller_id` set to the authenticated user. Does **not** trigger synthesis (M4). Returns `202`.

Request DTO:
```typescript
const CreateAdventureSchema = z.object({
  // Oracle selections accepted but ignored in M2 — synthesis pipeline is M4.
  oracleSelections: z.record(z.string(), z.array(z.string())).optional(),
  ranges:           z.record(z.string(), z.number().int()).optional(),
});
```

Response `202`:
```json
{
  "id": "uuid",
  "campaignId": "uuid",
  "status": "synthesizing",
  "createdAt": "2026-03-01T00:00:00Z"
}
```

**`GET /campaigns/:campaignId/adventures`** — membership check. List adventures, most recent first. No pagination in M2.

Adventure object: `id`, `campaignId`, `status` (from the explicit column — no inference), `adventureMode`, `callerId`, `createdAt`, `completedAt`.

**`GET /campaigns/:campaignId/adventures/:adventureId`** — membership check.

---

## Part 8: Frontend

`apps/zoltar-fe` — minimal but real. Function over form in M2; a design pass is deferred to M8.

### 8.1 Route Structure

```
src/routes/
  +layout.server.ts       ← session guard; redirects unauthenticated to /signin
  +layout.svelte          ← nav with sign-out button
  signin/
    +layout.server.ts     ← allow-list: no session required here
    +page.svelte          ← email input; calls signIn()
  campaigns/
    +page.server.ts       ← GET /api/v1/campaigns
    +page.svelte          ← campaign list + "New Campaign" modal
  campaigns/[id]/
    +page.server.ts       ← GET campaign + adventures
    +page.svelte          ← adventure list shell
```

### 8.2 Auth Layout Guard

`src/routes/+layout.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';

export const load = async ({ locals, url }) => {
  const session = await locals.auth();
  if (!session && !url.pathname.startsWith('/signin')) {
    redirect(303, '/signin');
  }
  return { session };
};
```

### 8.3 Sign-In Page

Simple email form. On submit: `signIn('email', { email, redirectTo: '/campaigns' })`. Include a note directing developers to MailHog at `http://localhost:8025` for the magic link.

### 8.4 Campaign List Page

Server-side load: fetch `https://api.zoltar.local/api/v1/campaigns` (using SvelteKit `fetch`, session cookie forwarded automatically). Render campaign cards linking to `/campaigns/[id]`.

"New Campaign" opens a modal with a `name` field. On submit: `POST /api/v1/campaigns` with defaults for `visibility` and `diceMode`, then navigate to the new campaign.

### 8.5 Adventure List Shell

Shows campaign name and a list of adventures with `status` badges (`synthesizing`, `ready`, `completed`, `failed`). Adventure rows are not clickable yet. "New Adventure" button is present but disabled with a tooltip: "Oracle table selection coming soon."

---

## Part 9: Documentation Updates

The following documents must be updated as part of M2. CC should make these changes alongside the code.

### 9.1 `docs/environments.md`

Replace the "Local Dev Reverse Proxy (Deferred)" section with an "Implemented" version documenting the mkcert setup procedure and the routing table.

### 9.2 `docs/decisions.md`

Add the four entries from the M2 decisions addendum (provided separately as `m2-decisions-addendum.md`).

### 9.3 `docs/zoltar-design-doc.md`

Apply the targeted patches from `m2-design-doc-patches.md` (provided separately). Key sections affected: Service Interfaces, Database Schema (adventures table + Mothership state schema), `submit_gm_context` tool schema, `submit_gm_response` flags field.

---

## Verification Checklist

M2 is done when all of the following pass:

1. **V9 migration applied** — `docker compose logs flyway` shows `Successfully applied 9 migrations`. `SELECT status FROM adventure LIMIT 1;` returns a valid enum value.
2. **`@uv/service-interfaces` builds** — `tsc --noEmit` in `packages/service-interfaces` passes. `apps/zoltar-be` imports from the package without error.
3. **`@uv/auth-core` TODO resolved** — `packages/auth-core/src/index.ts` exports the real `AuthService` abstract class with no TODO comment.
4. **Traefik routes** — `curl -k https://api.zoltar.local/health` returns `{"status":"ok"}`. `curl -k https://app.zoltar.local/` returns SvelteKit HTML.
5. **MailHog running** — `http://localhost:8025` opens the MailHog web UI.
6. **Sign-in flow** — navigate to `https://app.zoltar.local`, redirected to `/signin`, submit email, magic link appears in MailHog, clicking it signs in and lands on `/campaigns`.
7. **Email routing** — magic link email is delivered via SmtpEmailService → MailHog (not a built-in Auth.js provider). Verify by checking MailHog received the email while `SMTP_HOST=mailhog` is set.
8. **Send-verification endpoint is internal-only** — `curl -k https://api.zoltar.local/api/v1/auth/send-verification` returns 404 (Traefik does not expose this route; it is only reachable at `http://backend:3000` from the Docker internal network).
9. **Campaign CRUD** — create a campaign, list it, fetch it by ID. `403` for campaigns you're not a member of.
10. **Adventure CRUD** — create an adventure (status = `synthesizing`), list it, fetch it.
11. **Session persistence** — refreshing stays signed in. Sign out returns to `/signin`.
12. **Auth guard** — `curl -k https://api.zoltar.local/api/v1/campaigns` without a session cookie returns `401`.
13. **Membership isolation** — create two accounts via MailHog. Campaign created by user A is not visible to user B.
14. **Zod schemas** — `tsc --noEmit` in `packages/game-systems` passes. `MothershipCampaignStateSchema.parse(emptyMothershipState())` succeeds. `MothershipCharacterSheetSchema` imports cleanly in both `zoltar-fe` and `zoltar-be`.
15. **`tsc --noEmit`** (backend and frontend) — no type errors.
16. **Documentation updated** — `environments.md` Traefik section updated, `decisions.md` new entries added, design doc patches applied.

---

## Out of Scope for M2

- Oracle table selection UI or endpoint processing (M3)
- Character sheet creation UI (M3)
- GM context synthesis (M4)
- Play view / action submission (M6)
- Canon review (M6)
- Production Dockerfile stage (M6)
- SSL on the Droplet (deferred — Traefik TLS config for production is M8 scope)
- Campaign invite flows (no UX needed until multiplayer milestone)
- Any game logic, state validation beyond schema parse, or rule evaluation
