# Milestone M1 — Dev Environment & Data Model
## Implementation Spec for Claude Code

**Scope:** Infrastructure only — no game logic, no UI, no auth flow. This milestone establishes everything subsequent milestones depend on: a running local dev stack, the full Phase 1 database schema, the NestJS application skeleton with all deferred service stubs, and environment configuration.

**Done when:** `docker compose up` brings up a healthy stack; all Flyway migrations apply cleanly; the NestJS app starts and logs its module tree; a health check endpoint returns 200.

---

## Repository Layout

```
unicorn/
  apps/
    zoltar-be/          ← NestJS application (target of this milestone)
    zoltar-fe/          ← Svelte frontend (untouched in M1)
    zoltar-playtest/    ← Playtest SPA (untouched in M1)
  infra/
    db/
      migrations/       ← Flyway SQL migrations (created in M1)
  docker-compose.yml    ← Local dev stack (created in M1)
  package.json          ← npm workspaces root
```

---

## Part 1: Docker Compose (`docker-compose.yml`)

Create at repo root. Services:

### `db` — PostgreSQL
- Image: `pgvector/pgvector:pg16` (includes `pgvector` extension; do not use plain `postgres` image)
- Port: `5432:5432`
- Environment: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` sourced from `.env`
- Volume: named volume `pgdata` for persistence
- Healthcheck: `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}`

### `flyway` — Schema migrations
- Image: `flyway/flyway:10`
- Depends on `db` (with `service_healthy` condition)
- Volume mount: `./infra/db/migrations:/flyway/sql:ro`
- Command: `migrate`
- Environment: `FLYWAY_URL`, `FLYWAY_USER`, `FLYWAY_PASSWORD` sourced from `.env`
  - `FLYWAY_URL=jdbc:postgresql://db:5432/${POSTGRES_DB}`
- Restart policy: `on-failure` (Flyway is a one-shot process; it exits 0 on success)

### `backend` — NestJS
- Build context: `./apps/zoltar-be`
- Depends on `flyway` (with `service_completed_successfully` condition)
- Port: `3000:3000`
- Environment: all backend env vars sourced from `.env`
- Volume mount: `./apps/zoltar-be:/app` with `node_modules` anonymous volume exclusion (standard NestJS dev pattern)
- Command: `npm run start:dev`

### `frontend` — Svelte (placeholder only in M1)
- Build context: `./apps/zoltar-fe`
- Port: `5173:5173`
- Command: `npm run dev -- --host`
- No dependency on `backend` in M1

---

## Part 2: Database Migrations

All files live in `infra/db/migrations/`. Flyway naming convention: `V{N}__{description}.sql`. Migration content is defined exactly in `docs/schema.md` — reproduce it verbatim. Do not invent or modify column names, types, constraints, or indexes.

### V1__auth_tables.sql
Auth.js tables. Do not modify shape — Auth.js adapter compatibility depends on exact column names.

Tables: `"user"`, `account`, `session`, `verification_token`.

See `docs/schema.md` § Auth.js Tables for the exact DDL.

### V2__core_tables.sql
Enums first, then tables in FK dependency order.

Enums: `campaign_visibility`, `dice_mode`, `campaign_member_role`, `adventure_mode`, `message_role`, `index_source`.

Tables (in order): `game_system`, `campaign`, `adventure`, `gm_context`, `campaign_state`, `campaign_member`, `character_sheet`, `message`.

See `docs/schema.md` § Core Tables for the exact DDL.

### V3__grid_tables.sql
Enums: `terrain_type`.

Tables: `grid_cell`, `grid_entity`.

See `docs/schema.md` § Grid Tables for the exact DDL.

### V4__game_events.sql
Enums: `event_type`, `actor_type`, `roll_source`.

Table: `game_event` (with composite unique constraint on `(adventure_id, sequence_number)` and two indexes).

See `docs/schema.md` § Game Events for the exact DDL.

### V5__map_geometry_stub.sql
Reserved for Phase 3. Create the table now to avoid a painful retrofit.

Enum: `geometry_type`.

Table: `map_geometry`.

See `docs/schema.md` § Map Geometry Stub for the exact DDL.

### V6__pending_canon.sql
Enum: `canon_status`.

Table: `pending_canon` (with two indexes).

See `docs/schema.md` § Pending Canon for the exact DDL.

### V7__rules_index.sql
**Important:** `pgvector` extension must exist before this migration. Add `CREATE EXTENSION IF NOT EXISTS vector;` at the top of this file.

Seed `game_system` table with the Mothership row:
```sql
INSERT INTO game_system (slug, name, index_source, embedding_dim) VALUES
  ('mothership', 'Mothership', 'user_provided', 1024);
```

