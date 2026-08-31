import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CanonRepository } from '../src/canon/canon.repository';
import * as schema from '../src/db/schema';
import { SynthesisRepository } from '../src/synthesis/synthesis.repository';
import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../test/db-test-helper';

import {
  buildAndRunLoad,
  LoadSynthesisError,
  loadSynthesisSnapshot,
  parseSynthesisExport,
} from './load-synthesis.core';

import type { SynthesisExport } from '../src/synthesis/synthesis-export.schema';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000201';
const USER_ID_PRIMARY = 'user-primary';
const USER_ID_SECONDARY = 'user-secondary';

const VALID_EXPORT: SynthesisExport = {
  version: 1,
  exportedAt: '2026-04-24T15:00:00Z',
  source: {
    campaignId: '00000000-0000-0000-0000-000000000210',
    adventureId: '00000000-0000-0000-0000-000000000211',
    campaignName: 'Source Campaign',
  },
  system: { slug: 'mothership' },
  gmContext: {
    schemaVersion: 1,
    blob: {
      openingNarration: 'The airlock cycles.',
      narrative: {
        scenarioPremise: 'Persephone',
        atmosphere: 'stale',
        npcAgendas: { engineer_kowalski: 'reach engine room' },
        hiddenTruth: 'the manifest is forged',
        oracleConnections: 'survivor motive',
      },
      structured: {
        entities: [{ id: 'dr_chen', type: 'npc', visible: true, tags: ['pc'] }],
        flags: {
          adventure_complete: { value: false, trigger: 'player escapes' },
        },
      },
    },
  },
  campaignState: {
    schemaVersion: 1,
    data: {
      resourcePools: {
        dr_chen_hp: { current: 10, max: 10 },
        dr_chen_stress: { current: 2, max: 20 },
      },
      entities: { dr_chen: { visible: true, status: 'healthy' } },
      flags: { adventure_complete: { value: false } },
      scenarioState: {},
      worldFacts: {},
    },
  },
  adventure: { mode: 'freeform' },
};

async function seedSystem(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    id: SYSTEM_ID,
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
}

async function seedUsers(ids: string[]): Promise<void> {
  const db = getTestDb();
  for (const id of ids) {
    await db.insert(schema.users).values({ id, email: `${id}@test` });
  }
}

/**
 * Seeds a campaign + adventure directly with an `adventure_synthesis_snapshots`
 * row, bypassing `writeGmContextAtomic` — for tests that only care about
 * `loadSynthesisSnapshot`'s read/reassembly path, not the capture path
 * (that's covered by `synthesis.repository.spec-int.ts` and by the
 * round-trip test below).
 */
async function seedAdventureWithSnapshot(overrides?: {
  mode?: 'freeform' | 'initiative';
}): Promise<{ campaignId: string; adventureId: string }> {
  const db = getTestDb();
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      systemId: SYSTEM_ID,
      name: 'Snapshot Source Campaign',
      visibility: 'private',
      diceMode: 'soft_accountability',
    })
    .returning();
  const [adventure] = await db
    .insert(schema.adventures)
    .values({
      campaignId: campaign.id,
      status: 'ready',
      mode: overrides?.mode ?? 'freeform',
    })
    .returning();
  await db.insert(schema.adventureSynthesisSnapshots).values({
    adventureId: adventure.id,
    gmContextSchemaVersion: 1,
    gmContextBlob: {
      openingNarration: 'Snapshot narration.',
      narrative: { scenarioPremise: 'loc' },
    },
    campaignStateSchemaVersion: 1,
    campaignStateData: {
      schemaVersion: 1,
      resourcePools: { dr_chen_hp: { current: 10, max: 10 } },
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    },
  });
  return { campaignId: campaign.id, adventureId: adventure.id };
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

describe('parseSynthesisExport', () => {
  it('accepts a valid export object', () => {
    expect(() => parseSynthesisExport(VALID_EXPORT)).not.toThrow();
  });

  it('rejects unknown version with a LoadSynthesisError (exit code 2)', () => {
    const bad = { ...VALID_EXPORT, version: 2 as unknown as 1 };
    const err = catchError(() => parseSynthesisExport(bad));
    expect(err).toBeInstanceOf(LoadSynthesisError);
    expect((err as LoadSynthesisError).exitCode).toBe(2);
    expect((err as LoadSynthesisError).message).toMatch(/\bversion\b/);
  });

  it('rejects a missing required field with a path-tagged message', () => {
    const bad = { ...VALID_EXPORT, source: { campaignId: 'not-a-uuid' } };
    const err = catchError(() => parseSynthesisExport(bad));
    expect(err).toBeInstanceOf(LoadSynthesisError);
    expect((err as LoadSynthesisError).message).toMatch(
      /source\.campaignId|source\.adventureId|source\.campaignName/,
    );
  });

  it('rejects a wholly unrecognizable shape', () => {
    expect(() => parseSynthesisExport({ hello: 'world' })).toThrow(
      LoadSynthesisError,
    );
  });
});

