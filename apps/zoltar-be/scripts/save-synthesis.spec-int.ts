import {
  afterAll,
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
  buildSynthesisExport,
  SaveSynthesisError,
  slugifyCampaignName,
} from './save-synthesis.core';

import type { SynthesisExport } from '../src/synthesis/synthesis-export.schema';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000101';
const CAMPAIGN_ID = '00000000-0000-0000-0000-000000000102';
const ADVENTURE_ID = '00000000-0000-0000-0000-000000000103';

// Fixture blobs are intentionally chunky — the round-trip test asserts the
// full bytes survive, and the manual smoke test reads this to confirm a
// realistic-looking dump is produced.
const GM_CONTEXT_BLOB = {
  openingNarration:
    'The airlock cycles. You step into the dim corridor of the Callisto.',
  narrative: {
    location: 'Derelict freighter Callisto',
    atmosphere: 'Stale air, fluorescent flicker, something moved in the dark',
    npcAgendas: {
      engineer_kowalski: 'Reach the engine room before the fire spreads',
      corporate_liaison: 'Recover the manifest at any cost',
    },
    hiddenTruth: 'The manifest lists an unauthorized bio-sample',
    oracleConnections: 'Survivor motive ties to the hidden truth',
  },
  structured: {
    entities: [
      {
        id: 'dr_chen',
        type: 'npc',
        visible: true,
        tags: ['pc', 'scientist'],
      },
    ],
    flags: {
      adventure_complete: {
        value: false,
        trigger: 'Player escapes via the emergency pod',
      },
    },
  },
};

const CAMPAIGN_STATE_DATA = {
  resourcePools: {
    dr_chen_hp: { current: 10, max: 10 },
    dr_chen_stress: { current: 2, max: 20 },
  },
  entities: {
    dr_chen: { visible: true, status: 'healthy' },
  },
  flags: {
    adventure_complete: { value: false },
  },
  scenarioState: {},
  worldFacts: {},
};

async function seedBaseAdventure(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    id: SYSTEM_ID,
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
  await db.insert(schema.campaigns).values({
    id: CAMPAIGN_ID,
    systemId: SYSTEM_ID,
    name: 'The Callisto Incident',
    visibility: 'private',
    diceMode: 'soft_accountability',
  });
  await db.insert(schema.adventures).values({
    id: ADVENTURE_ID,
    campaignId: CAMPAIGN_ID,
    status: 'ready',
    mode: 'freeform',
  });
  await db.insert(schema.gmContexts).values({
    adventureId: ADVENTURE_ID,
    blob: GM_CONTEXT_BLOB,
  });
  await db.insert(schema.campaignStates).values({
    campaignId: CAMPAIGN_ID,
    system: 'mothership',
    schemaVersion: 1,
    data: CAMPAIGN_STATE_DATA,
  });
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

describe('slugifyCampaignName', () => {
  it('lowercases, collapses non-alphanumerics into underscores, and trims edges', () => {
    expect(slugifyCampaignName('The Callisto Incident!!!')).toBe(
      'the_callisto_incident',
    );
  });

  it('truncates to 40 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugifyCampaignName(long)).toHaveLength(40);
  });

  it('falls back to "campaign" when the name contains no alphanumerics', () => {
    expect(slugifyCampaignName('---!!!')).toBe('campaign');
  });
});

describe('buildSynthesisExport — happy path', () => {
  it('produces a SynthesisExport whose blob and data deep-equal the source rows', async () => {
    await seedBaseAdventure();
    const db = getTestDb();
    const exportPayload = await buildSynthesisExport(db, ADVENTURE_ID);

    expect(exportPayload.version).toBe(1);
    expect(exportPayload.system.slug).toBe('mothership');
    expect(exportPayload.adventure.mode).toBe('freeform');

    // source.* carries the *original* UUIDs — no fresh UUIDs generated in save.
    expect(exportPayload.source.campaignId).toBe(CAMPAIGN_ID);
    expect(exportPayload.source.adventureId).toBe(ADVENTURE_ID);
    expect(exportPayload.source.campaignName).toBe('The Callisto Incident');

    // gmContext.blob and campaignState.data survive a JSON round-trip byte-
    // for-byte. This is the load-path precondition — the loader must be
    // able to INSERT the same jsonb back into the new rows.
    const roundTrip = JSON.parse(
      JSON.stringify(exportPayload),
    ) as SynthesisExport;
    expect(roundTrip.gmContext.blob).toEqual(GM_CONTEXT_BLOB);
    expect(roundTrip.campaignState.data).toEqual(CAMPAIGN_STATE_DATA);
    expect(roundTrip.campaignState.schemaVersion).toBe(1);
    expect(roundTrip.gmContext.schemaVersion).toBe(1);
  });

  it('exportedAt is a parseable ISO timestamp', async () => {
    await seedBaseAdventure();
    const db = getTestDb();
    const exportPayload = await buildSynthesisExport(db, ADVENTURE_ID);
    expect(Number.isNaN(Date.parse(exportPayload.exportedAt))).toBe(false);
  });
});

