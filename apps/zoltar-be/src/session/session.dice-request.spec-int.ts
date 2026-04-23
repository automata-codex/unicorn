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
  adventureId: string;
  otherAdventureId: string;
}> {
  const db = getTestDb();
  const [system] = await db
    .insert(schema.gameSystems)
    .values({ slug: 'mothership', name: 'Mothership', indexSource: 'user_provided' })
    .returning();
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      systemId: system.id,
      name: 'Test',
      visibility: 'private',
      diceMode: 'soft_accountability',
    })
    .returning();
  await db.insert(schema.users).values({ id: 'u1', email: 'u1@x.test' });
  await db.insert(schema.campaignMembers).values({
    campaignId: campaign.id,
    userId: 'u1',
    role: 'owner',
  });
  const [adv] = await db
    .insert(schema.adventures)
    .values({ campaignId: campaign.id, callerId: 'u1', status: 'in_progress' })
    .returning();
  const [otherAdv] = await db
    .insert(schema.adventures)
    .values({ campaignId: campaign.id, callerId: 'u1', status: 'in_progress' })
    .returning();
  return { adventureId: adv.id, otherAdventureId: otherAdv.id };
}

describe('SessionRepository dice_request methods (integration)', () => {
  describe('insertDiceRequest', () => {
    it('inserts a pending row with the supplied fields', async () => {
      const { adventureId } = await seedFixture();

      const row = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 4,
          notation: '1d100',
          purpose: 'Intellect save to interpret corrupted data',
          target: 65,
        }),
      );

      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(row.status).toBe('pending');
      expect(row.notation).toBe('1d100');
      expect(row.purpose).toBe('Intellect save to interpret corrupted data');
      expect(row.target).toBe(65);
      expect(row.issuedAtSequence).toBe(4);
      expect(row.resolvedAt).toBeNull();
      expect(row.resolvedAtSequence).toBeNull();
    });

    it('accepts a null target (commitment mode)', async () => {
      const { adventureId } = await seedFixture();

      const row = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 2,
          notation: '1d100',
          purpose: 'Hidden save',
          target: null,
        }),
      );

      expect(row.target).toBeNull();
    });
  });

  describe('loadDiceRequest', () => {
    it('returns the row for a known id', async () => {
      const { adventureId } = await seedFixture();
      const inserted = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 2,
          notation: '1d100',
          purpose: 'x',
          target: null,
        }),
      );

      const row = await repo.loadDiceRequest(inserted.id);

      expect(row?.id).toBe(inserted.id);
      expect(row?.status).toBe('pending');
    });

    it('returns null for an unknown id', async () => {
      const row = await repo.loadDiceRequest(
        '00000000-0000-0000-0000-000000000000',
      );
      expect(row).toBeNull();
    });
  });

  describe('resolveDiceRequest', () => {
    it('transitions pending → resolved with the resolving sequence and timestamp', async () => {
      const { adventureId } = await seedFixture();
      const inserted = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 2,
          notation: '1d100',
          purpose: 'x',
          target: null,
        }),
      );

      await getTestDb().transaction(async (tx) =>
        repo.resolveDiceRequest({
          tx,
          id: inserted.id,
          resolvedAtSequence: 5,
        }),
      );

      const [row] = await getTestDb()
        .select()
        .from(schema.diceRequests)
        .where(eq(schema.diceRequests.id, inserted.id));

      expect(row.status).toBe('resolved');
      expect(row.resolvedAtSequence).toBe(5);
      expect(row.resolvedAt).not.toBeNull();
    });
  });

  describe('pendingDiceRequestsForAdventure', () => {
    it('returns only pending rows for the given adventure, ordered by issue sequence', async () => {
      const { adventureId, otherAdventureId } = await seedFixture();

      // Three requests on the target adventure (one resolved) and one on
      // another adventure to assert the filter.
      const r1 = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 10,
          notation: '1d100',
          purpose: 'A',
          target: null,
        }),
      );
      const r2 = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 2,
          notation: '1d100',
          purpose: 'B',
          target: null,
        }),
      );
      const r3 = await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId,
          issuedAtSequence: 5,
          notation: '1d100',
          purpose: 'C',
          target: null,
        }),
      );
      await getTestDb().transaction(async (tx) =>
        repo.insertDiceRequest({
          tx,
          adventureId: otherAdventureId,
          issuedAtSequence: 1,
          notation: '1d100',
          purpose: 'other',
          target: null,
        }),
      );
      await getTestDb().transaction(async (tx) =>
        repo.resolveDiceRequest({
          tx,
          id: r3.id,
          resolvedAtSequence: 6,
        }),
      );

      const pending = await repo.pendingDiceRequestsForAdventure(adventureId);

      // r2 (seq 2) and r1 (seq 10), ordered ascending; r3 excluded (resolved);
      // other-adventure row excluded.
      expect(pending.map((r) => r.id)).toEqual([r2.id, r1.id]);
    });

    it('returns an empty array when no pending requests exist', async () => {
      const { adventureId } = await seedFixture();
      const pending = await repo.pendingDiceRequestsForAdventure(adventureId);
      expect(pending).toEqual([]);
    });
  });
});
