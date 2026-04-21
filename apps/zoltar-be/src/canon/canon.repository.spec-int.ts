import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import * as schema from '../db/schema';

import { CanonRepository } from './canon.repository';

let repo: CanonRepository;

beforeAll(async () => {
  await setupTestDb();
  repo = new CanonRepository(getTestDb() as never);
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function seedFixture(): Promise<{
  campaignId: string;
  adventureId: string;
}> {
  const db = getTestDb();
  const [system] = await db
    .insert(schema.gameSystems)
    .values({
      slug: 'mothership',
      name: 'Mothership',
      indexSource: 'user_provided',
    })
    .returning();
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      systemId: system.id,
      name: 'Test Campaign',
      visibility: 'private',
      diceMode: 'soft_accountability',
    })
    .returning();
  await db.insert(schema.users).values({ id: 'u1', email: 'alice@x.test' });
  await db.insert(schema.campaignMembers).values({
    campaignId: campaign.id,
    userId: 'u1',
    role: 'owner',
  });
  const [adventure] = await db
    .insert(schema.adventures)
    .values({
      campaignId: campaign.id,
      callerId: 'u1',
      status: 'in_progress',
    })
    .returning();
  return { campaignId: campaign.id, adventureId: adventure.id };
}

describe('CanonRepository (integration)', () => {
  describe('insertPendingCanon', () => {
    it('bulk-inserts entries with status pending', async () => {
      const { adventureId } = await seedFixture();

      await getTestDb().transaction(async (tx) =>
        repo.insertPendingCanon({
          tx,
          adventureId,
          entries: [
            { summary: 'Dr. Chen hides a key card', context: 'turn 3' },
            { summary: 'Reactor is overheating', context: 'turn 3' },
          ],
        }),
      );

      const rows = await getTestDb()
        .select()
        .from(schema.pendingCanon)
        .where(eq(schema.pendingCanon.adventureId, adventureId));
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.status).toBe('pending');
      }
    });

    it('is a no-op when entries is empty', async () => {
      const { adventureId } = await seedFixture();

      await getTestDb().transaction(async (tx) =>
        repo.insertPendingCanon({ tx, adventureId, entries: [] }),
      );

      const rows = await getTestDb()
        .select()
        .from(schema.pendingCanon)
        .where(eq(schema.pendingCanon.adventureId, adventureId));
      expect(rows).toHaveLength(0);
    });
  });

  describe('autoPromoteCanon', () => {
    it('promotes all pending rows for the given adventure and leaves others alone', async () => {
      const db = getTestDb();
      const { campaignId, adventureId } = await seedFixture();
      const [otherAdventure] = await db
        .insert(schema.adventures)
        .values({ campaignId, callerId: 'u1', status: 'synthesizing' })
        .returning();

      await db.insert(schema.pendingCanon).values([
        { adventureId, summary: 'one', context: 'ctx', status: 'pending' },
        { adventureId, summary: 'two', context: 'ctx', status: 'pending' },
        {
          adventureId: otherAdventure.id,
          summary: 'other',
          context: 'ctx',
          status: 'pending',
        },
      ]);

      await repo.autoPromoteCanon(adventureId);

      const promoted = await db
        .select()
        .from(schema.pendingCanon)
        .where(
          and(
            eq(schema.pendingCanon.adventureId, adventureId),
            eq(schema.pendingCanon.status, 'promoted'),
          ),
        );
      expect(promoted).toHaveLength(2);
      for (const row of promoted) {
        expect(row.reviewedAt).not.toBeNull();
      }

      const untouched = await db
        .select()
        .from(schema.pendingCanon)
        .where(eq(schema.pendingCanon.adventureId, otherAdventure.id));
      expect(untouched).toHaveLength(1);
      expect(untouched[0].status).toBe('pending');
    });

    it('runs inside the supplied transaction so a rollback reverts the promotion', async () => {
      const db = getTestDb();
      const { adventureId } = await seedFixture();
      await db.insert(schema.pendingCanon).values({
        adventureId,
        summary: 'inside-tx',
        context: 'ctx',
        status: 'pending',
      });

      await expect(
        db.transaction(async (tx) => {
          await repo.autoPromoteCanon(adventureId, tx);
          throw new Error('force rollback');
        }),
      ).rejects.toThrow('force rollback');

      const rows = await db
        .select()
        .from(schema.pendingCanon)
        .where(eq(schema.pendingCanon.adventureId, adventureId));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].reviewedAt).toBeNull();
    });
  });
});
