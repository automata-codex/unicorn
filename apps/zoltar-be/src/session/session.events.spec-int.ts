import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import * as schema from '../db/schema';

import { writeTurnEvents } from './session.events';

import type { SubmitGmResponse } from './session.schema';
import type { ValidationResult } from './session.validator';

beforeAll(async () => {
  await setupTestDb();
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
  userId: string;
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
  return { campaignId: campaign.id, adventureId: adventure.id, userId: 'u1' };
}

const baseGmResponse: SubmitGmResponse = {
  playerText: 'The door groans open.',
  stateChanges: { resourcePools: { dr_chen_hp: { delta: -1 } } },
  gmUpdates: { npcStates: {}, proposedCanon: [] },
  playerRolls: [],
  adventureMode: null,
};

const emptyApplied: ValidationResult['applied'] = {
  resourcePools: { dr_chen_hp: { current: 9, max: 10 } },
  entities: {},
  flags: {},
  scenarioState: {},
  worldFacts: {},
};

describe('writeTurnEvents (integration)', () => {
  it('writes three events on the happy path with contiguous sequence numbers', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();

    await getTestDb().transaction(async (tx) => {
      await writeTurnEvents({
        tx,
        adventureId,
        campaignId,
        playerUserId: userId,
        playerAction: { content: 'Open the door.' },
        gmResponse: baseGmResponse,
        applied: emptyApplied,
        thresholds: [],
      });
    });

    const rows = await getTestDb()
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId))
      .orderBy(asc(schema.gameEvents.sequenceNumber));

    expect(rows.map((r) => r.eventType)).toEqual([
      'player_action',
      'gm_response',
      'state_update',
    ]);
    expect(rows.map((r) => r.sequenceNumber)).toEqual([1, 2, 3]);
    expect(rows[0].actorType).toBe('player');
    expect(rows[0].actorId).toBe(userId);
    expect(rows[1].actorType).toBe('gm');
    expect(rows[1].supersededBy).toBeNull();
    expect(rows[2].actorType).toBe('system');
  });

  it('writes four events on the correction path with contiguous sequence numbers', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();

    await getTestDb().transaction(async (tx) => {
      await writeTurnEvents({
        tx,
        adventureId,
        campaignId,
        playerUserId: userId,
        playerAction: { content: 'Fire twice.' },
        gmResponse: baseGmResponse,
        correction: {
          ...baseGmResponse,
          playerText: 'Corrected narration.',
        },
        applied: emptyApplied,
        thresholds: [],
      });
    });

    const rows = await getTestDb()
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId))
      .orderBy(asc(schema.gameEvents.sequenceNumber));

    expect(rows.map((r) => r.eventType)).toEqual([
      'player_action',
      'gm_response',
      'correction',
      'state_update',
    ]);
    expect(rows.map((r) => r.sequenceNumber)).toEqual([1, 2, 3, 4]);
  });

  it('links gm_response.superseded_by to the correction row id', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();

    const { gmResponseEventId, correctionEventId } = await getTestDb().transaction(
      async (tx) =>
        writeTurnEvents({
          tx,
          adventureId,
          campaignId,
          playerUserId: userId,
          playerAction: { content: 'Fire twice.' },
          gmResponse: baseGmResponse,
          correction: {
            ...baseGmResponse,
            playerText: 'Corrected narration.',
          },
          applied: emptyApplied,
          thresholds: [],
        }),
    );

    expect(correctionEventId).toBeDefined();

    const [gmRow] = await getTestDb()
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.id, gmResponseEventId));
    expect(gmRow.supersededBy).toBe(correctionEventId);

    const [corrRow] = await getTestDb()
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.id, correctionEventId!));
    expect(corrRow.supersededBy).toBeNull();
  });

  it('serializes concurrent writers against the same adventure', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();

    const runTurn = () =>
      getTestDb().transaction(async (tx) =>
        writeTurnEvents({
          tx,
          adventureId,
          campaignId,
          playerUserId: userId,
          playerAction: { content: 'parallel action' },
          gmResponse: baseGmResponse,
          applied: emptyApplied,
          thresholds: [],
        }),
      );

    await Promise.all([runTurn(), runTurn()]);

    const rows = await getTestDb()
      .select({ seq: schema.gameEvents.sequenceNumber })
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId))
      .orderBy(asc(schema.gameEvents.sequenceNumber));

    const sequences = rows.map((r) => r.seq);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(sequences).size).toBe(sequences.length);
  });
});
