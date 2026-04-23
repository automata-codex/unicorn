import { emptyMothershipState } from '@uv/game-systems';
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
import { CampaignRepository } from '../campaign/campaign.repository';
import { CanonRepository } from '../canon/canon.repository';
import * as schema from '../db/schema';

import { nextSequenceNumber } from './session.events';
import { SessionRepository } from './session.repository';
import {
  DicePendingError,
  DiceResultConflictError,
  DiceResultValidationError,
  SessionService,
} from './session.service';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../anthropic/anthropic.service';
import type { DiceService } from '../dice/dice.service';
import type { RulesLookupService } from '../rules/rules-lookup.service';

let repo: SessionRepository;
let campaignRepo: CampaignRepository;

beforeAll(async () => {
  await setupTestDb();
  const canonRepo = new CanonRepository(getTestDb() as never);
  repo = new SessionRepository(getTestDb() as never, canonRepo);
  campaignRepo = new CampaignRepository(getTestDb() as never);
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

function stubDice(): DiceService {
  return {
    rollForGm: vi.fn(() => {
      throw new Error('unused');
    }),
  } as unknown as DiceService;
}

function stubRules(): RulesLookupService {
  return {
    lookup: vi.fn().mockResolvedValue({ results: [] }),
  } as unknown as RulesLookupService;
}

function mockAnthropic(callSession: ReturnType<typeof vi.fn>): AnthropicService {
  return { callSession } as unknown as AnthropicService;
}

async function seedFixture(): Promise<{
  campaignId: string;
  adventureId: string;
  otherAdventureId: string;
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
      name: 'Test',
      visibility: 'private',
      diceMode: 'soft_accountability',
    })
    .returning();
  await db
    .insert(schema.campaignStates)
    .values({
      campaignId: campaign.id,
      system: 'mothership',
      data: emptyMothershipState(),
    });
  await db.insert(schema.users).values({ id: 'u1', email: 'u1@x.test' });
  await db.insert(schema.campaignMembers).values({
    campaignId: campaign.id,
    userId: 'u1',
    role: 'owner',
  });
  const [adv] = await db
    .insert(schema.adventures)
    .values({
      campaignId: campaign.id,
      callerId: 'u1',
      status: 'in_progress',
    })
    .returning();
  const [other] = await db
    .insert(schema.adventures)
    .values({
      campaignId: campaign.id,
      callerId: 'u1',
      status: 'in_progress',
    })
    .returning();
  // Seed a gm_context blob so sendMessage-level tests can run.
  await db.insert(schema.gmContexts).values({
    adventureId: adv.id,
    blob: {
      openingNarration: 'x',
      narrative: {
        location: 'loc',
        atmosphere: 'atmo',
        npcAgendas: {},
        hiddenTruth: 'h',
        oracleConnections: 'c',
      },
      entities: [],
      structured: {
        flags: {
          adventure_complete: { value: false, trigger: 'Escape.' },
        },
      },
    },
  });
  // Seed a synthetic prior gm_response event so
  // playerDiceRollsSinceLastGmResponse has a baseline "last gm response" seq.
  await db.insert(schema.gameEvents).values({
    adventureId: adv.id,
    campaignId: campaign.id,
    sequenceNumber: 1,
    eventType: 'gm_response',
    actorType: 'gm',
    actorId: null,
    payload: { playerText: 'prior turn' },
  });
  return {
    campaignId: campaign.id,
    adventureId: adv.id,
    otherAdventureId: other.id,
    userId: 'u1',
  };
}

async function seedRequest(args: {
  adventureId: string;
  notation: string;
  target: number | null;
  issuedAtSequence?: number;
}): Promise<string> {
  const row = await getTestDb().transaction(async (tx) =>
    repo.insertDiceRequest({
      tx,
      adventureId: args.adventureId,
      issuedAtSequence: args.issuedAtSequence ?? 1,
      notation: args.notation,
      purpose: 'test prompt',
      target: args.target,
    }),
  );
  return row.id;
}

function makeService(callSession: ReturnType<typeof vi.fn>) {
  return new SessionService(
    repo,
    mockAnthropic(callSession),
    campaignRepo,
    stubDice(),
    stubRules(),
  );
}

