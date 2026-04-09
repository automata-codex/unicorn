# Database Schema

This document defines the Zoltar database schema for Phase 1. It serves as the source of truth for both Flyway migration SQL and the Drizzle TypeScript schema definition. When a Flyway migration is written, the Drizzle schema must be updated to match.

---

## Decisions

**Primary keys:** UUID (`gen_random_uuid()`), not serial integers. Better for future distributed deployments and avoids leaking row counts.

**Timestamps:** `timestamptz` (timestamp with time zone), always UTC. Not `timestamp`.

**System identifier:** `game_system` is a proper relational table with a `slug` column (`'mothership'`, `'uvg'`, etc.). `campaign.system_id` is a UUID FK to `game_system.id`. The slug is what the application-layer Zod schema map keys off of — it is the identifier that appears in code, not the UUID. New game systems are added by inserting a row and writing a Zod schema, not by altering a column or enum. `campaign_state.system` and `character_sheet.system` retain their text slug columns for now — converting them to FKs is a follow-up once `game_system` is settled.

**User identity:** Auth.js manages its own tables (`users`, `accounts`, `sessions`, `verification_tokens`). Columns that reference users use `text` to match Auth.js's string user IDs. The Auth.js Drizzle adapter is used so Auth.js tables are defined in the Drizzle schema and managed by Flyway alongside application tables.

**JSONB blobs:** Used for system-specific state (`campaign_state.data`, `character_sheets.data`, `gm_context.blob`) and flexible metadata (`grid_entities.tags`, `game_events.payload`, `pending_canon.entry`). Validated at the application layer with Zod — the database does not enforce blob shape.

**`org_id`:** Present but nullable on `campaigns`. Null in self-hosted deployments (single implicit tenant). Populated in SaaS deployments and enforced via Row Level Security. RLS policies are not defined in this schema — they are applied by the SaaS deployment layer only.

**Dice mode:** Set per campaign at creation. Two values: `soft_accountability` (player enters result, logged) and `commitment` (result committed before target revealed).

**Adventures, not sessions:** Adventures are the first-class domain concept. Sessions in the traditional VTT sense do not exist — solo async play has no meaningful session boundary. Messages and game events reference `adventure_id`. A campaign may have multiple adventures over its lifetime; each adventure owns its own GM context.

**Embedding dimension:** `rules_chunk.embedding` is declared `vector(1024)`, matching Voyage AI (`voyage-3` / `voyage-3-lite`). This dimension is fixed at the column level — switching embedding models requires re-ingestion and a migration. The `embedding_dim` column on `game_system` documents which dimension was used at ingestion time and must match the column declaration.

---

## Migration File Structure

Flyway migrations live in `infra/db/migrations/`. Naming convention: `V{version}__{description}.sql`.

```
infra/
  db/
    migrations/
      V1__auth_tables.sql
      V2__core_tables.sql       -- includes game_system; campaign.system_id is a FK from the start
      V3__grid_tables.sql
      V4__game_events.sql
      V5__map_geometry_stub.sql
      V6__pending_canon.sql
      V7__rules_index.sql
```

The Drizzle schema definition lives in `apps/zoltar-be/src/db/schema.ts`.

---

## Tables

### Auth.js Tables (`V1__auth_tables.sql`)

Auth.js manages these via its Drizzle adapter. Defined here for completeness — do not modify the shape without checking Auth.js adapter compatibility.

```sql
CREATE TABLE "user" (
  id             text PRIMARY KEY,
  name           text,
  email          text UNIQUE,
  email_verified timestamptz,
  image          text
);

CREATE TABLE account (
  user_id             text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type                text NOT NULL,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token       text,
  access_token        text,
  expires_at          integer,
  token_type          text,
  scope               text,
  id_token            text,
  session_state       text,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE session (
  session_token text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires       timestamptz NOT NULL
);

CREATE TABLE verification_token (
  identifier text NOT NULL,
  token      text NOT NULL,
  expires    timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);
```

---

### Core Tables (`V2__core_tables.sql`)

`game_system` is defined first in this migration so `campaign.system_id` can reference it.

