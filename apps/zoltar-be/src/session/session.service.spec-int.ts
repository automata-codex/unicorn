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

import { SessionRepository } from './session.repository';
import { SessionCorrectionError, SessionService } from './session.service';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../anthropic/anthropic.service';
import type { DiceService } from '../dice/dice.service';
import type { RulesLookupService } from '../rules/rules-lookup.service';

// These integration tests mock Claude to return submit_gm_response directly,
// so roll_dice / rules_lookup paths are never exercised here; no-op stubs
// are enough. The tool-loop behaviour is covered in session.tool-loop.spec.ts.
function stubDice(): DiceService {
  return {
    rollForGm: vi.fn(() => {
      throw new Error('DiceService should not be called in this test');
    }),
  } as unknown as DiceService;
}

function stubRules(): RulesLookupService {
  return {
    lookup: vi.fn(async () => ({ results: [] })),
  } as unknown as RulesLookupService;
}

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
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 1500, output_tokens: 420 },
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
        npcAgendas: { corporate_spy_1: 'Watch the player' },
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

const baseArgs = (campaignId: string, adventureId: string) => ({
  campaignId,
  adventureId,
  playerUserId: 'u1',
  playerMessage: 'I open the airlock.',
});

describe('SessionService (integration) — happy path', () => {
  it('applies state, writes three events, inserts telemetry, routes canon, merges blob', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    const callSession = vi.fn().mockResolvedValue(
      toolUseMessage({
        playerText: 'The airlock hisses open.',
        stateChanges: {
          resourcePools: { dr_chen_hp: { delta: -2 } },
          worldFacts: { corridor_length: 'eight meters' },
        },
        gmUpdates: {
          npcStates: { corporate_spy_1: 'Now following the player' },
          proposedCanon: [
            { summary: 'Ship has a brig', context: 'Cell door.' },
          ],
          notes: 'Escalating tension',
        },
      }),
    );
    const service = new SessionService(
      repo,
      mockAnthropic(callSession),
      campaignRepo,
      stubDice(),
      stubRules(),
    );

    const result = await service.sendMessage(baseArgs(campaignId, adventureId));

    expect(result.message.role).toBe('gm');
    expect(result.message.content).toBe('The airlock hisses open.');
    expect(result.applied.resourcePools.dr_chen_hp).toEqual({
      current: 8,
      max: 10,
    });

    // Campaign state mutated.
    const [stateRow] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));
    const data = stateRow.data as {
      resourcePools: Record<string, { current: number }>;
      worldFacts: Record<string, string>;
    };
    expect(data.resourcePools.dr_chen_hp.current).toBe(8);
    expect(data.worldFacts.corridor_length).toBe('eight meters');

    // Three events: player_action, gm_response, state_update.
    const events = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId))
      .orderBy(asc(schema.gameEvents.sequenceNumber));
    expect(events.map((e) => e.eventType)).toEqual([
      'player_action',
      'gm_response',
      'state_update',
    ]);
    expect(events.map((e) => e.sequenceNumber)).toEqual([1, 2, 3]);

    // Canon routed + auto-promoted (Solo Blind).
    const canon = await db
      .select()
      .from(schema.pendingCanon)
      .where(eq(schema.pendingCanon.adventureId, adventureId));
    expect(canon).toHaveLength(1);
    expect(canon[0].status).toBe('promoted');

    // NPC agenda merged into gm_context.blob.narrative.npcAgendas.
    const [ctxRow] = await db
      .select({ blob: schema.gmContexts.blob })
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, adventureId));
    const agendas = (
      ctxRow.blob as { narrative: { npcAgendas: Record<string, string> } }
    ).narrative.npcAgendas;
    expect(agendas.corporate_spy_1).toBe('Now following the player');

    // One telemetry row keyed to the gm_response sequence.
    const telemetry = await db
      .select()
      .from(schema.adventureTelemetry)
      .where(eq(schema.adventureTelemetry.adventureId, adventureId));
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].sequenceNumber).toBe(2);
    const payload = telemetry[0].payload as {
      notes: { original: string | null };
    };
    expect(payload.notes.original).toBe('Escalating tension');

    // Two message rows: player input, corrected GM narration.
    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.adventureId, adventureId))
      .orderBy(asc(schema.messages.createdAt));
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('player');
    expect(messages[1].role).toBe('gm');
    expect(messages[1].content).toBe('The airlock hisses open.');

    // First turn flips the adventure from `ready` to `in_progress`.
    const [advRow] = await db
      .select()
      .from(schema.adventures)
      .where(eq(schema.adventures.id, adventureId));
    expect(advRow.status).toBe('in_progress');
  });

  it('is a no-op on status flip for the second turn (stays in_progress)', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    const callSession = vi.fn().mockResolvedValue(
      toolUseMessage({
        playerText: 'Nothing happens.',
        stateChanges: {},
        gmUpdates: {},
      }),
    );
    const service = new SessionService(
      repo,
      mockAnthropic(callSession),
      campaignRepo,
      stubDice(),
      stubRules(),
    );

    await service.sendMessage(baseArgs(campaignId, adventureId));
    await service.sendMessage(baseArgs(campaignId, adventureId));

    const [advRow] = await db
      .select()
      .from(schema.adventures)
      .where(eq(schema.adventures.id, adventureId));
    expect(advRow.status).toBe('in_progress');
  });
});