describe('buildSynthesisExport — preconditions', () => {
  it('rejects adventures with any gm_response event and points at the review CLI', async () => {
    await seedBaseAdventure();
    // One played turn — any gm_response event is enough to disqualify.
    const db = getTestDb();
    await db.insert(schema.gameEvents).values({
      campaignId: CAMPAIGN_ID,
      adventureId: ADVENTURE_ID,
      sequenceNumber: 2,
      eventType: 'gm_response',
      actorType: 'gm',
      payload: { playerText: 'You step through.', stateChanges: null, gmUpdates: null, diceRequests: null, adventureMode: null },
    });

    const err = await buildSynthesisExport(db, ADVENTURE_ID).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SaveSynthesisError);
    const saveErr = err as SaveSynthesisError;
    expect(saveErr.exitCode).toBe(1);
    expect(saveErr.message).toContain('save-synthesis is for zero-turn');
    // Message must include the review-CLI pointer so the user can discover
    // the right tool from the error alone.
    expect(saveErr.message).toMatch(/task playtest:review/);
  });

  it('rejects an unknown adventure id', async () => {
    await setupBaseSystemAndCampaign();
    const db = getTestDb();
    await expect(
      buildSynthesisExport(db, '00000000-0000-0000-0000-0000000000ff'),
    ).rejects.toBeInstanceOf(SaveSynthesisError);
  });

  it('rejects a non-mothership campaign', async () => {
    const db = getTestDb();
    await db.insert(schema.gameSystems).values({
      id: SYSTEM_ID,
      slug: 'uvg',
      name: 'Ultraviolet Grasslands',
      indexSource: 'user_provided',
    });
    await db.insert(schema.campaigns).values({
      id: CAMPAIGN_ID,
      systemId: SYSTEM_ID,
      name: 'UVG Caravan',
    });
    await db.insert(schema.adventures).values({
      id: ADVENTURE_ID,
      campaignId: CAMPAIGN_ID,
      status: 'ready',
      mode: 'freeform',
    });
    await db.insert(schema.gmContexts).values({
      adventureId: ADVENTURE_ID,
      blob: {},
    });
    await db.insert(schema.campaignStates).values({
      campaignId: CAMPAIGN_ID,
      system: 'uvg',
      schemaVersion: 1,
      data: {},
    });

    await expect(buildSynthesisExport(db, ADVENTURE_ID)).rejects.toThrow(
      /Only Mothership/,
    );
  });

  it('rejects an adventure with no gm_context row', async () => {
    await setupBaseSystemAndCampaign();
    const db = getTestDb();
    await db.insert(schema.adventures).values({
      id: ADVENTURE_ID,
      campaignId: CAMPAIGN_ID,
      status: 'synthesizing',
      mode: 'freeform',
    });
    // campaign_state + gm_context omitted to trigger the "synthesis not
    // completed" error path.
    await db.insert(schema.campaignStates).values({
      campaignId: CAMPAIGN_ID,
      system: 'mothership',
      schemaVersion: 1,
      data: {},
    });

    await expect(buildSynthesisExport(db, ADVENTURE_ID)).rejects.toThrow(
      /no gm_context row/,
    );
  });
});

async function setupBaseSystemAndCampaign(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    id: SYSTEM_ID,
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
  await db.insert(schema.campaigns).values({
    id: CAMPAIGN_ID,
    systemId: SYSTEM_ID,
    name: 'Baseline',
  });
}
