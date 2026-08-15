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
import type { DiceService, GmRollRequest } from '../dice/dice.service';
import type { RulesLookupService } from '../rules/rules-lookup.service';
import type { WardenPromptsService } from '../wardens/warden-prompts.service';
import type { RollDiceInput, RulesLookupInput } from './session.schema';

// Stubs are typed as `Pick<Service, …>` before the cast, so the methods they
// fake are checked against the real signatures. Only the final widening `as`
// remains, and it erases nothing but the services' private members (injected
// constructor deps), which an object literal can never supply.
//
// This is deliberate, not stylistic. These stubs were previously built with
// `as unknown as Service`, which switches off checking entirely — and both
// `stubRules` and `rulesWithHit` silently rotted when
// `RulesLookupService.lookup` started returning `{ output, preprocessedQuery }`
// instead of `RulesLookupOutput`. The stubs kept resolving the old shape, so
// `handleRulesLookup` destructured `undefined` and threw into its own catch;
// two tests went on exercising the error path while asserting the success
// path. Keep the narrow type here so the next signature change breaks the
// build instead of the meaning of the test.
function stubDice(): DiceService {
  const stub: Pick<DiceService, 'rollForGm'> = {
    rollForGm: vi.fn(() => {
      throw new Error('DiceService should not be called in this test');
    }),
  };
  return stub as DiceService;
}

function stubRules(): RulesLookupService {
  const stub: Pick<RulesLookupService, 'lookup'> = {
    lookup: vi.fn(() => Promise.resolve({ output: { results: [] } })),
  };
  return stub as RulesLookupService;
}

/**
 * Keyed by slug and throwing on a miss, like the real service. The
 * `CampaignRepository` here is real, so this stub is what proves the service
 * looks the prompt up by `game_systems.slug` and not by its UUID.
 */
function stubWardens(): WardenPromptsService {
  const stub: Pick<WardenPromptsService, 'getSelected'> = {
    getSelected: vi.fn((system: string) => {
      if (system !== 'mothership') {
        throw new Error(`No Warden prompt available for system '${system}'.`);
      }
      return {
        filename: 'mothership-m7.txt',
        hash: 'testhash',
        text: 'Test Warden prompt for integration tests.',
      };
    }),
  };
  return stub as WardenPromptsService;
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

/**
 * `vi.fn()` with no type argument is `Mock<Procedure | Constructable>`, which
 * satisfies no specific signature — assigning it straight onto the stub would
 * force the checking back off. Forwarding through a contextually-typed arrow
 * keeps `callSession`'s real signature checked while callers keep passing a
 * plain mock and asserting on it directly.
 */
function mockAnthropic(
  callSession: ReturnType<typeof vi.fn>,
): AnthropicService {
  const stub: Pick<AnthropicService, 'callSession'> = {
    callSession: (params) =>
      (callSession as (p: unknown) => Promise<Anthropic.Message>)(params),
  };
  return stub as AnthropicService;
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
      resourcePools: { dr_chen: { hp: { current: 10, max: 10 } } },
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
          resourcePools: { 'dr_chen.hp': { delta: -2 } },
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
      stubWardens(),
    );

    const result = await service.sendMessage(baseArgs(campaignId, adventureId));

    expect(result.message.role).toBe('gm');
    expect(result.message.content).toBe('The airlock hisses open.');
    expect(result.applied.resourcePools.dr_chen.hp).toEqual({
      current: 8,
      max: 10,
    });

    // Campaign state mutated.
    const [stateRow] = await db
      .select()
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId));
    const data = stateRow.data as {
      resourcePools: Record<string, Record<string, { current: number }>>;
      worldFacts: Record<string, string>;
    };
    expect(data.resourcePools.dr_chen.hp.current).toBe(8);
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

    // Canon routed + auto-promoted (Solo Blind), sequence-numbered to the
    // proposing turn's gm_response event (sequence 2, per the events array
    // above).
    const canon = await db
      .select()
      .from(schema.pendingCanon)
      .where(eq(schema.pendingCanon.adventureId, adventureId));
    expect(canon).toHaveLength(1);
    expect(canon[0].status).toBe('promoted');
    expect(canon[0].sequenceNumber).toBe(2);

    // NPC agenda merged into gm_context.blob.narrative.npcAgendas.
    const [ctxRow] = await db
      .select({ blob: schema.gmContexts.blob })
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, adventureId));
    const blob = ctxRow.blob as {
      narrative: {
        location: string;
        hiddenTruth: string;
        npcAgendas: Record<string, string>;
      };
      playerEntityIds?: unknown;
    };
    expect(blob.narrative.npcAgendas.corporate_spy_1).toBe(
      'Now following the player',
    );
    // Untouched narrative fields pass through the merge unchanged.
    expect(blob.narrative.location).toBe('Derelict freighter');
    expect(blob.narrative.hiddenTruth).toBe('truth');
    // `playerEntityIds` is a per-request prompt-building addition
    // (session.snapshot.ts) spliced onto the blob in memory for Claude's
    // prompt — it must never be persisted into the `gm_context.blob` column.
    expect(blob.playerEntityIds).toBeUndefined();

    // One telemetry row keyed to the gm_response sequence.
    const telemetry = await db
      .select()
      .from(schema.adventureTelemetry)
      .where(eq(schema.adventureTelemetry.adventureId, adventureId));
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].sequenceNumber).toBe(2);
    const payload = telemetry[0].payload as {
      notes: { original: string | null };
      wardenPrompt: { filename: string; hash: string };
    };
    expect(payload.notes.original).toBe('Escalating tension');
    // wardenPrompt is populated from WardenPromptsService.getSelected — the
    // stub returns the canned fixture for every turn in these tests.
    expect(payload.wardenPrompt).toEqual({
      filename: 'mothership-m7.txt',
      hash: 'testhash',
    });

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
      stubWardens(),
    );

    await service.sendMessage(baseArgs(campaignId, adventureId));
    await service.sendMessage(baseArgs(campaignId, adventureId));

    const [advRow] = await db
      .select()
      .from(schema.adventures)
      .where(eq(schema.adventures.id, adventureId));
    expect(advRow.status).toBe('in_progress');
  });

  it('returns an incrementing turnNumber that agrees with the message log', async () => {
    // The POST response carries the turn ordinal so the client can stamp it
    // onto the optimistic player message. It has to agree with what
    // `listMessages` reports on a later reload — two independent
    // derivations (a count inside the write transaction vs. a read-time
    // window function), so this asserts they don't drift.
    const { campaignId, adventureId } = await seedReadyAdventure();
    const callSession = vi.fn().mockResolvedValue(
      toolUseMessage({
        playerText: 'ok',
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
      stubWardens(),
    );

    const first = await service.sendMessage(baseArgs(campaignId, adventureId));
    const second = await service.sendMessage(baseArgs(campaignId, adventureId));

    expect(first.turnNumber).toBe(1);
    expect(second.turnNumber).toBe(2);

    const log = await service.listMessages(adventureId);
    expect(log.map((m) => [m.role, m.turnNumber])).toEqual([
      ['user', 1],
      ['assistant', 1],
      ['user', 2],
      ['assistant', 2],
    ]);
  });
});