Table: `rules_chunk` (with system index and ivfflat embedding index, `lists = 100`).

See `docs/schema.md` § Rules Index for the exact DDL including the index tuning note.

### V8__adventure_telemetry.sql
Table: `adventure_telemetry` (append-only, unique on `(adventure_id, sequence_number)`, one index).

See `docs/schema.md` § Adventure Telemetry for the exact DDL.

---

## Part 3: NestJS Application (`apps/zoltar-be/`)

### 3.1 Package Setup

`package.json` — standard NestJS 11 app. Key dependencies:

```json
{
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-fastify": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "drizzle-orm": "^0.38.0",
    "pg": "^8.13.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@types/pg": "^8.11.0",
    "typescript": "^5.7.0",
    "ts-node": "^10.9.0",
    "drizzle-kit": "^0.30.0"
  }
}
```

Use Fastify adapter (`@nestjs/platform-fastify`), not Express.

### 3.2 File Structure

```
apps/zoltar-be/
  src/
    main.ts
    app.module.ts
    db/
      db.module.ts
      schema.ts
      db.provider.ts
    config/
      config.module.ts
      env.schema.ts            ← Zod env validation
    health/
      health.module.ts
      health.controller.ts
    campaign/
      campaign.module.ts
    adventure/
      adventure.module.ts
    auth/
      auth.module.ts
    grid/
      grid.module.ts
    services/
      interfaces/
        entitlements.service.ts
        metering.service.ts
        email.service.ts
        asset-storage.service.ts
        realtime.service.ts
        feature-flag.service.ts
      noop/
        noop-entitlements.service.ts
        noop-metering.service.ts
        noop-email.service.ts
        noop-asset-storage.service.ts
        noop-realtime.service.ts
        noop-feature-flag.service.ts
  Dockerfile
  tsconfig.json
  nest-cli.json
```

### 3.3 Environment Config (`src/config/`)

`env.schema.ts` — define a Zod schema for all required env vars. Validate at startup; throw on missing or invalid values so misconfiguration fails loud and early.

Required vars:

| Var            | Type                                      | Notes                                 |
|----------------|-------------------------------------------|---------------------------------------|
| `DATABASE_URL` | string (url)                              | `postgresql://user:pass@host:5432/db` |
| `NODE_ENV`     | `'development' \| 'production' \| 'test'` |                                       |
| `PORT`         | number (default `3000`)                   |                                       |

`config.module.ts` — `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` where `validateEnv` parses with the Zod schema and throws `Error` on failure.

### 3.4 Database Module (`src/db/`)

`schema.ts` — the Drizzle schema. Reproduce the full schema from `docs/schema.md` § Drizzle Schema exactly. This is the TypeScript source of truth for inferred types. Import `vector` from `drizzle-orm/pg-core` — it requires `drizzle-orm@>=0.30` and the `pgvector/pgvector` Postgres image.

`db.provider.ts` — create the `node-postgres` pool and the Drizzle instance:

```typescript
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const DB_TOKEN = 'DB';

export const dbProvider = {
  provide: DB_TOKEN,
  useFactory: (configService: ConfigService) => {
    const pool = new Pool({ connectionString: configService.get('DATABASE_URL') });
    return drizzle(pool, { schema });
  },
  inject: [ConfigService],
};
```

`db.module.ts` — exports `dbProvider` as a global module so all feature modules can inject `DB_TOKEN` without re-importing `DbModule`.

### 3.5 Module Hierarchy (`src/app.module.ts`)

```typescript
@Module({
  imports: [
    ConfigModule,   // global
    DbModule,       // global
    HealthModule,
    CampaignModule,
    AdventureModule,
    AuthModule,
    GridModule,
  ],
})
export class AppModule {}
```

Feature modules (`CampaignModule`, `AdventureModule`, `AuthModule`, `GridModule`) are stubs in M1 — they exist with an empty `@Module({})` declaration and no controllers or providers yet. Their purpose is to establish the import graph that M2 will fill in.

### 3.6 Health Check (`src/health/`)

`health.controller.ts`:

```typescript
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

No database ping in M1 — that's acceptable. The Flyway service_completed_successfully dependency guarantees migrations ran before the backend starts, which is sufficient proof of DB connectivity for this milestone.

### 3.7 Deferred Service Interfaces and Noops

Each deferred service has two files: an abstract class (interface) and a noop implementation. The abstract class is what feature modules inject; the noop is what `AppModule` provides until the real implementation ships.

**Interfaces** (`src/services/interfaces/`):

```typescript
// entitlements.service.ts
export abstract class EntitlementsService {
  abstract canCreateAdventure(userId: string): Promise<boolean>;
}

