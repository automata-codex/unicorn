import { eq } from 'drizzle-orm';
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
  buildAndRunLoad,
  LoadSynthesisError,
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
        location: 'Persephone',
        atmosphere: 'stale',
        npcAgendas: { engineer_kowalski: 'reach engine room' },
        hiddenTruth: 'the manifest is forged',
        oracleConnections: 'survivor motive',
      },
      structured: {
        entities: [
          { id: 'dr_chen', type: 'npc', visible: true, tags: ['pc'] },
        ],
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
    expect((err as LoadSynthesisError).message).toMatch(/source\.campaignId|source\.adventureId|source\.campaignName/);
  });

  it('rejects a wholly unrecognizable shape', () => {
    expect(() => parseSynthesisExport({ hello: 'world' })).toThrow(
      LoadSynthesisError,
    );
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
    const err = await buildAndRunLoad(db, { exportPayload: VALID_EXPORT }).catch(
      (e: unknown) => e,
    );
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
