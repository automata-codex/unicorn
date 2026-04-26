import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../test/db-test-helper';
import * as schema from '../src/db/schema';

import {
  buildAndRunLoad,
  parseSynthesisExport,
} from './load-synthesis.core';
import { buildSynthesisExport } from './save-synthesis.core';

// Fully separate from the source campaign's UUIDs so we can verify the
// loader truly mints new ones.
const SYSTEM_ID = '00000000-0000-0000-0000-000000000301';
const SOURCE_CAMPAIGN_ID = '00000000-0000-0000-0000-000000000302';
const SOURCE_ADVENTURE_ID = '00000000-0000-0000-0000-000000000303';
const USER_ID = 'roundtrip-user';

const SOURCE_BLOB = {
  openingNarration: 'The airlock cycles. Corridor lights flicker.',
  narrative: {
    location: 'Derelict freighter Callisto',
    atmosphere: 'Stale, claustrophobic',
    npcAgendas: {
      engineer_kowalski: 'Reach the engine room before the fire spreads',
      corporate_liaison: 'Recover the manifest at any cost',
    },
    hiddenTruth: 'The manifest lists an unauthorized bio-sample',
    oracleConnections: 'Survivor motive',
  },
  structured: {
    entities: [
      { id: 'dr_chen', type: 'npc', visible: true, tags: ['pc', 'scientist'] },
      { id: 'engineer_kowalski', type: 'npc', visible: true, tags: ['crew'] },
    ],
    flags: {
      adventure_complete: { value: false, trigger: 'Player escapes' },
    },
  },
};

const SOURCE_STATE = {
  resourcePools: {
    dr_chen_hp: { current: 10, max: 10 },
    dr_chen_stress: { current: 2, max: 20 },
  },
  entities: {
    dr_chen: { visible: true, status: 'healthy' },
    engineer_kowalski: { visible: true, status: 'wounded' },
  },
  flags: { adventure_complete: { value: false } },
  scenarioState: {},
  worldFacts: { ship_name: 'Callisto' },
};

async function seedSourceAdventure(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    id: SYSTEM_ID,
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
  await db.insert(schema.users).values({ id: USER_ID, email: 'rt@test' });
  await db.insert(schema.campaigns).values({
    id: SOURCE_CAMPAIGN_ID,
    systemId: SYSTEM_ID,
    name: 'The Callisto Incident',
    visibility: 'private',
    diceMode: 'soft_accountability',
  });
  await db.insert(schema.adventures).values({
    id: SOURCE_ADVENTURE_ID,
    campaignId: SOURCE_CAMPAIGN_ID,
    status: 'ready',
    mode: 'freeform',
  });
  await db.insert(schema.gmContexts).values({
    adventureId: SOURCE_ADVENTURE_ID,
    schemaVersion: 1,
    blob: SOURCE_BLOB,
  });
  await db.insert(schema.campaignStates).values({
    campaignId: SOURCE_CAMPAIGN_ID,
    system: 'mothership',
    schemaVersion: 1,
    data: SOURCE_STATE,
  });
}

let tmpDir: string;

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
  tmpDir = mkdtempSync(join(tmpdir(), 'save-load-roundtrip-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('save-synthesis → load-synthesis round-trip', () => {
  it('preserves gm_context.blob and campaign_state.data byte-for-byte across save+load, minting fresh UUIDs', async () => {
    await seedSourceAdventure();
    const db = getTestDb();

    // --- Save -------------------------------------------------------------
    const exported = await buildSynthesisExport(db, SOURCE_ADVENTURE_ID);
    const serialized = JSON.stringify(exported, null, 2);
    const tmpFile = join(tmpDir, 'source.json');
    writeFileSync(tmpFile, serialized, 'utf8');

    // --- Load -------------------------------------------------------------
    // Re-parse from disk so the Zod path is exercised; byte-identity survives
    // the file round-trip (UTF-8, 2-space indent).
    const rawJson = readFileSync(tmpFile, 'utf8');
    const parsed = parseSynthesisExport(JSON.parse(rawJson));
    const loaded = await buildAndRunLoad(db, {
      exportPayload: parsed,
      userId: USER_ID,
    });

    // --- Assert -----------------------------------------------------------
    // Fresh UUIDs.
    expect(loaded.campaignId).not.toBe(SOURCE_CAMPAIGN_ID);
    expect(loaded.adventureId).not.toBe(SOURCE_ADVENTURE_ID);

    // Loaded gm_context.blob deep-equals source blob.
    const [loadedGmContext] = await db
      .select()
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, loaded.adventureId));
    expect(loadedGmContext.blob).toEqual(SOURCE_BLOB);
    expect(loadedGmContext.schemaVersion).toBe(1);

    // Loaded campaign_state.data deep-equals source data.
    const [loadedState] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, loaded.campaignId));
    expect(loadedState.data).toEqual(SOURCE_STATE);
    expect(loadedState.schemaVersion).toBe(1);

    // Adventure is playable immediately: status=ready, mode=freeform,
    // owner is a member of the campaign.
    const [loadedAdventure] = await db
      .select()
      .from(schema.adventures)
      .where(eq(schema.adventures.id, loaded.adventureId));
    expect(loadedAdventure.status).toBe('ready');
    expect(loadedAdventure.mode).toBe('freeform');

    const members = await db
      .select()
      .from(schema.campaignMembers)
      .where(eq(schema.campaignMembers.campaignId, loaded.campaignId));
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe('owner');
    expect(members[0].userId).toBe(USER_ID);
  });

  it('allows the same saved file to be loaded into two separate campaigns', async () => {
    await seedSourceAdventure();
    const db = getTestDb();

    const exported = await buildSynthesisExport(db, SOURCE_ADVENTURE_ID);
    const parsed = parseSynthesisExport(
      JSON.parse(JSON.stringify(exported)),
    );

    const runA = await buildAndRunLoad(db, {
      exportPayload: parsed,
      userId: USER_ID,
      nameOverride: 'Prompt A run',
    });
    const runB = await buildAndRunLoad(db, {
      exportPayload: parsed,
      userId: USER_ID,
      nameOverride: 'Prompt B run',
    });

    expect(runA.campaignId).not.toBe(runB.campaignId);
    expect(runA.adventureId).not.toBe(runB.adventureId);

    // Both loaded adventures carry identical starting conditions — the
    // "same scenario, different Warden" scenario M7.1 was designed for.
    const [stateA] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, runA.campaignId));
    const [stateB] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, runB.campaignId));
    expect(stateA.data).toEqual(stateB.data);
    expect(stateA.data).toEqual(SOURCE_STATE);
  });
});
