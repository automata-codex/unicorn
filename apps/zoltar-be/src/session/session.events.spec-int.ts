import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import * as schema from '../db/schema';

import {
  insertDiceRollEvent,
  nextSequenceNumber,
  writeTurnEvents,
} from './session.events';

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
  diceRequests: [],
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

    const { gmResponseEventId, correctionEventId } =
      await getTestDb().transaction(async (tx) =>
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

  it('inserts a system-generated dice_roll event with the expected shape', async () => {
    const { campaignId, adventureId } = await seedFixture();

    const { id } = await getTestDb().transaction(async (tx) => {
      const seq = await nextSequenceNumber(tx, adventureId);
      return insertDiceRollEvent({
        tx,
        adventureId,
        campaignId,
        sequenceNumber: seq,
        actorType: 'gm',
        actorId: null,
        rollSource: 'system_generated',
        payload: {
          notation: '1d100',
          purpose: 'Panic check for Dr. Chen',
          results: [73],
          modifier: 0,
          total: 73,
        },
      });
    });

    const [row] = await getTestDb()
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.id, id));

    expect(row.eventType).toBe('dice_roll');
    expect(row.actorType).toBe('gm');
    expect(row.actorId).toBeNull();
    expect(row.rollSource).toBe('system_generated');
    expect(row.sequenceNumber).toBe(1);
    expect(row.payload).toMatchObject({
      notation: '1d100',
      purpose: 'Panic check for Dr. Chen',
      results: [73],
      modifier: 0,
      total: 73,
    });
  });

  it('inserts a player-entered dice_roll event with actor_id and requestId', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();

    const { id } = await getTestDb().transaction(async (tx) => {
      const seq = await nextSequenceNumber(tx, adventureId);
      return insertDiceRollEvent({
        tx,
        adventureId,
        campaignId,
        sequenceNumber: seq,
        actorType: 'player',
        actorId: userId,
        rollSource: 'player_entered',
        payload: {
          notation: '1d100',
          purpose: 'Intellect save',
          results: [34],
          modifier: 0,
          total: 34,
          requestId: '00000000-0000-0000-0000-000000000abc',
        },
      });
    });

    const [row] = await getTestDb()
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.id, id));

    expect(row.eventType).toBe('dice_roll');
    expect(row.actorType).toBe('player');
    expect(row.actorId).toBe(userId);
    expect(row.rollSource).toBe('player_entered');
    expect(row.payload).toMatchObject({
      notation: '1d100',
      results: [34],
      total: 34,
      requestId: '00000000-0000-0000-0000-000000000abc',
    });
  });

  it('interleaves dice_roll events between player_action and gm_response', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();

    await getTestDb().transaction(async (tx) => {
      // player_action at seq 1 (would be written by writeTurnEvents's
      // first insert; we simulate the inner-loop ordering here).
      const playerSeq = await nextSequenceNumber(tx, adventureId);
      await tx.insert(schema.gameEvents).values({
        adventureId,
        campaignId,
        sequenceNumber: playerSeq,
        eventType: 'player_action',
        actorType: 'player',
        actorId: userId,
        payload: { content: 'Proceed.' },
      });

      // Two dice_roll events from the inner tool loop at seq 2 and 3.
      for (const total of [12, 55]) {
        const seq = await nextSequenceNumber(tx, adventureId);
        await insertDiceRollEvent({
          tx,
          adventureId,
          campaignId,
          sequenceNumber: seq,
          actorType: 'gm',
          actorId: null,
          rollSource: 'system_generated',
          payload: {
            notation: '1d100',
            purpose: 'roll',
            results: [total],
            modifier: 0,
            total,
          },
        });
      }

      // gm_response at seq 4.
      const gmSeq = await nextSequenceNumber(tx, adventureId);
      await tx.insert(schema.gameEvents).values({
        adventureId,
        campaignId,
        sequenceNumber: gmSeq,
        eventType: 'gm_response',
        actorType: 'gm',
        actorId: null,
        payload: { playerText: 'You resist the pressure loss.' },
      });
    });

    const rows = await getTestDb()
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId))
      .orderBy(asc(schema.gameEvents.sequenceNumber));

    expect(rows.map((r) => r.eventType)).toEqual([
      'player_action',
      'dice_roll',
      'dice_roll',
      'gm_response',
    ]);
    expect(rows.map((r) => r.sequenceNumber)).toEqual([1, 2, 3, 4]);
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