describe('SessionService.submitDiceResult (integration)', () => {
  it('writes a dice_roll event and resolves the dice_request atomically', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();
    const requestId = await seedRequest({
      adventureId,
      notation: '1d100',
      target: 65,
    });
    const service = makeService(vi.fn());

    const result = await service.submitDiceResult({
      adventureId,
      campaignId,
      actorUserId: userId,
      submission: {
        requestId,
        notation: '1d100',
        results: [34],
        source: 'player_entered',
      },
    });

    expect(result.accepted).toBe(true);
    expect(result.pendingRequestIds).toEqual([]);

    const [request] = await getTestDb()
      .select()
      .from(schema.diceRequests)
      .where(eq(schema.diceRequests.id, requestId));
    expect(request.status).toBe('resolved');
    expect(request.resolvedAtSequence).not.toBeNull();
    expect(request.resolvedAt).not.toBeNull();

    const rows = await getTestDb()
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId))
      .orderBy(asc(schema.gameEvents.sequenceNumber));
    const diceRow = rows.find((r) => r.eventType === 'dice_roll');
    expect(diceRow).toBeDefined();
    expect(diceRow!.actorType).toBe('player');
    expect(diceRow!.actorId).toBe(userId);
    expect(diceRow!.rollSource).toBe('player_entered');
    expect(diceRow!.payload).toMatchObject({
      notation: '1d100',
      purpose: 'test prompt',
      results: [34],
      total: 34,
      requestId,
    });
  });

  it('returns remaining pending ids when other requests are still unresolved', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();
    const r1 = await seedRequest({
      adventureId,
      notation: '1d100',
      target: null,
    });
    const r2 = await seedRequest({
      adventureId,
      notation: '1d100',
      target: null,
    });
    const service = makeService(vi.fn());

    const result = await service.submitDiceResult({
      adventureId,
      campaignId,
      actorUserId: userId,
      submission: {
        requestId: r1,
        notation: '1d100',
        results: [50],
        source: 'player_entered',
      },
    });

    expect(result.pendingRequestIds).toEqual([r2]);
  });

  it('throws DiceResultConflictError for an unknown requestId', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();
    const service = makeService(vi.fn());

    await expect(
      service.submitDiceResult({
        adventureId,
        campaignId,
        actorUserId: userId,
        submission: {
          requestId: '00000000-0000-0000-0000-000000000000',
          notation: '1d100',
          results: [50],
          source: 'player_entered',
        },
      }),
    ).rejects.toBeInstanceOf(DiceResultConflictError);
  });

  it('throws DiceResultConflictError when the request belongs to a different adventure', async () => {
    const { campaignId, adventureId, otherAdventureId, userId } =
      await seedFixture();
    // Request is scoped to `otherAdventureId`; submit targets `adventureId`.
    const requestId = await seedRequest({
      adventureId: otherAdventureId,
      notation: '1d100',
      target: null,
    });
    const service = makeService(vi.fn());

    await expect(
      service.submitDiceResult({
        adventureId,
        campaignId,
        actorUserId: userId,
        submission: {
          requestId,
          notation: '1d100',
          results: [50],
          source: 'player_entered',
        },
      }),
    ).rejects.toBeInstanceOf(DiceResultConflictError);
  });

  it('throws DiceResultConflictError when the request was already resolved', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();
    const requestId = await seedRequest({
      adventureId,
      notation: '1d100',
      target: null,
    });
    const service = makeService(vi.fn());

    await service.submitDiceResult({
      adventureId,
      campaignId,
      actorUserId: userId,
      submission: {
        requestId,
        notation: '1d100',
        results: [50],
        source: 'player_entered',
      },
    });

    await expect(
      service.submitDiceResult({
        adventureId,
        campaignId,
        actorUserId: userId,
        submission: {
          requestId,
          notation: '1d100',
          results: [60],
          source: 'player_entered',
        },
      }),
    ).rejects.toBeInstanceOf(DiceResultConflictError);
  });

  it('throws DiceResultValidationError when notation differs from the persisted request', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();
    const requestId = await seedRequest({
      adventureId,
      notation: '1d100',
      target: null,
    });
    const service = makeService(vi.fn());

    await expect(
      service.submitDiceResult({
        adventureId,
        campaignId,
        actorUserId: userId,
        submission: {
          requestId,
          notation: '2d6',
          results: [3, 4],
          source: 'player_entered',
        },
      }),
    ).rejects.toBeInstanceOf(DiceResultValidationError);
  });

  it('throws DiceResultValidationError when the number of results is wrong', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();
    const requestId = await seedRequest({
      adventureId,
      notation: '2d6',
      target: null,
    });
    const service = makeService(vi.fn());

    await expect(
      service.submitDiceResult({
        adventureId,
        campaignId,
        actorUserId: userId,
        submission: {
          requestId,
          notation: '2d6',
          results: [3], // expected 2 results
          source: 'player_entered',
        },
      }),
    ).rejects.toBeInstanceOf(DiceResultValidationError);
  });

  it('throws DiceResultValidationError when a result is out of per-die range', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();
    const requestId = await seedRequest({
      adventureId,
      notation: '1d100',
      target: null,
    });
    const service = makeService(vi.fn());

    await expect(
      service.submitDiceResult({
        adventureId,
        campaignId,
        actorUserId: userId,
        submission: {
          requestId,
          notation: '1d100',
          results: [150], // out of range
          source: 'player_entered',
        },
      }),
    ).rejects.toBeInstanceOf(DiceResultValidationError);
  });
});

