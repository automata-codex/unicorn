import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema';
import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../test/db-test-helper';

import { parseFixture } from './fixture';
import {
  findPrereqs,
  readToolSyntaxLeaks,
  seedScratch,
  teardownScratch,
} from './replay';

// Seeding and teardown only. The turn itself makes a real Anthropic call and
// is exercised by a one-rep `task ev2:run`, never from here.

beforeAll(() => setupTestDb());
afterAll(() => teardownTestDb());
beforeEach(() => truncateAll());

async function seedPrereqRows(): Promise<void> {
  const db = getTestDb();
  await db.insert(schema.gameSystems).values({
    slug: 'mothership',
    name: 'Mothership',
    indexSource: 'user_provided',
  });
  await db.insert(schema.users).values({ id: 'u1', email: 'alice@x.test' });
}

const fixture = parseFixture(
  {
    id: 'replay-test-fixture',
    playerInput: { type: 'message', content: 'I look around.' },
    seededState: {
      campaignState: { schemaVersion: 1, worldFacts: { layout: 'one deck' } },
      gmContextBlob: {
        playerEntityIds: ['danny', 'danny_alias'],
        openingNarration: 'Dark.',
      },
      messages: [
        { role: 'gm', content: 'Dark.', createdAt: '2026-08-24T21:00:00.000Z' },
        {
          role: 'player',
          content: 'Hello?',
          createdAt: '2026-08-24T21:01:00.000Z',
        },
      ],
      pendingCanon: [
        {
          summary: 'The lights are out.',
          context: 'opening',
          status: 'pending',
          sequenceNumber: 1,
        },
      ],
      pendingDiceRequests: [],
    },
  },
  'replay-test-fixture',
);

describe('findPrereqs', () => {
  it('names what is missing', async () => {
    const db = getTestDb();
    await expect(findPrereqs(db)).rejects.toThrow(/mothership/);

    await db.insert(schema.gameSystems).values({
      slug: 'mothership',
      name: 'Mothership',
      indexSource: 'user_provided',
    });
    await expect(findPrereqs(db)).rejects.toThrow(/no user row/);
  });
});

describe('seedScratch and teardownScratch', () => {
  it('writes the fixture state under a named scratch campaign', async () => {
    const db = getTestDb();
    await seedPrereqRows();
    const prereqs = await findPrereqs(db);

    const scratch = await seedScratch(db, fixture, prereqs, '__ev2__test');

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, scratch.campaignId));
    expect(campaign.name).toBe('__ev2__test');

    const [state] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, scratch.campaignId));
    expect(state.data).toEqual(fixture.seededState.campaignState);

    const [context] = await db
      .select()
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, scratch.adventureId));
    expect(context.blob).toEqual(fixture.seededState.gmContextBlob);

    // Exactly one sheet, carrying the first declared id.
    const sheets = await db
      .select()
      .from(schema.characterSheets)
      .where(eq(schema.characterSheets.campaignId, scratch.campaignId));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].data).toEqual({ entityId: 'danny' });
    expect(sheets[0].userId).toBe('u1');

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.adventureId, scratch.adventureId))
      .orderBy(schema.messages.createdAt);
    expect(messages.map((m) => m.content)).toEqual(['Dark.', 'Hello?']);
    expect(messages[0].createdAt.toISOString()).toBe(
      '2026-08-24T21:00:00.000Z',
    );

    const canon = await db
      .select()
      .from(schema.pendingCanon)
      .where(eq(schema.pendingCanon.adventureId, scratch.adventureId));
    expect(canon).toHaveLength(1);
  });

  it('leaves nothing behind after teardown, and keeps the prereq rows', async () => {
    const db = getTestDb();
    await seedPrereqRows();
    const prereqs = await findPrereqs(db);
    const scratch = await seedScratch(db, fixture, prereqs, '__ev2__test');

    await teardownScratch(db, scratch.campaignId);

    for (const table of [
      schema.campaigns,
      schema.campaignMembers,
      schema.campaignStates,
      schema.adventures,
      schema.gmContexts,
      schema.characterSheets,
      schema.messages,
      schema.pendingCanon,
    ]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    expect(await db.select().from(schema.users)).toHaveLength(1);
    expect(await db.select().from(schema.gameSystems)).toHaveLength(1);
  });
});

describe('readToolSyntaxLeaks', () => {
  it("returns the latest telemetry row's leaks, and none when there is no row", async () => {
    const db = getTestDb();
    await seedPrereqRows();
    const prereqs = await findPrereqs(db);
    const scratch = await seedScratch(db, fixture, prereqs, '__ev2__test');

    expect(await readToolSyntaxLeaks(db, scratch.adventureId)).toEqual([]);

    const leak = {
      pass: 'tool_loop',
      rawInput: { playerText: 'x</playerText>' },
      outcome: 'rejected',
    };
    await db.insert(schema.adventureTelemetry).values([
      { adventureId: scratch.adventureId, sequenceNumber: 1, payload: {} },
      {
        adventureId: scratch.adventureId,
        sequenceNumber: 2,
        payload: { toolSyntaxLeaks: [leak] },
      },
    ]);

    expect(await readToolSyntaxLeaks(db, scratch.adventureId)).toEqual([leak]);
  });
});
