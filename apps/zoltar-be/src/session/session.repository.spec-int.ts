import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import * as schema from '../db/schema';
import { SynthesisRepository } from '../synthesis/synthesis.repository';

import { SessionRepository } from './session.repository';

let repo: SessionRepository;

beforeAll(async () => {
  await setupTestDb();
  const synthesisRepo = new SynthesisRepository(getTestDb() as never);
  repo = new SessionRepository(getTestDb() as never, synthesisRepo);
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

describe('SessionRepository (integration)', () => {
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

  describe('mergeNpcAgendas', () => {
    async function seedGmContext(
      adventureId: string,
      blob: Record<string, unknown>,
    ): Promise<void> {
      await getTestDb().insert(schema.gmContexts).values({
        adventureId,
        blob,
      });
    }

    it('overwrites existing npcAgendas on key collision and preserves untouched keys', async () => {
      const { adventureId } = await seedFixture();
      await seedGmContext(adventureId, {
        narrative: {
          location: 'Corridor 7',
          atmosphere: 'Silent',
          npcAgendas: {
            dr_chen: 'Initial agenda',
            corporate_spy_1: 'Watch the player',
          },
          hiddenTruth: 'Reactor is primed',
          oracleConnections: 'None',
        },
      });

      await getTestDb().transaction(async (tx) =>
        repo.mergeNpcAgendas({
          tx,
          adventureId,
          npcStates: { dr_chen: 'Updated agenda — fleeing' },
        }),
      );

      const [row] = await getTestDb()
        .select({ blob: schema.gmContexts.blob })
        .from(schema.gmContexts)
        .where(eq(schema.gmContexts.adventureId, adventureId));
      const blob = row.blob as Record<string, unknown>;
      const narrative = blob.narrative as Record<string, unknown>;
      expect(narrative.npcAgendas).toEqual({
        dr_chen: 'Updated agenda — fleeing',
        corporate_spy_1: 'Watch the player',
      });
      expect(narrative.location).toBe('Corridor 7');
      expect(narrative.hiddenTruth).toBe('Reactor is primed');
    });

    it('is a no-op when npcStates is empty (does not touch the blob)', async () => {
      const { adventureId } = await seedFixture();
      const originalBlob = {
        narrative: {
          location: 'Bridge',
          atmosphere: 'Tense',
          npcAgendas: { dr_chen: 'Original agenda' },
          hiddenTruth: 'x',
          oracleConnections: 'y',
        },
      };
      await seedGmContext(adventureId, originalBlob);

      const [beforeRow] = await getTestDb()
        .select({ updatedAt: schema.gmContexts.updatedAt })
        .from(schema.gmContexts)
        .where(eq(schema.gmContexts.adventureId, adventureId));

      await getTestDb().transaction(async (tx) =>
        repo.mergeNpcAgendas({ tx, adventureId, npcStates: {} }),
      );

      const [afterRow] = await getTestDb()
        .select()
        .from(schema.gmContexts)
        .where(eq(schema.gmContexts.adventureId, adventureId));
      expect(afterRow.blob).toEqual(originalBlob);
      expect(afterRow.updatedAt).toEqual(beforeRow.updatedAt);
    });
  });
});
