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

export const adventureStatusEnum = pgEnum('adventure_status', [
  'synthesizing',
  'ready',
  'completed',
  'failed',
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

export const actorTypeEnum = pgEnum('actor_type', ['player', 'system', 'gm']);

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

export const indexSourceEnum = pgEnum('index_source', ['user_provided', 'srd']);

// ---------------------------------------------------------------------------
// Auth.js Tables
// ---------------------------------------------------------------------------

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const authSessions = pgTable('session', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

// ---------------------------------------------------------------------------
// Game Systems
// ---------------------------------------------------------------------------

export const gameSystems = pgTable('game_system', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  indexSource: indexSourceEnum('index_source').notNull(),
  embeddingDim: integer('embedding_dim').notNull().default(1024),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Core Tables
// ---------------------------------------------------------------------------

export const campaigns = pgTable('campaign', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id'),
  systemId: uuid('system_id')
    .notNull()
    .references(() => gameSystems.id),
  name: text('name').notNull(),
  visibility: campaignVisibilityEnum('visibility').notNull().default('private'),
  diceMode: diceModeEnum('dice_mode').notNull().default('soft_accountability'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adventures = pgTable('adventure', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  status: adventureStatusEnum('status').notNull().default('synthesizing'),
  mode: adventureModeEnum('mode').notNull().default('freeform'),
  callerId: text('caller_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  initiativeOrder: text('initiative_order').array(),
  rollingSummary: text('rolling_summary'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const gmContexts = pgTable('gm_context', {
  id: uuid('id').primaryKey().defaultRandom(),
  adventureId: uuid('adventure_id')
    .notNull()
    .references(() => adventures.id, { onDelete: 'cascade' }),
  blob: jsonb('blob').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const campaignStates = pgTable('campaign_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  system: text('system').notNull(), // slug; denormalized for now
  schemaVersion: integer('schema_version').notNull().default(1),
  data: jsonb('data').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const campaignMembers = pgTable(
  'campaign_member',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: campaignMemberRoleEnum('role').notNull().default('player'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.campaignId, table.userId] })],
);

export const characterSheets = pgTable('character_sheet', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  system: text('system').notNull(), // slug; denormalized for now
  schemaVersion: integer('schema_version').notNull().default(1),
  data: jsonb('data').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messages = pgTable('message', {
  id: uuid('id').primaryKey().defaultRandom(),
  adventureId: uuid('adventure_id')
    .notNull()
    .references(() => adventures.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Grid Tables
// ---------------------------------------------------------------------------

export const gridCells = pgTable('grid_cell', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  z: integer('z').notNull().default(0),
  terrainType: terrainTypeEnum('terrain_type').notNull().default('open'),
  blocksLos: boolean('blocks_los').notNull().default(false),
  blocksMovement: boolean('blocks_movement').notNull().default(false),
  climbable: boolean('climbable').notNull().default(false),
  elevation: integer('elevation').notNull().default(0),
});

export const gridEntities = pgTable('grid_entity', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  entityRef: text('entity_ref').notNull(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  z: integer('z').notNull().default(0),
  visible: boolean('visible').notNull().default(true),
  tags: jsonb('tags').notNull().default([]),
});

// ---------------------------------------------------------------------------
// Game Events
// ---------------------------------------------------------------------------

export const gameEvents = pgTable(
  'game_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    adventureId: uuid('adventure_id')
      .notNull()
      .references(() => adventures.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    eventType: eventTypeEnum('event_type').notNull(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id'),
    rollSource: rollSourceEnum('roll_source'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededBy: uuid('superseded_by'), // self-reference; set after insert; FK enforced in migration only
  },
  (table) => [
    uniqueIndex('game_event_adventure_seq_idx').on(
      table.adventureId,
      table.sequenceNumber,
    ),
    index('game_event_campaign_idx').on(table.campaignId),
    index('game_event_adventure_idx').on(table.adventureId),
  ],
);

// ---------------------------------------------------------------------------
// Pending Canon
// ---------------------------------------------------------------------------

export const pendingCanon = pgTable(
  'pending_canon',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adventureId: uuid('adventure_id')
      .notNull()
      .references(() => adventures.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    context: text('context').notNull(),
    status: canonStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    index('pending_canon_adventure_idx').on(table.adventureId),
    index('pending_canon_status_idx').on(table.adventureId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Map Geometry Stub (Phase 3)
// ---------------------------------------------------------------------------

export const mapGeometry = pgTable('map_geometry', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  type: geometryTypeEnum('type').notNull(),
  shape: jsonb('shape').notNull(),
  blocksLos: boolean('blocks_los').notNull().default(false),
  blocksMovement: boolean('blocks_movement').notNull().default(false),
});

// ---------------------------------------------------------------------------
// Rules Index
// ---------------------------------------------------------------------------

export const rulesChunks = pgTable(
  'rules_chunk',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    systemId: uuid('system_id')
      .notNull()
      .references(() => gameSystems.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sectionPath: text('section_path').array().notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('rules_chunk_system_idx').on(table.systemId)],
);

// ---------------------------------------------------------------------------
// Adventure Telemetry
// ---------------------------------------------------------------------------

export const adventureTelemetry = pgTable(
  'adventure_telemetry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adventureId: uuid('adventure_id')
      .notNull()
      .references(() => adventures.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('adventure_telemetry_adventure_seq_idx').on(
      table.adventureId,
      table.sequenceNumber,
    ),
    index('adventure_telemetry_adventure_idx').on(table.adventureId),
  ],
);