describe('SessionService narrative guard (integration)', () => {
  it('throws DicePendingError when any dice_request is still pending', async () => {
    const { campaignId, adventureId } = await seedFixture();
    const requestId = await seedRequest({
      adventureId,
      notation: '1d100',
      target: null,
    });
    const service = makeService(vi.fn());

    try {
      await service.sendMessage({
        adventureId,
        campaignId,
        playerUserId: 'u1',
        playerMessage: 'I press on.',
      });
      expect.fail('expected DicePendingError');
    } catch (err) {
      expect(err).toBeInstanceOf(DicePendingError);
      expect((err as DicePendingError).pendingRequestIds).toEqual([requestId]);
    }
  });
});

describe('playerDiceRollsSinceLastGmResponse (integration)', () => {
  it('returns rolls resolved after the most recent gm_response, in order', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();

    // Seed two requests; resolve both; one via submitDiceResult, one via
    // direct repo call. Both should appear in the result.
    const r1 = await seedRequest({
      adventureId,
      notation: '1d100',
      target: 65,
    });
    const r2 = await seedRequest({
      adventureId,
      notation: '2d6',
      target: null,
    });
    const service = makeService(vi.fn());

    await service.submitDiceResult({
      adventureId,
      campaignId,
      actorUserId: userId,
      submission: {
        requestId: r1,
        notation: '1d100',
        results: [34],
        source: 'player_entered',
      },
    });
    await service.submitDiceResult({
      adventureId,
      campaignId,
      actorUserId: userId,
      submission: {
        requestId: r2,
        notation: '2d6',
        results: [3, 4],
        source: 'player_entered',
      },
    });

    const rolls = await repo.playerDiceRollsSinceLastGmResponse(adventureId);

    expect(rolls).toHaveLength(2);
    expect(rolls[0]).toMatchObject({
      notation: '1d100',
      target: 65,
      results: [34],
      total: 34,
    });
    expect(rolls[1]).toMatchObject({
      notation: '2d6',
      target: null,
      results: [3, 4],
      total: 7,
    });
  });

  it('excludes rolls that landed before the most recent gm_response', async () => {
    const { campaignId, adventureId, userId } = await seedFixture();
    const r1 = await seedRequest({
      adventureId,
      notation: '1d100',
      target: null,
    });
    const service = makeService(vi.fn());

    await service.submitDiceResult({
      adventureId,
      campaignId,
      actorUserId: userId,
      submission: {
        requestId: r1,
        notation: '1d100',
        results: [50],
        source: 'player_entered',
      },
    });

    // Simulate a subsequent gm_response landing — from the perspective of
    // *that* turn, the player-entered roll was already folded in, so a later
    // query should find nothing.
    await getTestDb().transaction(async (tx) => {
      const seq = await nextSequenceNumber(tx, adventureId);
      await tx.insert(schema.gameEvents).values({
        adventureId,
        campaignId,
        sequenceNumber: seq,
        eventType: 'gm_response',
        actorType: 'gm',
        actorId: null,
        payload: { playerText: 'narrated result' },
      });
    });

    const rolls = await repo.playerDiceRollsSinceLastGmResponse(adventureId);
    expect(rolls).toEqual([]);
  });

  it('returns empty array when no player-entered rolls exist', async () => {
    const { adventureId } = await seedFixture();
    const rolls = await repo.playerDiceRollsSinceLastGmResponse(adventureId);
    expect(rolls).toEqual([]);
  });
});