describe('SessionService (integration) — correction succeeds', () => {
  it('writes four events with superseded_by linking; messages carries only corrected text', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    const rejectedResponse = toolUseMessage({
      playerText: 'You punch through the alien.',
      stateChanges: {
        resourcePools: { xenomorph_hp: { delta: -4 } }, // unknown pool, negative delta
      },
      gmUpdates: {},
    });
    const correctedResponse = toolUseMessage({
      playerText: 'You miss; the alien screeches.',
      stateChanges: {
        resourcePools: { dr_chen_hp: { delta: -1 } },
      },
      gmUpdates: { npcStates: {} },
    });
    const callSession = vi
      .fn()
      .mockResolvedValueOnce(rejectedResponse)
      .mockResolvedValueOnce(correctedResponse);
    const service = new SessionService(
      repo,
      mockAnthropic(callSession),
      campaignRepo,
      stubDice(),
      stubRules(),
    );

    const result = await service.sendMessage(baseArgs(campaignId, adventureId));

    expect(callSession).toHaveBeenCalledTimes(2);
    expect(result.message.content).toBe('You miss; the alien screeches.');
    expect(result.applied.resourcePools.dr_chen_hp).toEqual({
      current: 9,
      max: 10,
    });

    const events = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId))
      .orderBy(asc(schema.gameEvents.sequenceNumber));
    expect(events.map((e) => e.eventType)).toEqual([
      'player_action',
      'gm_response',
      'correction',
      'state_update',
    ]);
    const gmResponseRow = events[1];
    const correctionRow = events[2];
    expect(gmResponseRow.supersededBy).toBe(correctionRow.id);
    expect(correctionRow.supersededBy).toBeNull();

    // Messages table carries only the corrected text.
    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.adventureId, adventureId));
    const gmMessages = messages.filter((m) => m.role === 'gm');
    expect(gmMessages).toHaveLength(1);
    expect(gmMessages[0].content).toBe('You miss; the alien screeches.');

    // Telemetry keyed to gm_response sequence, correction block populated.
    const [tele] = await db
      .select()
      .from(schema.adventureTelemetry)
      .where(eq(schema.adventureTelemetry.adventureId, adventureId));
    expect(tele.sequenceNumber).toBe(gmResponseRow.sequenceNumber);
    const telePayload = tele.payload as {
      correction?: { rejections: Array<{ path: string }> };
    };
    expect(telePayload.correction).toBeDefined();
    expect(telePayload.correction!.rejections[0].path).toBe(
      'resourcePools.xenomorph_hp',
    );
  });
});

