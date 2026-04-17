import { asc, eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  getTestDb,
  setupTestDb,
  teardownTestDb,
  truncateAll,
} from '../../test/db-test-helper';
import * as schema from '../db/schema';

import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../anthropic/anthropic.service';

let repo: SessionRepository;

beforeAll(async () => {
  await setupTestDb();
  repo = new SessionRepository(getTestDb() as never);
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

function toolUseMessage(input: unknown): Anthropic.Message {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_fake',
        name: 'submit_gm_response',
        input,
      } as unknown as Anthropic.ToolUseBlock,
    ],
  } as unknown as Anthropic.Message;
}

function mockAnthropic(
  callSession: ReturnType<typeof vi.fn>,
): AnthropicService {
  return { callSession } as unknown as AnthropicService;
}

async function seedReadyAdventure(): Promise<{
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
  await db.insert(schema.characterSheets).values({
    campaignId: campaign.id,
    userId: 'u1',
    system: 'mothership',
    data: {
      entityId: 'dr_chen',
      name: 'Dr. Chen',
      class: 'scientist',
      stats: {
        strength: 30,
        speed: 30,
        intellect: 50,
        combat: 30,
        instinct: 30,
        sanity: 30,
      },
      saves: { fear: 30, body: 30, armor: 0, armorMax: 0 },
      maxHp: 10,
      maxStress: 20,
    },
  });
  await db.insert(schema.campaignStates).values({
    campaignId: campaign.id,
    system: 'mothership',
    data: {
      schemaVersion: 1,
      resourcePools: { dr_chen_hp: { current: 10, max: 10 } },
      entities: {},
      flags: {
        adventure_complete: { value: false, trigger: 'Escape.' },
      },
      scenarioState: {},
      worldFacts: {},
    },
  });
  const [adventure] = await db
    .insert(schema.adventures)
    .values({
      campaignId: campaign.id,
      callerId: 'u1',
      status: 'ready',
    })
    .returning();
  await db.insert(schema.gmContexts).values({
    adventureId: adventure.id,
    blob: {
      narrative: {
        location: 'Derelict freighter',
        atmosphere: 'dim',
        npcAgendas: {},
        hiddenTruth: 'truth',
        oracleConnections: 'conn',
      },
      entities: [],
      structured: {
        flags: {
          adventure_complete: { value: false, trigger: 'Escape.' },
        },
      },
    },
  });
  return { campaignId: campaign.id, adventureId: adventure.id };
}

describe('SessionService (integration)', () => {
  it('persists player + GM messages and returns parsed proposals on happy path', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    const callSession = vi.fn().mockResolvedValue(
      toolUseMessage({
        playerText: 'The airlock hisses open.',
        stateChanges: {
          resourcePools: { dr_chen_hp: { delta: -2 } },
          flags: { airlock_sealed: { value: false } },
        },
      }),
    );
    const service = new SessionService(repo, mockAnthropic(callSession));

    const result = await service.sendMessage({
      adventureId,
      campaignId,
      playerMessage: 'I open the airlock.',
    });

    expect(result.message.role).toBe('gm');
    expect(result.message.content).toBe('The airlock hisses open.');
    expect(result.proposals.stateChanges?.resourcePools?.dr_chen_hp.delta).toBe(
      -2,
    );

    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.adventureId, adventureId))
      .orderBy(asc(schema.messages.createdAt));
    expect(rows).toHaveLength(2);
    expect(rows[0].role).toBe('player');
    expect(rows[0].content).toBe('I open the airlock.');
    expect(rows[1].role).toBe('gm');
    expect(rows[1].content).toBe('The airlock hisses open.');
  });

  it('does not mutate campaign_state.data or create pending_canon rows', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    const [stateBefore] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));

    const callSession = vi.fn().mockResolvedValue(
      toolUseMessage({
        playerText: 'Nothing happens.',
        stateChanges: {
          resourcePools: { dr_chen_hp: { delta: -5 } },
          worldFacts: { corridor_length: 'eight meters' },
        },
        gmUpdates: {
          proposedCanon: [
            { summary: 'Ship has a brig.', context: 'Cell door.' },
          ],
        },
      }),
    );
    const service = new SessionService(repo, mockAnthropic(callSession));

    await service.sendMessage({
      adventureId,
      campaignId,
      playerMessage: 'I wait.',
    });

    const [stateAfter] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));
    expect(stateAfter.data).toEqual(stateBefore.data);

    const pending = await db
      .select()
      .from(schema.pendingCanon)
      .where(eq(schema.pendingCanon.adventureId, adventureId));
    expect(pending).toHaveLength(0);

    const events = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId));
    expect(events).toHaveLength(0);
  });

  it('passes prior messages in chronological order with DB roles mapped', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    await db.insert(schema.messages).values([
      {
        adventureId,
        role: 'player',
        content: 'First input.',
        createdAt: new Date('2026-04-17T11:00:00Z'),
      },
      {
        adventureId,
        role: 'gm',
        content: 'First response.',
        createdAt: new Date('2026-04-17T11:00:01Z'),
      },
    ]);

    const callSession = vi
      .fn()
      .mockResolvedValue(toolUseMessage({ playerText: 'Second response.' }));
    const service = new SessionService(repo, mockAnthropic(callSession));

    await service.sendMessage({
      adventureId,
      campaignId,
      playerMessage: 'Second input.',
    });

    const sentMessages = callSession.mock.calls[0][0].messages as Array<{
      role: string;
      content: string;
    }>;
    // [0] snapshot, [1] first player → user, [2] first GM → assistant, [3] new player
    expect(sentMessages).toHaveLength(4);
    expect(sentMessages[1]).toEqual({
      role: 'user',
      content: 'First input.',
    });
    expect(sentMessages[2]).toEqual({
      role: 'assistant',
      content: 'First response.',
    });
    expect(sentMessages[3]).toEqual({
      role: 'user',
      content: 'Second input.',
    });
  });
});