describe('loadSynthesisSnapshot', () => {
  it('assembles a valid SynthesisExport from a captured snapshot row', async () => {
    await seedSystem();
    const { campaignId, adventureId } = await seedAdventureWithSnapshot();

    const exportPayload = await loadSynthesisSnapshot(getTestDb(), adventureId);

    expect(exportPayload.version).toBe(1);
    expect(exportPayload.source.campaignId).toBe(campaignId);
    expect(exportPayload.source.adventureId).toBe(adventureId);
    expect(exportPayload.source.campaignName).toBe('Snapshot Source Campaign');
    expect(exportPayload.system.slug).toBe('mothership');
    expect(exportPayload.adventure.mode).toBe('freeform');
    expect(exportPayload.gmContext.schemaVersion).toBe(1);
    expect(exportPayload.gmContext.blob).toEqual({
      openingNarration: 'Snapshot narration.',
      narrative: { scenarioPremise: 'loc' },
    });
    expect(exportPayload.campaignState.schemaVersion).toBe(1);
  });

  it('fails with exit code 1 when no snapshot row exists for an otherwise-real adventure', async () => {
    await seedSystem();
    const db = getTestDb();
    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        systemId: SYSTEM_ID,
        name: 'No Snapshot Campaign',
        visibility: 'private',
        diceMode: 'soft_accountability',
      })
      .returning();
    const [adventure] = await db
      .insert(schema.adventures)
      .values({ campaignId: campaign.id, status: 'ready', mode: 'freeform' })
      .returning();

    const err = await loadSynthesisSnapshot(db, adventure.id).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LoadSynthesisError);
    expect((err as LoadSynthesisError).exitCode).toBe(1);
    expect((err as LoadSynthesisError).message).toMatch(
      /no synthesis snapshot captured/,
    );
  });

  it('fails with exit code 1 for an adventure id that does not exist at all', async () => {
    const db = getTestDb();
    const err = await loadSynthesisSnapshot(
      db,
      '00000000-0000-0000-0000-000000000999',
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadSynthesisError);
    expect((err as LoadSynthesisError).exitCode).toBe(1);
    expect((err as LoadSynthesisError).message).toMatch(
      /no synthesis snapshot captured/,
    );
  });

  it('fails with exit code 2 (malformed, distinct from "no snapshot") when the adventure is non-freeform', async () => {
    await seedSystem();
    const { adventureId } = await seedAdventureWithSnapshot({
      mode: 'initiative',
    });

    const db = getTestDb();
    const err = await loadSynthesisSnapshot(db, adventureId).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LoadSynthesisError);
    expect((err as LoadSynthesisError).exitCode).toBe(2);
    expect((err as LoadSynthesisError).message).toMatch(/adventure\.mode/);
  });
});

describe('load-synthesis round trip (capture -> load)', () => {
  it('loads a snapshot captured by the real writeGmContextAtomic path, preserving blob/data', async () => {
    await seedSystem();
    await seedUsers([USER_ID_PRIMARY]);
    const db = getTestDb();

    const [sourceCampaign] = await db
      .insert(schema.campaigns)
      .values({
        systemId: SYSTEM_ID,
        name: 'Real Synthesis Source',
        visibility: 'private',
        diceMode: 'soft_accountability',
      })
      .returning();
    const [sourceAdventure] = await db
      .insert(schema.adventures)
      .values({
        campaignId: sourceCampaign.id,
        status: 'synthesizing',
        mode: 'freeform',
      })
      .returning();

    const canonRepo = new CanonRepository(db as never);
    const synthesisRepo = new SynthesisRepository(db as never, canonRepo);

    const sourceGmContextBlob = {
      openingNarration: 'The reactor hums.',
      narrative: { scenarioPremise: 'Engine bay' },
    };
    const sourceCampaignStateData = {
      schemaVersion: 1,
      resourcePools: { vasquez_hp: { current: 12, max: 15 } },
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    };

    await synthesisRepo.writeGmContextAtomic({
      adventureId: sourceAdventure.id,
      campaignId: sourceCampaign.id,
      gmContextBlob: sourceGmContextBlob,
      campaignStateData: sourceCampaignStateData,
      gridEntities: [],
    });

    const exportPayload = await loadSynthesisSnapshot(db, sourceAdventure.id);
    const result = await buildAndRunLoad(db, {
      exportPayload,
      userId: USER_ID_PRIMARY,
    });

    expect(result.adventureId).not.toBe(sourceAdventure.id);
    expect(result.campaignId).not.toBe(sourceCampaign.id);

    const [loadedGmContext] = await db
      .select()
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, result.adventureId));
    expect(loadedGmContext.blob).toEqual(sourceGmContextBlob);

    const [loadedCampaignState] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, result.campaignId));
    expect(loadedCampaignState.data).toEqual(sourceCampaignStateData);
  });
});