describe('SessionService (integration) — correction fails', () => {
  it('throws SessionCorrectionError and rolls back the turn transaction', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    const [stateBefore] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));

    const alwaysRejecting = toolUseMessage({
      playerText: 'Impossible action.',
      stateChanges: {
        resourcePools: { xenomorph_hp: { delta: -4 } },
      },
      gmUpdates: {},
    });
    const callSession = vi
      .fn()
      .mockResolvedValueOnce(alwaysRejecting)
      .mockResolvedValueOnce(alwaysRejecting);
    const service = new SessionService(
      repo,
      mockAnthropic(callSession),
      campaignRepo,
      stubDice(),
      stubRules(),
    );

    await expect(
      service.sendMessage(baseArgs(campaignId, adventureId)),
    ).rejects.toBeInstanceOf(SessionCorrectionError);
    expect(callSession).toHaveBeenCalledTimes(2);

    // Campaign state unchanged.
    const [stateAfter] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));
    expect(stateAfter.data).toEqual(stateBefore.data);

    // Failed correction must not flip the status — the turn rolled back.
    const [advRow] = await db
      .select()
      .from(schema.adventures)
      .where(eq(schema.adventures.id, adventureId));
    expect(advRow.status).toBe('ready');

    // Only the player message persists; no events, no canon, no telemetry.
    const events = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.adventureId, adventureId));
    expect(events).toHaveLength(0);

    const canon = await db
      .select()
      .from(schema.pendingCanon)
      .where(eq(schema.pendingCanon.adventureId, adventureId));
    expect(canon).toHaveLength(0);

    const telemetry = await db
      .select()
      .from(schema.adventureTelemetry)
      .where(eq(schema.adventureTelemetry.adventureId, adventureId));
    expect(telemetry).toHaveLength(0);

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.adventureId, adventureId));
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('player');
  });
});