```sql
CREATE TYPE campaign_visibility AS ENUM ('private', 'invite', 'org');
CREATE TYPE dice_mode AS ENUM ('soft_accountability', 'commitment');
CREATE TYPE campaign_member_role AS ENUM ('owner', 'player');
CREATE TYPE adventure_mode AS ENUM ('freeform', 'initiative');
CREATE TYPE message_role AS ENUM ('player', 'gm', 'system');
CREATE TYPE index_source AS ENUM ('user_provided', 'srd');

CREATE TABLE game_system (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        NOT NULL UNIQUE,  -- 'mothership' | 'uvg' | 'fived' | 'ose' | etc.
  name          text        NOT NULL,          -- display name: 'Mothership', 'D&D 5e'
  index_source  index_source NOT NULL,         -- how the rules index is built
  embedding_dim integer     NOT NULL DEFAULT 1024,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign (
  id          uuid                NOT NULL DEFAULT gen_random_uuid(),
  org_id      uuid,                           -- nullable; null in self-hosted
  system_id   uuid                NOT NULL REFERENCES game_system(id),
  name        text                NOT NULL,
  visibility  campaign_visibility NOT NULL DEFAULT 'private',
  dice_mode   dice_mode           NOT NULL DEFAULT 'soft_accountability',
  created_at  timestamptz         NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE adventure (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid           NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  mode             adventure_mode NOT NULL DEFAULT 'freeform',
  caller_id        text           REFERENCES "user"(id) ON DELETE SET NULL,
  initiative_order text[],                    -- ordered array of entity identifiers; null when freeform
  rolling_summary  text,                      -- compressed history of messages outside the context window
  created_at       timestamptz    NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

CREATE TABLE gm_context (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id uuid        NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  blob         jsonb       NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (adventure_id)
);

CREATE TABLE campaign_state (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid        NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  system         text        NOT NULL,  -- slug; denormalized for now
  schema_version integer     NOT NULL DEFAULT 1,
  data           jsonb       NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);

CREATE TABLE campaign_member (
  campaign_id uuid                 NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  user_id     text                 NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role        campaign_member_role NOT NULL DEFAULT 'player',
  joined_at   timestamptz          NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE character_sheet (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid        NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  user_id        text        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  system         text        NOT NULL,  -- slug; denormalized for now
  schema_version integer     NOT NULL DEFAULT 1,
  data           jsonb       NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);

CREATE TABLE message (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id uuid         NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  role         message_role NOT NULL,
  content      text         NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now()
);
```

---

### Grid Tables (`V3__grid_tables.sql`)

```sql
CREATE TYPE terrain_type AS ENUM (
  'open',
  'full_blocker',        -- columns, walls, closed doors
  'partial_blocker',     -- low walls, crates: block LOS standing, not prone
  'transparent_blocker', -- iron bars: block movement, not LOS
  'difficult'            -- movement cost modifier
);

CREATE TABLE grid_cell (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid         NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  x               integer      NOT NULL,
  y               integer      NOT NULL,
  z               integer      NOT NULL DEFAULT 0,
  terrain_type    terrain_type NOT NULL DEFAULT 'open',
  blocks_los      boolean      NOT NULL DEFAULT false,
  blocks_movement boolean      NOT NULL DEFAULT false,
  climbable       boolean      NOT NULL DEFAULT false,
  elevation       integer      NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, x, y, z)
);

CREATE TABLE grid_entity (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid    NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  entity_ref  text    NOT NULL,  -- references a character, NPC, or terrain feature by identifier
  x           integer NOT NULL,
  y           integer NOT NULL,
  z           integer NOT NULL DEFAULT 0,
  visible     boolean NOT NULL DEFAULT true,  -- visible to player party
  tags        jsonb   NOT NULL DEFAULT '[]',
  UNIQUE (campaign_id, entity_ref)
);
```

---

### Game Events (`V4__game_events.sql`)

```sql
CREATE TYPE event_type AS ENUM (
  'player_action',
  'gm_response',
  'dice_roll',
  'state_update',
  'correction'
);

CREATE TYPE actor_type AS ENUM ('player', 'system', 'gm');

CREATE TYPE roll_source AS ENUM ('system_generated', 'player_entered');

CREATE TABLE game_event (
  id               uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid       NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  adventure_id     uuid       NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  sequence_number  integer    NOT NULL,
  event_type       event_type NOT NULL,
  actor_type       actor_type NOT NULL,
  actor_id         text,                   -- user_id for player events, null for system/gm
  roll_source      roll_source,            -- populated for dice_roll events only
  payload          jsonb      NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  superseded_by    uuid REFERENCES game_event(id),  -- null unless this event has been corrected
  UNIQUE (adventure_id, sequence_number)
);

CREATE INDEX game_event_campaign_idx ON game_event (campaign_id);
CREATE INDEX game_event_adventure_idx ON game_event (adventure_id);
```