describe('buildAndRunLoad — happy path', () => {
  it('creates fresh campaign + member + adventure + gm_context + campaign_state rows', async () => {
    await seedSystem();
    await seedUsers([USER_ID_PRIMARY]);

    const db = getTestDb();
    const result = await buildAndRunLoad(db, {
      exportPayload: VALID_EXPORT,
      userId: USER_ID_PRIMARY,
    });

    expect(result.campaignId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.adventureId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.campaignId).not.toBe(VALID_EXPORT.source.campaignId);
    expect(result.adventureId).not.toBe(VALID_EXPORT.source.adventureId);
    expect(result.playUrl).toBe(
      `/campaigns/${result.campaignId}/adventures/${result.adventureId}/play`,
    );
    expect(result.warnings).toEqual([]);

    // Campaign row created with defaulted name + private visibility.
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, result.campaignId));
    expect(campaign.name).toMatch(/^Source Campaign \(clone \d{8}-\d{6}\)$/);
    expect(campaign.systemId).toBe(SYSTEM_ID);
    expect(campaign.visibility).toBe('private');

    // Member row with role='owner' for the resolved user.
    const members = await db
      .select()
      .from(schema.campaignMembers)
      .where(eq(schema.campaignMembers.campaignId, result.campaignId));
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(USER_ID_PRIMARY);
    expect(members[0].role).toBe('owner');

    // Adventure row status='ready', mode='freeform', caller_id=owner.
    const [adventure] = await db
      .select()
      .from(schema.adventures)
      .where(eq(schema.adventures.id, result.adventureId));
    expect(adventure.status).toBe('ready');
    expect(adventure.mode).toBe('freeform');
    expect(adventure.callerId).toBe(USER_ID_PRIMARY);
    expect(adventure.campaignId).toBe(result.campaignId);

    // gm_context preserves blob + schemaVersion verbatim.
    const [gmContext] = await db
      .select()
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, result.adventureId));
    expect(gmContext.schemaVersion).toBe(1);
    expect(gmContext.blob).toEqual(VALID_EXPORT.gmContext.blob);

    // campaign_state preserves data + schemaVersion verbatim.
    const [campaignState] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, result.campaignId));
    expect(campaignState.schemaVersion).toBe(1);
    expect(campaignState.system).toBe('mothership');
    expect(campaignState.data).toEqual(VALID_EXPORT.campaignState.data);
  });

  it('honors --name override', async () => {
    await seedSystem();
    await seedUsers([USER_ID_PRIMARY]);

    const db = getTestDb();
    const result = await buildAndRunLoad(db, {
      exportPayload: VALID_EXPORT,
      userId: USER_ID_PRIMARY,
      nameOverride: 'Prompt A — iteration 3',
    });

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, result.campaignId));
    expect(campaign.name).toBe('Prompt A — iteration 3');
  });

  it('is idempotent (loading twice yields two distinct campaigns)', async () => {
    await seedSystem();
    await seedUsers([USER_ID_PRIMARY]);

    const db = getTestDb();
    const first = await buildAndRunLoad(db, {
      exportPayload: VALID_EXPORT,
      userId: USER_ID_PRIMARY,
    });
    const second = await buildAndRunLoad(db, {
      exportPayload: VALID_EXPORT,
      userId: USER_ID_PRIMARY,
    });

    expect(first.campaignId).not.toBe(second.campaignId);
    expect(first.adventureId).not.toBe(second.adventureId);

    const campaigns = await db.select().from(schema.campaigns);
    expect(campaigns).toHaveLength(2);
  });
});

describe('buildAndRunLoad — user resolution', () => {
  it('falls back to the first user and records a warning when no userId is provided', async () => {
    await seedSystem();
    await seedUsers([USER_ID_PRIMARY, USER_ID_SECONDARY]);

    const db = getTestDb();
    const result = await buildAndRunLoad(db, { exportPayload: VALID_EXPORT });

    // First user by id-asc is USER_ID_PRIMARY (lexicographic: 'user-primary' < 'user-secondary').
    expect(result.resolvedUserId).toBe(USER_ID_PRIMARY);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(USER_ID_PRIMARY);
    expect(result.warnings[0]).toMatch(/PLAYTEST_LOAD_USER_ID unset/);
  });

  it('fails with a clear error when the user table is empty', async () => {
    await seedSystem();

    const db = getTestDb();
    const err = await buildAndRunLoad(db, {
      exportPayload: VALID_EXPORT,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadSynthesisError);
    expect((err as LoadSynthesisError).exitCode).toBe(1);
    expect((err as LoadSynthesisError).message).toMatch(/No users exist/);
  });

  it('fails when an explicit userId does not match any user row', async () => {
    await seedSystem();
    await seedUsers([USER_ID_PRIMARY]);

    const db = getTestDb();
    const err = await buildAndRunLoad(db, {
      exportPayload: VALID_EXPORT,
      userId: 'ghost-user',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadSynthesisError);
    expect((err as LoadSynthesisError).message).toMatch(/ghost-user/);
  });

  it('fails when the game_system row is missing', async () => {
    // No seedSystem() — system row missing.
    await seedUsers([USER_ID_PRIMARY]);

    const db = getTestDb();
    const err = await buildAndRunLoad(db, {
      exportPayload: VALID_EXPORT,
      userId: USER_ID_PRIMARY,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadSynthesisError);
    expect((err as LoadSynthesisError).message).toMatch(/game_system/);
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}
