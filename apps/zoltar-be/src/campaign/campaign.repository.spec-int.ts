import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import * as schema from '../db/schema';

import { CampaignRepository } from './campaign.repository';

let repo: CampaignRepository;

beforeAll(async () => {
  await setupTestDb();
  repo = new CampaignRepository(getTestDb() as any);
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function seedMothershipSystem(): Promise<string> {
  const db = getTestDb();
  const rows = await db
    .insert(schema.gameSystems)
    .values({
      slug: 'mothership',
      name: 'Mothership',
      indexSource: 'user_provided',
    })
    .returning();
  return rows[0].id;
}

async function seedUser(id: string, email: string): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.users).values({ id, email });
}

describe('CampaignRepository (integration)', () => {
  describe('findGameSystemBySlug', () => {
    it('returns null when no system exists', async () => {
      const result = await repo.findGameSystemBySlug('mothership');
      expect(result).toBeNull();
    });

    it('returns the system when it exists', async () => {
      await seedMothershipSystem();
      const result = await repo.findGameSystemBySlug('mothership');
      expect(result).not.toBeNull();
      expect(result.slug).toBe('mothership');
    });
  });

  describe('insertCampaign + findById', () => {
    it('inserts and retrieves a campaign', async () => {
      const systemId = await seedMothershipSystem();

      const campaign = await repo.insertCampaign({
        systemId,
        name: 'The Persephone Incident',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });

      expect(campaign.id).toBeDefined();
      expect(campaign.name).toBe('The Persephone Incident');

      const found = await repo.findById(campaign.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(campaign.id);
    });
  });

  describe('findById', () => {
    it('returns null for a non-existent campaign', async () => {
      const result = await repo.findById(
        '00000000-0000-0000-0000-000000000000',
      );
      expect(result).toBeNull();
    });
  });

  describe('insertMember + findMember', () => {
    it('inserts a member and finds them', async () => {
      const systemId = await seedMothershipSystem();
      await seedUser('u1', 'alice@example.com');

      const campaign = await repo.insertCampaign({
        systemId,
        name: 'Test',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });

      await repo.insertMember({
        campaignId: campaign.id,
        userId: 'u1',
        role: 'owner',
      });

      const member = await repo.findMember(campaign.id, 'u1');
      expect(member).not.toBeNull();
      expect(member.role).toBe('owner');
    });

    it('returns null for a non-member', async () => {
      const systemId = await seedMothershipSystem();
      await seedUser('u1', 'alice@example.com');

      const campaign = await repo.insertCampaign({
        systemId,
        name: 'Test',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });

      const result = await repo.findMember(campaign.id, 'u1');
      expect(result).toBeNull();
    });
  });

  describe('findOwner', () => {
    it('returns the member when they are an owner', async () => {
      const systemId = await seedMothershipSystem();
      await seedUser('u1', 'alice@example.com');

      const campaign = await repo.insertCampaign({
        systemId,
        name: 'Test',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });

      await repo.insertMember({
        campaignId: campaign.id,
        userId: 'u1',
        role: 'owner',
      });

      const owner = await repo.findOwner(campaign.id, 'u1');
      expect(owner).not.toBeNull();
    });

    it('returns null when the member is a player, not an owner', async () => {
      const systemId = await seedMothershipSystem();
      await seedUser('u1', 'alice@example.com');

      const campaign = await repo.insertCampaign({
        systemId,
        name: 'Test',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });

      await repo.insertMember({
        campaignId: campaign.id,
        userId: 'u1',
        role: 'player',
      });

      const owner = await repo.findOwner(campaign.id, 'u1');
      expect(owner).toBeNull();
    });
  });

  describe('findAllForUser', () => {
    it('returns only campaigns the user is a member of', async () => {
      const systemId = await seedMothershipSystem();
      await seedUser('u1', 'alice@example.com');
      await seedUser('u2', 'bob@example.com');

      const c1 = await repo.insertCampaign({
        systemId,
        name: 'Campaign A',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });
      const c2 = await repo.insertCampaign({
        systemId,
        name: 'Campaign B',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });

      await repo.insertMember({
        campaignId: c1.id,
        userId: 'u1',
        role: 'owner',
      });
      await repo.insertMember({
        campaignId: c2.id,
        userId: 'u2',
        role: 'owner',
      });

      const u1Campaigns = await repo.findAllForUser('u1');
      expect(u1Campaigns).toHaveLength(1);
      expect(u1Campaigns[0].name).toBe('Campaign A');

      const u2Campaigns = await repo.findAllForUser('u2');
      expect(u2Campaigns).toHaveLength(1);
      expect(u2Campaigns[0].name).toBe('Campaign B');
    });

    it('returns empty array when user has no campaigns', async () => {
      await seedUser('u1', 'alice@example.com');
      const campaigns = await repo.findAllForUser('u1');
      expect(campaigns).toHaveLength(0);
    });
  });

  describe('insertState', () => {
    it('inserts campaign state', async () => {
      const systemId = await seedMothershipSystem();
      const campaign = await repo.insertCampaign({
        systemId,
        name: 'Test',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });

      // Should not throw
      await repo.insertState({
        campaignId: campaign.id,
        system: 'mothership',
        data: {
          schemaVersion: 1,
          resourcePools: {},
          entities: {},
          flags: {},
          scenarioState: {},
          worldFacts: {},
        },
      });
    });
  });
});