---

### Map Geometry Stub (`V5__map_geometry_stub.sql`)

Reserved for Phase 3. Not implemented — table exists to avoid a painful retrofit when sub-cell geometry is added.

```sql
CREATE TYPE geometry_type AS ENUM ('wall', 'door', 'point_feature');

CREATE TABLE map_geometry (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid          NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  type            geometry_type NOT NULL,
  shape           jsonb         NOT NULL,  -- GeoJSON or simple coordinate array
  blocks_los      boolean       NOT NULL DEFAULT false,
  blocks_movement boolean       NOT NULL DEFAULT false
);
```

---

### Pending Canon (`V6__pending_canon.sql`)

The canon review queue. Claude proposes canon entries via `proposed_canon` in `submit_gm_response`; the backend routes them here. In Solo Blind mode they are auto-promoted immediately. In other modes (Phase 2) a human reviewer promotes or discards them.

```sql
CREATE TYPE canon_status AS ENUM ('pending', 'promoted', 'discarded');

CREATE TABLE pending_canon (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id uuid         NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  summary      text         NOT NULL,       -- one or two sentence description of the improvisation
  context      text         NOT NULL,       -- why it came up — what player action or fiction prompted it
  status       canon_status NOT NULL DEFAULT 'pending',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  reviewed_at  timestamptz                  -- null until promoted or discarded
);

CREATE INDEX pending_canon_adventure_idx ON pending_canon (adventure_id);
CREATE INDEX pending_canon_status_idx ON pending_canon (adventure_id, status);
```

---

### Rules Index (`V7__rules_index.sql`)

Backing store for the `rules_lookup` tool. `game_system` rows are seeded in this migration for Phase 1 systems. `rules_chunk` rows are populated by the offline ingestion pipeline — not by the application at runtime.

The `pgvector` extension must be enabled before this migration runs. Add to the Flyway baseline or Docker Compose init script if not already present:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

```sql
-- Seed Phase 1 game systems.
-- Additional systems are inserted here as phases progress — no migration required per system.
INSERT INTO game_system (slug, name, index_source, embedding_dim) VALUES
  ('mothership', 'Mothership', 'user_provided', 1024);

CREATE TABLE rules_chunk (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id    uuid        NOT NULL REFERENCES game_system(id) ON DELETE CASCADE,
  source       text        NOT NULL,   -- e.g. 'Mothership Player''s Survival Guide p.34'
  section_path text[]      NOT NULL,   -- e.g. '{Combat,"Panic Checks"}'
  content      text        NOT NULL,
  embedding    vector(1024),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rules_chunk_system_idx ON rules_chunk (system_id);
CREATE INDEX rules_chunk_embedding_idx ON rules_chunk
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**Index tuning note:** `lists = 100` is appropriate for tens of thousands of chunks. The ivfflat index trades recall for speed — if retrieval quality degrades as the corpus grows, increase `lists` or migrate to hnsw (`USING hnsw (embedding vector_cosine_ops)`). HNSW has better recall at higher memory cost; revisit at scale.

**Embedding dimension:** `vector(1024)` matches `voyage-3` and `voyage-3-lite`. Switching models requires dropping and recreating the column and re-running the ingestion pipeline. Document the model used at ingestion time in `game_system.embedding_dim`.

---

### Adventure Telemetry (`V8__adventure_telemetry.sql`)

Infrastructure-level diagnostic telemetry. One row per GM turn. Append-only — rows are never updated or deleted. Distinct from the player-facing session export format (messages, canon, final state), which is a separate future feature.

```sql
CREATE TABLE adventure_telemetry (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id     uuid        NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  sequence_number  integer     NOT NULL,    -- matches game_events.sequence_number for the gm_response event
  payload          jsonb       NOT NULL,    -- player input, full submit_gm_response output,
                                            -- all roll_dice calls (notation, purpose, results),
                                            -- prompt_tokens, completion_tokens
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (adventure_id, sequence_number)
);

CREATE INDEX adventure_telemetry_adventure_idx ON adventure_telemetry (adventure_id);
```

---

## Drizzle Schema

`apps/zoltar-be/src/db/schema.ts`

This file is the Drizzle source of truth for TypeScript types. It must be kept in sync with Flyway migrations manually — when a migration is written, update this file to match.

```typescript
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  vector,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const campaignVisibilityEnum = pgEnum('campaign_visibility', [
  'private',
  'invite',
  'org',
]);