describe('SessionService (integration) — telemetry with dice and lookups', () => {
  function rollingDice(): DiceService {
    let n = 0;
    return {
      rollForGm: vi.fn((input: { notation: string }) => {
        n += 1;
        return {
          notation: input.notation,
          results: [n * 10],
          modifier: 0,
          total: n * 10,
        };
      }),
    } as unknown as DiceService;
  }

  function rulesWithHit(): RulesLookupService {
    return {
      lookup: vi.fn().mockResolvedValue({
        results: [
          {
            text: 'On a panic result of 71–80…',
            source: 'PSG p.42',
            similarity: 0.87,
          },
        ],
      }),
    } as unknown as RulesLookupService;
  }

  function rollToolUse(id: string, notation: string): Anthropic.Message {
    return {
      content: [
        {
          type: 'tool_use',
          id,
          name: 'roll_dice',
          input: { notation, purpose: `roll ${id}` },
        } as unknown as Anthropic.ToolUseBlock,
      ],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 50, output_tokens: 20 },
    } as unknown as Anthropic.Message;
  }

  function lookupToolUse(id: string, query: string): Anthropic.Message {
    return {
      content: [
        {
          type: 'tool_use',
          id,
          name: 'rules_lookup',
          input: { query, limit: 3 },
        } as unknown as Anthropic.ToolUseBlock,
      ],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 50, output_tokens: 20 },
    } as unknown as Anthropic.Message;
  }

  it('persists telemetry with materialized sequence numbers, rulesLookups, and toolLoopIterations', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    // Three Claude calls: rules_lookup, roll_dice, then submit_gm_response.
    const callSession = vi
      .fn()
      .mockResolvedValueOnce(lookupToolUse('toolu_l1', 'panic result 73'))
      .mockResolvedValueOnce(rollToolUse('toolu_r1', '1d100'))
      .mockResolvedValueOnce(
        toolUseMessage({
          playerText: 'The pressure holds.',
        }),
      );

    const service = new SessionService(
      repo,
      mockAnthropic(callSession),
      campaignRepo,
      rollingDice(),
      rulesWithHit(),
    );

    await service.sendMessage(baseArgs(campaignId, adventureId));

    const [row] = await db
      .select()
      .from(schema.adventureTelemetry)
      .where(eq(schema.adventureTelemetry.adventureId, adventureId));

    expect(row.sequenceNumber).toBe(3); // player_action=1, dice_roll=2, gm_response=3
    const payload = row.payload as {
      toolLoopIterations: number;
      rulesLookups: Array<{
        query: string;
        resultCount: number;
        topSimilarity: number | null;
        sources: string[];
      }>;
      diceRolls: Array<{
        source: string;
        sequenceNumber: number;
        notation: string;
        total: number;
      }>;
    };

    // Two tool iterations + the final submit_gm_response = 3.
    expect(payload.toolLoopIterations).toBe(3);

    // Rules lookup captured with its populated result.
    expect(payload.rulesLookups).toHaveLength(1);
    expect(payload.rulesLookups[0]).toMatchObject({
      query: 'panic result 73',
      resultCount: 1,
      topSimilarity: 0.87,
      sources: ['PSG p.42'],
    });

    // One system-generated roll with a real sequence number.
    expect(payload.diceRolls).toHaveLength(1);
    expect(payload.diceRolls[0].source).toBe('system_generated');
    expect(payload.diceRolls[0].sequenceNumber).toBe(2);
    expect(payload.diceRolls[0].notation).toBe('1d100');
    expect(payload.diceRolls[0].total).toBe(10);
  });

  it('folds pre-turn player-entered rolls into diceRolls with their DB sequence numbers', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    // Seed a prior gm_response so playerDiceRollsSinceLastGmResponse has a
    // reference point. This stands in for the previous turn.
    await db.insert(schema.gameEvents).values({
      adventureId,
      campaignId,
      sequenceNumber: 1,
      eventType: 'gm_response',
      actorType: 'gm',
      actorId: null,
      payload: { playerText: 'prior turn' },
    });

    // Seed a dice_request + resolving player_entered dice_roll event at
    // sequence 2, as would happen after a POST /dice-results submission.
    const requestId = '00000000-0000-0000-0000-000000000abc';
    await db.insert(schema.diceRequests).values({
      id: requestId,
      adventureId,
      issuedAtSequence: 1,
      notation: '1d100',
      purpose: 'Intellect save',
      target: 65,
      status: 'resolved',
      resolvedAtSequence: 2,
      resolvedAt: new Date(),
    });
    await db.insert(schema.gameEvents).values({
      adventureId,
      campaignId,
      sequenceNumber: 2,
      eventType: 'dice_roll',
      actorType: 'player',
      actorId: 'u1',
      rollSource: 'player_entered',
      payload: {
        notation: '1d100',
        purpose: 'Intellect save',
        results: [34],
        modifier: 0,
        total: 34,
        requestId,
      },
    });

    // Flip the adventure to in_progress so sendMessage's status check passes.
    await db
      .update(schema.adventures)
      .set({ status: 'in_progress' })
      .where(eq(schema.adventures.id, adventureId));

    const callSession = vi
      .fn()
      .mockResolvedValueOnce(
        toolUseMessage({ playerText: 'You decipher the data.' }),
      );
    const service = new SessionService(
      repo,
      mockAnthropic(callSession),
      campaignRepo,
      stubDice(),
      stubRules(),
    );

    await service.sendMessage(baseArgs(campaignId, adventureId));

    const [row] = await db
      .select()
      .from(schema.adventureTelemetry)
      .where(eq(schema.adventureTelemetry.adventureId, adventureId));

    const payload = row.payload as {
      diceRolls: Array<{
        source: string;
        sequenceNumber: number;
        notation: string;
        total: number;
        requestId?: string;
      }>;
    };

    expect(payload.diceRolls).toHaveLength(1);
    expect(payload.diceRolls[0]).toMatchObject({
      source: 'player_entered',
      sequenceNumber: 2,
      notation: '1d100',
      total: 34,
      requestId,
    });
  });

  it('captures zero-result rules_lookups as M7.2 ingestion-priority signal', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    const callSession = vi
      .fn()
      .mockResolvedValueOnce(lookupToolUse('toolu_l1', 'wound severity'))
      .mockResolvedValueOnce(
        toolUseMessage({ playerText: 'Best-effort ruling.' }),
      );

    const service = new SessionService(
      repo,
      mockAnthropic(callSession),
      campaignRepo,
      stubDice(),
      stubRules(), // empty-index path — lookup returns { results: [] }
    );

    await service.sendMessage(baseArgs(campaignId, adventureId));

    const [row] = await db
      .select()
      .from(schema.adventureTelemetry)
      .where(eq(schema.adventureTelemetry.adventureId, adventureId));
    const payload = row.payload as {
      rulesLookups: Array<{
        resultCount: number;
        topSimilarity: number | null;
      }>;
    };

    expect(payload.rulesLookups).toHaveLength(1);
    expect(payload.rulesLookups[0].resultCount).toBe(0);
    expect(payload.rulesLookups[0].topSimilarity).toBeNull();
  });
});