describe('SessionService (integration) — correction succeeds', () => {
  it('writes four events with superseded_by linking; messages carries only corrected text', async () => {
    const db = getTestDb();
    const { campaignId, adventureId } = await seedReadyAdventure();

    const rejectedResponse = toolUseMessage({
      playerText: 'You punch through the alien.',
      stateChanges: {
        resourcePools: { 'xenomorph.hp': { delta: -4 } }, // unknown pool, negative delta
      },
      gmUpdates: {},
    });
    const correctedResponse = toolUseMessage({
      playerText: 'You miss; the alien screeches.',
      stateChanges: {
        resourcePools: { 'dr_chen.hp': { delta: -1 } },
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
      stubWardens(),
    );

    const result = await service.sendMessage(baseArgs(campaignId, adventureId));

    expect(callSession).toHaveBeenCalledTimes(2);
    expect(result.message.content).toBe('You miss; the alien screeches.');
    expect(result.applied.resourcePools.dr_chen.hp).toEqual({
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

    // A corrected turn is still one turn. `playtest-review.render.ts`
    // numbers it the same way, and the play-view label has to agree with
    // the review report or a playtest note can't be resolved against it.
    expect(result.turnNumber).toBe(1);

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
      'resourcePools.xenomorph.hp',
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
        resourcePools: { 'xenomorph.hp': { delta: -4 } },
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
      stubWardens(),
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
    const stub: Pick<DiceService, 'rollForGm'> = {
      rollForGm: vi.fn((input: GmRollRequest) => {
        n += 1;
        return {
          notation: input.notation,
          results: [n * 10],
          modifier: 0,
          total: n * 10,
        };
      }),
    };
    return stub as DiceService;
  }

  function rulesWithHit(): RulesLookupService {
    const stub: Pick<RulesLookupService, 'lookup'> = {
      lookup: vi.fn().mockResolvedValue({
        output: {
          results: [
            {
              text: 'On a panic result of 71–80…',
              source: 'PSG p.42',
              similarity: 0.87,
            },
          ],
        },
      }),
    };
    return stub as RulesLookupService;
  }

  // `input` is typed as the tool's own Zod-inferred input rather than left
  // `unknown`, because `Anthropic.ToolUseBlock.input` is `unknown` by design
  // — the SDK can't know a tool's schema, so nothing downstream of this
  // fixture would flag a payload the tool no longer accepts. Typing it here
  // is what turns "the schema gained a required field" into a build failure
  // rather than a turn that silently takes the in-band error path. That is
  // how `actingEntityId` and `rollType` (added for the § S30 attribution
  // work) went missing from these rolls unnoticed.
  function rollToolUse(id: string, input: RollDiceInput): Anthropic.Message {
    return {
      content: [
        {
          type: 'tool_use',
          id,
          name: 'roll_dice',
          input,
        } as unknown as Anthropic.ToolUseBlock,
      ],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 50, output_tokens: 20 },
    } as unknown as Anthropic.Message;
  }

  function lookupToolUse(
    id: string,
    input: RulesLookupInput,
  ): Anthropic.Message {
    return {
      content: [
        {
          type: 'tool_use',
          id,
          name: 'rules_lookup',
          input,
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
      .mockResolvedValueOnce(
        lookupToolUse('toolu_l1', { query: 'panic result 73', limit: 3 }),
      )
      .mockResolvedValueOnce(
        rollToolUse('toolu_r1', {
          notation: '1d100',
          purpose: 'roll toolu_r1',
          actingEntityId: 'dr_chen',
          rollType: 'panic_check',
        }),
      )
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
      stubWardens(),
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
      stubWardens(),
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
      .mockResolvedValueOnce(
        lookupToolUse('toolu_l1', { query: 'wound severity', limit: 3 }),
      )
      .mockResolvedValueOnce(
        toolUseMessage({ playerText: 'Best-effort ruling.' }),
      );

    const service = new SessionService(
      repo,
      mockAnthropic(callSession),
      campaignRepo,
      stubDice(),
      stubRules(), // empty-index path — lookup returns { results: [] }
      stubWardens(),
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
