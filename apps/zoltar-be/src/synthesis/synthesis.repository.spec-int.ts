import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import { CanonRepository } from '../canon/canon.repository';
import * as schema from '../db/schema';

import { SynthesisRepository } from './synthesis.repository';

let repo: SynthesisRepository;

beforeAll(async () => {
  await setupTestDb();
  const canonRepo = new CanonRepository(getTestDb() as never);
  repo = new SynthesisRepository(getTestDb() as never, canonRepo);
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
  await db.insert(schema.campaignStates).values({
    campaignId: campaign.id,
    system: 'mothership',
    data: {
      schemaVersion: 1,
      resourcePools: { vasquez_hp: { current: 15, max: 15 } },
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    },
  });
  const [adventure] = await db
    .insert(schema.adventures)
    .values({
      campaignId: campaign.id,
      callerId: 'u1',
      status: 'synthesizing',
    })
    .returning();
  return { campaignId: campaign.id, adventureId: adventure.id };
}

describe('SynthesisRepository (integration)', () => {
  it('getCampaignStateData returns the seeded state data', async () => {
    const { campaignId } = await seedFixture();
    const data = await repo.getCampaignStateData(campaignId);
    expect(data).not.toBeNull();
    expect(
      (data as { resourcePools: Record<string, unknown> }).resourcePools,
    ).toHaveProperty('vasquez_hp');
  });

  it('getCampaignStateData returns null for an unknown campaign', async () => {
    await seedFixture();
    const data = await repo.getCampaignStateData(
      '00000000-0000-0000-0000-000000000000',
    );
    expect(data).toBeNull();
  });

  describe('writeGmContextAtomic', () => {
    it('writes gm_context, upserts campaign_state, inserts grid_entity, flips status, and auto-promotes canon', async () => {
      const db = getTestDb();
      const { campaignId, adventureId } = await seedFixture();

      // Seed a pending canon row to exercise the auto-promote.
      await db.insert(schema.pendingCanon).values({
        adventureId,
        summary: 'NPC motivation',
        context: 'ctx',
        status: 'pending',
      });

      const campaignStateData = {
        schemaVersion: 1,
        resourcePools: {
          vasquez_hp: { current: 15, max: 15 },
          dr_chen_hp: { current: 10, max: 10 },
        },
        entities: {
          dr_chen: { visible: true, status: 'unknown' as const },
        },
        flags: {
          adventure_complete: {
            value: false,
            trigger: 'Escape the vessel.',
          },
        },
        scenarioState: {},
        worldFacts: {},
      };
      const gmContextBlob = {
        openingNarration: 'Amber lights pulse.',
        narrative: { location: 'loc' },
        entities: [{ id: 'dr_chen' }],
      };

      await repo.writeGmContextAtomic({
        adventureId,
        campaignId,
        gmContextBlob,
        campaignStateData,
        gridEntities: [
          {
            entityRef: 'dr_chen',
            x: 3,
            y: 4,
            z: 0,
            visible: true,
            tags: ['corporate'],
          },
        ],
      });

      const [gmContextRow] = await db
        .select()
        .from(schema.gmContexts)
        .where(eq(schema.gmContexts.adventureId, adventureId));
      expect(gmContextRow.blob).toMatchObject(gmContextBlob);

      const [stateRow] = await db
        .select()
        .from(schema.campaignStates)
        .where(eq(schema.campaignStates.campaignId, campaignId));
      expect(
        (stateRow.data as typeof campaignStateData).resourcePools.dr_chen_hp,
      ).toEqual({ current: 10, max: 10 });
      expect(
        (stateRow.data as typeof campaignStateData).flags.adventure_complete
          .trigger,
      ).toBe('Escape the vessel.');

      const gridRows = await db
        .select()
        .from(schema.gridEntities)
        .where(eq(schema.gridEntities.campaignId, campaignId));
      expect(gridRows).toHaveLength(1);
      expect(gridRows[0].entityRef).toBe('dr_chen');
      expect(gridRows[0].x).toBe(3);
      expect(gridRows[0].tags).toEqual(['corporate']);

      const [advRow] = await db
        .select()
        .from(schema.adventures)
        .where(eq(schema.adventures.id, adventureId));
      expect(advRow.status).toBe('ready');

      const canonRows = await db
        .select()
        .from(schema.pendingCanon)
        .where(eq(schema.pendingCanon.adventureId, adventureId));
      expect(canonRows).toHaveLength(1);
      expect(canonRows[0].status).toBe('promoted');
      expect(canonRows[0].reviewedAt).not.toBeNull();
    });

    it('does not insert grid_entity rows when none are provided', async () => {
      const db = getTestDb();
      const { campaignId, adventureId } = await seedFixture();

      await repo.writeGmContextAtomic({
        adventureId,
        campaignId,
        gmContextBlob: { openingNarration: null },
        campaignStateData: {
          schemaVersion: 1,
          resourcePools: {},
          entities: {},
          flags: {
            adventure_complete: {
              value: false,
              trigger: 'Escape.',
            },
          },
          scenarioState: {},
          worldFacts: {},
        },
        gridEntities: [],
      });

      const gridRows = await db
        .select()
        .from(schema.gridEntities)
        .where(eq(schema.gridEntities.campaignId, campaignId));
      expect(gridRows).toHaveLength(0);
    });

    it('rolls back the entire transaction when a child write fails', async () => {
      const db = getTestDb();
      const { campaignId, adventureId } = await seedFixture();

      // Inject a duplicate pending_canon row with an illegal state reference
      // to force rollback: pass a grid entity with a null required column.
      await expect(
        repo.writeGmContextAtomic({
          adventureId,
          campaignId,
          gmContextBlob: { openingNarration: null },
          campaignStateData: {
            schemaVersion: 1,
            resourcePools: {},
            entities: {},
            flags: {},
            scenarioState: {},
            worldFacts: {},
          },
          gridEntities: [
            {
              // entityRef is NOT NULL in the DB — pass empty string isn't enough,
              // but an undefined-laden cast forces a constraint violation.
              entityRef: undefined as unknown as string,
              x: 1,
              y: 1,
              z: 0,
              visible: true,
              tags: [],
            },
          ],
        }),
      ).rejects.toThrow();

      // Adventure status must be unchanged — still synthesizing.
      const [advRow] = await db
        .select()
        .from(schema.adventures)
        .where(eq(schema.adventures.id, adventureId));
      expect(advRow.status).toBe('synthesizing');

      // No gm_context row was persisted.
      const gmContextRows = await db
        .select()
        .from(schema.gmContexts)
        .where(eq(schema.gmContexts.adventureId, adventureId));
      expect(gmContextRows).toHaveLength(0);
    });
  });

  describe('setAdventureFailed', () => {
    it('flips status to failed and writes the error blob', async () => {
      const db = getTestDb();
      const { adventureId } = await seedFixture();

      await repo.setAdventureFailed(adventureId, 'deadlock detected');

      const [advRow] = await db
        .select()
        .from(schema.adventures)
        .where(eq(schema.adventures.id, adventureId));
      expect(advRow.status).toBe('failed');

      const [gmContextRow] = await db
        .select()
        .from(schema.gmContexts)
        .where(eq(schema.gmContexts.adventureId, adventureId));
      expect(gmContextRow.blob).toEqual({ error: 'deadlock detected' });
    });

    it('does not write a gm_context row when no detail is supplied', async () => {
      const db = getTestDb();
      const { adventureId } = await seedFixture();

      await repo.setAdventureFailed(adventureId);

      const rows = await db
        .select()
        .from(schema.gmContexts)
        .where(eq(schema.gmContexts.adventureId, adventureId));
      expect(rows).toHaveLength(0);
    });
  });
});