// metering.service.ts
export abstract class MeteringService {
  abstract recordTokenUsage(adventureId: string, promptTokens: number, completionTokens: number): Promise<void>;
}

// email.service.ts
export abstract class EmailService {
  abstract sendTransactional(to: string, subject: string, body: string): Promise<void>;
}

// asset-storage.service.ts
export abstract class AssetStorageService {
  abstract upload(key: string, data: Buffer, contentType: string): Promise<string>;
  abstract getSignedUrl(key: string): Promise<string>;
}

// realtime.service.ts
export abstract class RealtimeService {
  abstract publish(channel: string, event: string, payload: unknown): Promise<void>;
}

// feature-flag.service.ts
export abstract class FeatureFlagService {
  abstract isEnabled(flag: string, context?: Record<string, unknown>): Promise<boolean>;
}
```

**Noop implementations** (`src/services/noop/`): each noop implements the abstract class, logs a warning at the `debug` level on first call (not on every call — use a `warned` flag), and returns a safe default (`true` for `canCreateAdventure`, `void` for fire-and-forget, `false` for `isEnabled`, etc.).

**Registration in `AppModule`**:

```typescript
providers: [
  { provide: EntitlementsService, useClass: NoopEntitlementsService },
  { provide: MeteringService,     useClass: NoopMeteringService },
  { provide: EmailService,        useClass: NoopEmailService },
  { provide: AssetStorageService, useClass: NoopAssetStorageService },
  { provide: RealtimeService,     useClass: NoopRealtimeService },
  { provide: FeatureFlagService,  useClass: NoopFeatureFlagService },
]
```

Export all six from `AppModule` so feature modules can inject them without re-declaring providers.

### 3.8 `main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
```

### 3.9 Dockerfile

Multi-stage build. Development stage only in M1 (production stage is M6 work):

```dockerfile
FROM node:22-alpine AS development
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "start:dev"]
```

---

## Part 4: Environment File

Create `.env.example` at repo root (committed). Create `.env` (gitignored, for local dev):

```env
# Postgres
POSTGRES_USER=zoltar
POSTGRES_PASSWORD=zoltar_dev
POSTGRES_DB=zoltar

# Flyway (constructed from above)
FLYWAY_URL=jdbc:postgresql://db:5432/zoltar
FLYWAY_USER=zoltar
FLYWAY_PASSWORD=zoltar_dev

# App
DATABASE_URL=postgresql://zoltar:zoltar_dev@db:5432/zoltar
NODE_ENV=development
PORT=3000
```

`.gitignore` — ensure `.env` is listed (not `.env.example`).

---

## Part 5: Drizzle Kit Config

`apps/zoltar-be/drizzle.config.ts` — for local schema introspection and diff tooling. Not used at runtime (Flyway owns migrations).

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',           // introspection output only; not used by Flyway
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## Verification Checklist

M1 is done when all of the following pass:

1. **`docker compose up --build`** — all four services start without error.
2. **Flyway exits 0** — `docker compose logs flyway` shows `Successfully applied 8 migrations`.
3. **Backend starts** — `docker compose logs backend` shows NestJS module tree and `Application is running on: http://0.0.0.0:3000`.
4. **Health endpoint** — `curl http://localhost:3000/health` returns `{"status":"ok"}`.
5. **Schema present** — `docker compose exec db psql -U zoltar -d zoltar -c '\dt'` lists all expected tables: `user`, `account`, `session`, `verification_token`, `game_system`, `campaign`, `adventure`, `gm_context`, `campaign_state`, `campaign_member`, `character_sheet`, `message`, `grid_cell`, `grid_entity`, `game_event`, `map_geometry`, `pending_canon`, `rules_chunk`, `adventure_telemetry`.
6. **Mothership seed** — `SELECT slug FROM game_system;` returns `mothership`.
7. **pgvector** — `SELECT typname FROM pg_type WHERE typname = 'vector';` returns one row.
8. **`npm run svelte-check`** (playtest app) — unaffected; still passes.
9. **`tsc --noEmit`** (backend) — no type errors.

---

## Out of Scope for M1

These are explicitly deferred to later milestones. Do not implement:

- Auth.js integration (M2)
- Any CRUD endpoints (M2)
- Mothership Zod schemas for campaign state / character sheet (M2)
- Oracle tables (M3)
- Any frontend work
- Traefik (M2)
- Production Dockerfile stage (M6)
- Rules ingestion pipeline (M4)
