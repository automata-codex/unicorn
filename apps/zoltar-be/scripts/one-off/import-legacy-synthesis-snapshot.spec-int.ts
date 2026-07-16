import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema';
import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';

import { importLegacySynthesisSnapshot } from './import-legacy-synthesis-snapshot.core';

import type { ImportLegacySnapshotError } from './import-legacy-synthesis-snapshot.core';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000301';
const ADVENTURE_ID = '00000000-0000-0000-0000-000000000311';

const LEGACY_EXPORT = {
  version: 1,
  exportedAt: '2025-07-15T12:00:00Z',
  source: {
    campaignId: '00000000-0000-0000-0000-000000000310',
    adventureId: ADVENTURE_ID,
    campaignName: 'Legacy Playtest Campaign',
  },
  system: { slug: 'mothership' },
  gmContext: {
    schemaVersion: 1,
    blob: { openingNarration: 'The old save file speaks.' },
  },
  campaignState: {
    schemaVersion: 1,
    data: {
      resourcePools: { dr_chen_hp: { current: 8, max: 10 } },
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    },
  },
  adventure: { mode: 'freeform' },
};

async function seedAdventure(
  adventureId: string = ADVENTURE_ID,
): Promise<void> {
  const db = getTestDb();
  await db
    .insert(schema.gameSystems)
    .values({
      id: SYSTEM_ID,
      slug: 'mothership',
      name: 'Mothership',
      indexSource: 'user_provided',
    })
    .onConflictDoNothing();
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      systemId: SYSTEM_ID,
      name: 'Legacy Playtest Campaign',
      visibility: 'private',
      diceMode: 'soft_accountability',
    })
    .returning();
  await db.insert(schema.adventures).values({
    id: adventureId,
    campaignId: campaign.id,
    status: 'in_progress',
    mode: 'freeform',
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

describe('importLegacySynthesisSnapshot', () => {
  it('inserts a snapshot row for a valid file matching an existing adventure', async () => {
    await seedAdventure();
    const db = getTestDb();

    const result = await importLegacySynthesisSnapshot(
      db,
      LEGACY_EXPORT,
      ADVENTURE_ID,
    );

    expect(result.adventureId).toBe(ADVENTURE_ID);

    const [row] = await db
      .select()
      .from(schema.adventureSynthesisSnapshots)
      .where(eq(schema.adventureSynthesisSnapshots.adventureId, ADVENTURE_ID));
    expect(row).toBeDefined();
    expect(row.gmContextBlob).toEqual(LEGACY_EXPORT.gmContext.blob);
    expect(row.campaignStateData).toEqual(LEGACY_EXPORT.campaignState.data);
    expect(row.gmContextSchemaVersion).toBe(1);
    expect(row.campaignStateSchemaVersion).toBe(1);
  });

  it('refuses to import when the file adventure id does not match the provided id — no row inserted', async () => {
    const db = getTestDb();
    const wrongId = '00000000-0000-0000-0000-000000000999';
    await seedAdventure(wrongId);

    const err = await importLegacySynthesisSnapshot(
      db,
      LEGACY_EXPORT,
      wrongId,
    ).catch((e: unknown) => e);

    expect((err as Error).name).toBe('ImportLegacySnapshotError');
    expect((err as ImportLegacySnapshotError).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/does not match/);

    const rows = await db.select().from(schema.adventureSynthesisSnapshots);
    expect(rows).toHaveLength(0);
  });

  it('refuses to import when the adventure already has a snapshot — existing row untouched', async () => {
    await seedAdventure();
    const db = getTestDb();

    await db.insert(schema.adventureSynthesisSnapshots).values({
      adventureId: ADVENTURE_ID,
      gmContextSchemaVersion: 1,
      gmContextBlob: { openingNarration: 'Already captured for real.' },
      campaignStateSchemaVersion: 1,
      campaignStateData: { resourcePools: {} },
    });

    const err = await importLegacySynthesisSnapshot(
      db,
      LEGACY_EXPORT,
      ADVENTURE_ID,
    ).catch((e: unknown) => e);

    expect((err as Error).name).toBe('ImportLegacySnapshotError');
    expect((err as ImportLegacySnapshotError).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/already has a synthesis snapshot/);

    const [row] = await db
      .select()
      .from(schema.adventureSynthesisSnapshots)
      .where(eq(schema.adventureSynthesisSnapshots.adventureId, ADVENTURE_ID));
    expect(row.gmContextBlob).toEqual({
      openingNarration: 'Already captured for real.',
    });
  });

  it('refuses to import when no adventure exists with the provided id', async () => {
    const db = getTestDb();

    const err = await importLegacySynthesisSnapshot(
      db,
      LEGACY_EXPORT,
      ADVENTURE_ID,
    ).catch((e: unknown) => e);

    expect((err as Error).name).toBe('ImportLegacySnapshotError');
    expect((err as ImportLegacySnapshotError).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/no adventure found/);
  });

  it('rejects a malformed file before touching the database', async () => {
    await seedAdventure();
    const db = getTestDb();

    const err = await importLegacySynthesisSnapshot(
      db,
      { hello: 'world' },
      ADVENTURE_ID,
    ).catch((e: unknown) => e);

    expect((err as Error).name).toBe('ImportLegacySnapshotError');
    expect((err as ImportLegacySnapshotError).exitCode).toBe(2);

    const rows = await db.select().from(schema.adventureSynthesisSnapshots);
    expect(rows).toHaveLength(0);
  });
});