export const diceModeEnum = pgEnum('dice_mode', [
  'soft_accountability',
  'commitment',
]);

export const campaignMemberRoleEnum = pgEnum('campaign_member_role', [
  'owner',
  'player',
]);

export const adventureModeEnum = pgEnum('adventure_mode', [
  'freeform',
  'initiative',
]);

export const messageRoleEnum = pgEnum('message_role', [
  'player',
  'gm',
  'system',
]);

export const terrainTypeEnum = pgEnum('terrain_type', [
  'open',
  'full_blocker',
  'partial_blocker',
  'transparent_blocker',
  'difficult',
]);

export const eventTypeEnum = pgEnum('event_type', [
  'player_action',
  'gm_response',
  'dice_roll',
  'state_update',
  'correction',
]);

export const actorTypeEnum = pgEnum('actor_type', [
  'player',
  'system',
  'gm',
]);

export const rollSourceEnum = pgEnum('roll_source', [
  'system_generated',
  'player_entered',
]);

export const geometryTypeEnum = pgEnum('geometry_type', [
  'wall',
  'door',
  'point_feature',
]);

export const canonStatusEnum = pgEnum('canon_status', [
  'pending',
  'promoted',
  'discarded',
]);

export const indexSourceEnum = pgEnum('index_source', [
  'user_provided',
  'srd',
]);

// ---------------------------------------------------------------------------
// Auth.js Tables
// ---------------------------------------------------------------------------

export const users = pgTable('user', {
  id:            text('id').primaryKey(),
  name:          text('name'),
  email:         text('email').unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image:         text('image'),
});

export const accounts = pgTable('account', {
  userId:            text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type:              text('type').notNull(),
  provider:          text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refreshToken:      text('refresh_token'),
  accessToken:       text('access_token'),
  expiresAt:         integer('expires_at'),
  tokenType:         text('token_type'),
  scope:             text('scope'),
  idToken:           text('id_token'),
  sessionState:      text('session_state'),
}, (table) => [
  primaryKey({ columns: [table.provider, table.providerAccountId] }),
]);

