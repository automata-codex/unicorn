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

import { SessionRepository } from './session.repository';

let repo: SessionRepository;

beforeAll(async () => {
  await setupTestDb();
  const canonRepo = new CanonRepository(getTestDb() as never);
  repo = new SessionRepository(getTestDb() as never, canonRepo);
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

  describe('listDiceRollEvents', () => {
    it('returns createdAt as a real Date, not a driver string', async () => {
      // Regression test: this method reads via raw `db.execute`, which
      // bypasses Drizzle's column-type mapping — node-postgres hands back
      // timestamptz as Postgres's text representation, not a Date, unless
      // explicitly parsed. Downstream code (SessionService.listDiceRolls)
      // calls `.toISOString()` on this field and crashed in production
      // once an adventure had at least one dice_roll event.
      const { campaignId, adventureId } = await seedFixture();
      const request = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 1,
          notation: '1d100',
          purpose: 'test prompt',
          target: 65,
        }),
      );
      await repo.applyDiceResultAtomic({
        adventureId,
        campaignId,
        requestId: request.id,
        actorUserId: 'u1',
        source: 'player_entered',
        payload: {
          notation: '1d100',
          purpose: 'test prompt',
          results: [34],
          modifier: 0,
          total: 34,
        },
      });

      const [roll] = await repo.listDiceRollEvents(adventureId);

      expect(roll).toBeDefined();
      expect(roll.createdAt).toBeInstanceOf(Date);
      expect(() => roll.createdAt.toISOString()).not.toThrow();
    });

    it('excludes GM/NPC rolls from the inner tool loop', async () => {
      // GM rolls are written by `writeTurnEvents` with actor_type 'gm' and
      // no `requestId` in the payload (they don't resolve a dice_request).
      // They're mechanical/narrative-support rolls, not something the
      // player submitted, and shouldn't appear in the chat log.
      const { campaignId, adventureId } = await seedFixture();
      const request = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 1,
          notation: '1d100',
          purpose: 'test prompt',
          target: 65,
        }),
      );
      await repo.applyDiceResultAtomic({
        adventureId,
        campaignId,
        requestId: request.id,
        actorUserId: 'u1',
        source: 'player_entered',
        payload: {
          notation: '1d100',
          purpose: 'test prompt',
          results: [34],
          modifier: 0,
          total: 34,
        },
      });
      await getTestDb()
        .insert(schema.gameEvents)
        .values({
          adventureId,
          campaignId,
          sequenceNumber: 2,
          eventType: 'dice_roll',
          actorType: 'gm',
          actorId: null,
          rollSource: 'system_generated',
          payload: {
            notation: '2d6',
            purpose: 'ambush check',
            results: [4, 5],
            modifier: 0,
            total: 9,
          },
        });

      const rolls = await repo.listDiceRollEvents(adventureId);

      expect(rolls).toHaveLength(1);
      expect(rolls[0].notation).toBe('1d100');
    });
  });
});
