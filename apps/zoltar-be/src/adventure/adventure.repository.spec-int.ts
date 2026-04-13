import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDb,
  getTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import * as schema from '../db/schema';
import { AdventureRepository } from './adventure.repository';

let repo: AdventureRepository;

beforeAll(async () => {
  await setupTestDb();
  repo = new AdventureRepository(getTestDb() as any);
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function seedSystemAndCampaign(): Promise<{ systemId: string; campaignId: string }> {
  const db = getTestDb();
  const [system] = await db
    .insert(schema.gameSystems)
    .values({ slug: 'mothership', name: 'Mothership', indexSource: 'user_provided' })
    .returning();
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({ systemId: system.id, name: 'Test Campaign', visibility: 'private', diceMode: 'soft_accountability' })
    .returning();
  return { systemId: system.id, campaignId: campaign.id };
}

async function seedUser(id: string, email: string): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.users).values({ id, email });
}

describe('AdventureRepository (integration)', () => {
  describe('insert + findById', () => {
    it('inserts an adventure with status synthesizing and retrieves it', async () => {
      const { campaignId } = await seedSystemAndCampaign();
      await seedUser('u1', 'alice@example.com');

      const adventure = await repo.insert({ campaignId, callerId: 'u1' });

      expect(adventure.id).toBeDefined();
      expect(adventure.status).toBe('synthesizing');
      expect(adventure.campaignId).toBe(campaignId);
      expect(adventure.callerId).toBe('u1');

      const found = await repo.findById(adventure.id, campaignId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(adventure.id);
    });
  });

  describe('findById', () => {
    it('returns null for non-existent adventure', async () => {
      const { campaignId } = await seedSystemAndCampaign();
      const result = await repo.findById('00000000-0000-0000-0000-000000000000', campaignId);
      expect(result).toBeNull();
    });

    it('returns null when adventure belongs to a different campaign', async () => {
      const { campaignId } = await seedSystemAndCampaign();
      await seedUser('u1', 'alice@example.com');

      const adventure = await repo.insert({ campaignId, callerId: 'u1' });

      // Look up with wrong campaign ID
      const result = await repo.findById(adventure.id, '00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('findAllForCampaign', () => {
    it('returns adventures ordered by createdAt descending', async () => {
      const { campaignId } = await seedSystemAndCampaign();
      await seedUser('u1', 'alice@example.com');

      const a1 = await repo.insert({ campaignId, callerId: 'u1' });
      const a2 = await repo.insert({ campaignId, callerId: 'u1' });

      const adventures = await repo.findAllForCampaign(campaignId);
      expect(adventures).toHaveLength(2);
      // Most recent first
      expect(adventures[0].id).toBe(a2.id);
      expect(adventures[1].id).toBe(a1.id);
    });

    it('returns empty array when campaign has no adventures', async () => {
      const { campaignId } = await seedSystemAndCampaign();
      const adventures = await repo.findAllForCampaign(campaignId);
      expect(adventures).toHaveLength(0);
    });

    it('does not return adventures from other campaigns', async () => {
      const db = getTestDb();
      const { systemId, campaignId: c1 } = await seedSystemAndCampaign();
      const [c2] = await db
        .insert(schema.campaigns)
        .values({ systemId, name: 'Other Campaign', visibility: 'private', diceMode: 'soft_accountability' })
        .returning();
      await seedUser('u1', 'alice@example.com');

      await repo.insert({ campaignId: c1, callerId: 'u1' });
      await repo.insert({ campaignId: c2.id, callerId: 'u1' });

      const c1Adventures = await repo.findAllForCampaign(c1);
      expect(c1Adventures).toHaveLength(1);

      const c2Adventures = await repo.findAllForCampaign(c2.id);
      expect(c2Adventures).toHaveLength(1);
    });
  });
});
