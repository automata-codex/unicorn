/**
 * Integration test helper — manages a real Postgres connection for repository tests.
 *
 * Prerequisites:
 *   - The `db` Docker Compose service must be running.
 *   - The `zoltar_test` database is created automatically if missing.
 *   - Flyway migrations are applied via `docker compose run`.
 *
 * Usage:
 *   import { setupTestDb, getTestDb, teardownTestDb, truncateAll } from '../../test/db-test-helper';
 *   beforeAll(() => setupTestDb());
 *   afterAll(() => teardownTestDb());
 *   beforeEach(() => truncateAll());
 */

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, Client } from 'pg';
import { execSync } from 'child_process';
import * as schema from '../src/db/schema';

const TEST_DB = 'zoltar_test';
const BASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://zoltar:zoltar_dev@localhost:5432/zoltar';

// Derive connection strings
const baseUrlObj = new URL(BASE_URL);
const testUrl = `${baseUrlObj.protocol}//${baseUrlObj.username}:${baseUrlObj.password}@${baseUrlObj.host}/${TEST_DB}`;

let pool: Pool;
let db: NodePgDatabase<typeof schema>;

export async function setupTestDb(): Promise<void> {
  // Connect to the default database to create the test database
  const adminClient = new Client({ connectionString: BASE_URL });
  await adminClient.connect();

  const result = await adminClient.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [TEST_DB],
  );
  if (result.rows.length === 0) {
    await adminClient.query(`CREATE DATABASE ${TEST_DB}`);
  }
  await adminClient.end();

  // Run Flyway migrations against the test database.
  // Flyway runs inside Docker, so it connects to the `db` service hostname, not localhost.
  const flywayUrl = `jdbc:postgresql://db:5432/${TEST_DB}`;
  execSync(
    `docker compose run --rm -e FLYWAY_URL=${flywayUrl} flyway migrate`,
    { cwd: process.cwd().replace(/\/apps\/zoltar-be$/, ''), stdio: 'pipe' },
  );

  // Create the Drizzle connection
  pool = new Pool({ connectionString: testUrl });
  db = drizzle(pool, { schema });
}

export function getTestDb(): NodePgDatabase<typeof schema> {
  if (!db) throw new Error('Call setupTestDb() before getTestDb()');
  return db;
}

export async function teardownTestDb(): Promise<void> {
  if (pool) await pool.end();
}

// Tables in dependency order (children first) for safe truncation.
const TRUNCATE_TABLES = [
  'adventure_telemetry',
  'pending_canon',
  'game_event',
  'map_geometry',
  'grid_entity',
  'grid_cell',
  'message',
  'gm_context',
  'adventure',
  'character_sheet',
  'campaign_state',
  'campaign_member',
  'campaign',
  'rules_chunk',
  'game_system',
  'verification_token',
  'session',
  'account',
  '"user"',
];

export async function truncateAll(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${TRUNCATE_TABLES.join(', ')} CASCADE`));
}