export const authSessions = pgTable('session', {
  sessionToken: text('session_token').primaryKey(),
  userId:       text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires:      timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable('verification_token', {
  identifier: text('identifier').notNull(),
  token:      text('token').notNull(),
  expires:    timestamp('expires', { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.identifier, table.token] }),
]);

// ---------------------------------------------------------------------------
// Game Systems
// ---------------------------------------------------------------------------

export const gameSystems = pgTable('game_system', {
  id:           uuid('id').primaryKey().defaultRandom(),
  slug:         text('slug').notNull().unique(),
  name:         text('name').notNull(),
  indexSource:  indexSourceEnum('index_source').notNull(),
  embeddingDim: integer('embedding_dim').notNull().default(1024),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Core Tables
// ---------------------------------------------------------------------------

export const campaigns = pgTable('campaign', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id'),
  systemId:   uuid('system_id').notNull().references(() => gameSystems.id),
  name:       text('name').notNull(),
  visibility: campaignVisibilityEnum('visibility').notNull().default('private'),
  diceMode:   diceModeEnum('dice_mode').notNull().default('soft_accountability'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adventures = pgTable('adventure', {
  id:              uuid('id').primaryKey().defaultRandom(),
  campaignId:      uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  mode:            adventureModeEnum('mode').notNull().default('freeform'),
  callerId:        text('caller_id').references(() => users.id, { onDelete: 'set null' }),
  initiativeOrder: text('initiative_order').array(),
  rollingSummary:  text('rolling_summary'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:     timestamp('completed_at', { withTimezone: true }),
});

export const gmContexts = pgTable('gm_context', {
  id:          uuid('id').primaryKey().defaultRandom(),
  adventureId: uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  blob:        jsonb('blob').notNull().default({}),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaignStates = pgTable('campaign_state', {
  id:            uuid('id').primaryKey().defaultRandom(),
  campaignId:    uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  system:        text('system').notNull(),  // slug; denormalized for now
  schemaVersion: integer('schema_version').notNull().default(1),
  data:          jsonb('data').notNull().default({}),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaignMembers = pgTable('campaign_member', {
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  userId:     text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:       campaignMemberRoleEnum('role').notNull().default('player'),
  joinedAt:   timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.campaignId, table.userId] }),
]);

export const characterSheets = pgTable('character_sheet', {
  id:            uuid('id').primaryKey().defaultRandom(),
  campaignId:    uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  userId:        text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  system:        text('system').notNull(),  // slug; denormalized for now
  schemaVersion: integer('schema_version').notNull().default(1),
  data:          jsonb('data').notNull().default({}),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('message', {
  id:          uuid('id').primaryKey().defaultRandom(),
  adventureId: uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  role:        messageRoleEnum('role').notNull(),
  content:     text('content').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Grid Tables
// ---------------------------------------------------------------------------

export const gridCells = pgTable('grid_cell', {
  id:             uuid('id').primaryKey().defaultRandom(),
  campaignId:     uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  x:              integer('x').notNull(),
  y:              integer('y').notNull(),
  z:              integer('z').notNull().default(0),
  terrainType:    terrainTypeEnum('terrain_type').notNull().default('open'),
  blocksLos:      boolean('blocks_los').notNull().default(false),
  blocksMovement: boolean('blocks_movement').notNull().default(false),
  climbable:      boolean('climbable').notNull().default(false),
  elevation:      integer('elevation').notNull().default(0),
});

export const gridEntities = pgTable('grid_entity', {
  id:         uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  entityRef:  text('entity_ref').notNull(),
  x:          integer('x').notNull(),
  y:          integer('y').notNull(),
  z:          integer('z').notNull().default(0),
  visible:    boolean('visible').notNull().default(true),
  tags:       jsonb('tags').notNull().default([]),
});

// ---------------------------------------------------------------------------
// Game Events
// ---------------------------------------------------------------------------

export const gameEvents = pgTable('game_event', {
  id:             uuid('id').primaryKey().defaultRandom(),
  campaignId:     uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  adventureId:    uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  sequenceNumber: integer('sequence_number').notNull(),
  eventType:      eventTypeEnum('event_type').notNull(),
  actorType:      actorTypeEnum('actor_type').notNull(),
  actorId:        text('actor_id'),
  rollSource:     rollSourceEnum('roll_source'),
  payload:        jsonb('payload').notNull().default({}),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  supersededBy:   uuid('superseded_by'),  // self-reference; set after insert; FK enforced in migration only
}, (table) => [
  uniqueIndex('game_event_adventure_seq_idx').on(table.adventureId, table.sequenceNumber),
  index('game_event_campaign_idx').on(table.campaignId),
  index('game_event_adventure_idx').on(table.adventureId),
]);

// ---------------------------------------------------------------------------
// Pending Canon
// ---------------------------------------------------------------------------

export const pendingCanon = pgTable('pending_canon', {
  id:          uuid('id').primaryKey().defaultRandom(),
  adventureId: uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  summary:     text('summary').notNull(),
  context:     text('context').notNull(),
  status:      canonStatusEnum('status').notNull().default('pending'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt:  timestamp('reviewed_at', { withTimezone: true }),
}, (table) => [
  index('pending_canon_adventure_idx').on(table.adventureId),
  index('pending_canon_status_idx').on(table.adventureId, table.status),
]);

// ---------------------------------------------------------------------------
// Map Geometry Stub (Phase 3)
// ---------------------------------------------------------------------------

export const mapGeometry = pgTable('map_geometry', {
  id:             uuid('id').primaryKey().defaultRandom(),
  campaignId:     uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  type:           geometryTypeEnum('type').notNull(),
  shape:          jsonb('shape').notNull(),
  blocksLos:      boolean('blocks_los').notNull().default(false),
  blocksMovement: boolean('blocks_movement').notNull().default(false),
});

// ---------------------------------------------------------------------------
// Rules Index
// ---------------------------------------------------------------------------

export const rulesChunks = pgTable('rules_chunk', {
  id:          uuid('id').primaryKey().defaultRandom(),
  systemId:    uuid('system_id').notNull().references(() => gameSystems.id, { onDelete: 'cascade' }),
  source:      text('source').notNull(),
  sectionPath: text('section_path').array().notNull(),
  content:     text('content').notNull(),
  embedding:   vector('embedding', { dimensions: 1024 }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('rules_chunk_system_idx').on(table.systemId),
]);

// ---------------------------------------------------------------------------
// Adventure Telemetry
// ---------------------------------------------------------------------------

export const adventureTelemetry = pgTable('adventure_telemetry', {
  id:             uuid('id').primaryKey().defaultRandom(),
  adventureId:    uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  sequenceNumber: integer('sequence_number').notNull(),
  payload:        jsonb('payload').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('adventure_telemetry_adventure_seq_idx').on(table.adventureId, table.sequenceNumber),
  index('adventure_telemetry_adventure_idx').on(table.adventureId),
]);

// ---------------------------------------------------------------------------
// Phase 2+
// ---------------------------------------------------------------------------

export const campaignCanon = pgTable('campaign_canon', {
  id:          uuid('id').primaryKey().defaultRandom(),
  campaignId:  uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  summary:     text('summary').notNull(),
  context:     text('context').notNull(),
  status:      canonStatusEnum('status').notNull().default('pending'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt:  timestamp('reviewed_at', { withTimezone: true }),
});
```

---

## Inferred Types

Drizzle infers insert and select types from the schema definition. Use these in service and repository layers rather than defining types manually.

```typescript
import { type InferSelectModel, type InferInsertModel } from 'drizzle-orm';
import * as schema from './schema';

export type GameSystem            = InferSelectModel<typeof schema.gameSystems>;
export type NewGameSystem         = InferInsertModel<typeof schema.gameSystems>;
export type Campaign              = InferSelectModel<typeof schema.campaigns>;
export type NewCampaign           = InferInsertModel<typeof schema.campaigns>;
export type Adventure             = InferSelectModel<typeof schema.adventures>;
export type NewAdventure          = InferInsertModel<typeof schema.adventures>;
export type GmContext             = InferSelectModel<typeof schema.gmContexts>;
export type NewGmContext          = InferInsertModel<typeof schema.gmContexts>;
export type Message               = InferSelectModel<typeof schema.messages>;
export type NewMessage            = InferInsertModel<typeof schema.messages>;
export type GameEvent             = InferSelectModel<typeof schema.gameEvents>;
export type NewGameEvent          = InferInsertModel<typeof schema.gameEvents>;
export type PendingCanon          = InferSelectModel<typeof schema.pendingCanon>;
export type NewPendingCanon       = InferInsertModel<typeof schema.pendingCanon>;
export type RulesChunk            = InferSelectModel<typeof schema.rulesChunks>;
export type NewRulesChunk         = InferInsertModel<typeof schema.rulesChunks>;
export type AdventureTelemetry    = InferSelectModel<typeof schema.adventureTelemetry>;
export type NewAdventureTelemetry = InferInsertModel<typeof schema.adventureTelemetry>;
// etc.

// ---------------------------------------------------------------------------
// Phase 2+
// ---------------------------------------------------------------------------

export type CampaignCanon    = InferSelectModel<typeof schema.campaignCanon>;
export type NewCampaignCanon = InferInsertModel<typeof schema.campaignCanon>;
// etc.
```

---

## Phase 2+ Additions

Tables and columns not yet defined, to be added as migrations when the relevant phase begins:

- **`campaign.creation_mode` column** — `'solo_blind' | 'solo_authored' | 'collaborative' | 'solo_with_overseer'`; canon review routing is mode-specific (Phase 2)
- **`campaign.overseer_id` column** — user designated as canon reviewer in Solo with Overseer mode (Phase 2)
- **`campaign_canon` table** — campaign-level narrative truth that persists across adventures. Mirrors the `pending_canon` lifecycle but scoped to the campaign rather than a single adventure. Populated by a second promotion step at adventure completion: facts with campaign-level significance are promoted from the adventure's GM context blob to `campaign_canon`. Feeds into synthesis for subsequent adventures alongside oracle results. Schema:
```sql
  CREATE TABLE campaign_canon (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  uuid         NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    summary      text         NOT NULL,
    context      text         NOT NULL,  -- which adventure it emerged from, and how
    status       canon_status NOT NULL DEFAULT 'pending',
    created_at   timestamptz  NOT NULL DEFAULT now(),
    reviewed_at  timestamptz
  );
```
Uses the existing `canon_status` enum (`pending`, `promoted`, `discarded`). The `context` field records which adventure the fact emerged from and the circumstances.
- **`campaign_state.system` and `character_sheet.system` → FK** — convert slug text columns to `system_id uuid` FKs to `game_system.id` for consistency with `campaign.system_id` (Phase 2, when OSE/UVG systems are added and the slug set stabilizes)
- **Rule system tables** — `rule_override`, `constraint_module`, `constraint_module_activation` (Phase 3)
- **`org` table** — billing unit for SaaS (Phase 3, SaaS layer only)
- **RLS policies** — applied to `campaign`, `campaign_member`, `character_sheet`, etc. on `org_id` (Phase 3, SaaS layer only)
- **`campaign_state.rules` column** — structured override JSON (Phase 2)
- **Asset tables** — token images, map backgrounds (Phase 3)
