import { emptyMothershipState } from '@uv/game-systems';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SessionCorrectionError,
  SessionOutputError,
  SessionPreconditionError,
  SessionService,
  SessionToolLoopError,
} from './session.service';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../anthropic/anthropic.service';
import type { WardenPromptsService } from '../wardens/warden-prompts.service';
import type {
  ApplyTurnAtomicArgs,
  ApplyTurnAtomicResult,
  SessionRepository,
} from './session.repository';
import type { DbMessage } from './session.window';

function toolUseMessage(name: string, input: unknown): Anthropic.Message {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_fake',
        name,
        input,
      } as unknown as Anthropic.ToolUseBlock,
    ],
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function textOnlyMessage(text: string): Anthropic.Message {
  return {
    content: [{ type: 'text', text } as unknown as Anthropic.ContentBlock],
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Message;
}

const baseBlob = {
  narrative: {
    scenarioPremise: 'loc',
    atmosphere: 'atmo',
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
};

function makeInsertMessage(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (args: { adventureId: string; role: DbMessage['role']; content: string }) =>
      Promise.resolve({
        id: `m-${args.role}`,
        adventureId: args.adventureId,
        role: args.role,
        content: args.content,
        createdAt: new Date('2026-04-17T12:00:00Z'),
      }),
  );
}

function makeApplyTurnAtomic(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (args: ApplyTurnAtomicArgs): Promise<ApplyTurnAtomicResult> =>
      Promise.resolve({
        persistedMessage: {
          id: 'm-gm',
          adventureId: args.adventureId,
          role: 'gm',
          content: args.gmText,
          createdAt: new Date('2026-04-17T12:00:01Z'),
        },
        gmResponseSequence: 2,
        turnNumber: 1,
        diceRollSequences: [],
        persistedDiceRequests: [],
      }),
  );
}

interface MockRepoOverrides {
  getGmContextBlob?: ReturnType<typeof vi.fn>;
  getPlayerEntityIds?: ReturnType<typeof vi.fn>;
  getMessagesAsc?: ReturnType<typeof vi.fn>;
  insertMessage?: ReturnType<typeof vi.fn>;
  applyTurnAtomic?: ReturnType<typeof vi.fn>;
  pendingDiceRequestsForAdventure?: ReturnType<typeof vi.fn>;
  playerDiceRollsSinceLastGmResponse?: ReturnType<typeof vi.fn>;
}

function makeRepo(overrides: MockRepoOverrides = {}): SessionRepository {
  return {
    getGmContextBlob:
      overrides.getGmContextBlob ?? vi.fn().mockResolvedValue(baseBlob),
    getPlayerEntityIds:
      overrides.getPlayerEntityIds ?? vi.fn().mockResolvedValue([]),
    getMessagesAsc: overrides.getMessagesAsc ?? vi.fn().mockResolvedValue([]),
    insertMessage: overrides.insertMessage ?? makeInsertMessage(),
    applyTurnAtomic: overrides.applyTurnAtomic ?? makeApplyTurnAtomic(),
    pendingDiceRequestsForAdventure:
      overrides.pendingDiceRequestsForAdventure ??
      vi.fn().mockResolvedValue([]),
    playerDiceRollsSinceLastGmResponse:
      overrides.playerDiceRollsSinceLastGmResponse ??
      vi.fn().mockResolvedValue([]),
  } as unknown as SessionRepository;
}

function makeCampaignRepo(
  getStateData: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue(emptyMothershipState()),
  getSystemId: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue('system-uuid-mothership'),
  getSystemSlug: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue('mothership'),
) {
  return {
    getStateData,
    getSystemId,
    getSystemSlug,
  } as unknown as import('../campaign/campaign.repository').CampaignRepository;
}

function makeDice(): import('../dice/dice.service').DiceService {
  return {
    rollForGm: vi.fn((input: { notation: string }) => ({
      notation: input.notation,
      results: [42],
      modifier: 0,
      total: 42,
    })),
  } as unknown as import('../dice/dice.service').DiceService;
}

function makeRules(): import('../rules/rules-lookup.service').RulesLookupService {
  return {
    lookup: vi.fn().mockResolvedValue({ results: [] }),
  } as unknown as import('../rules/rules-lookup.service').RulesLookupService;
}

/**
 * Keyed by slug the way the real service is, and throws on a miss the way
 * `getSelected` does. An arg-ignoring stub would hand back a prompt for any
 * key at all — including a `game_systems` UUID — and hide the mixup.
 */
function makeGetSelected(): ReturnType<typeof vi.fn> {
  return vi.fn((system: string) => {
    if (system !== 'mothership') {
      throw new Error(`No Warden prompt available for system '${system}'.`);
    }
    return {
      filename: 'mothership-m7.txt',
      hash: 'deadbeef',
      text: 'Fixture Warden prompt.',
    };
  });
}

function makeWardens(
  getSelected: ReturnType<typeof vi.fn> = makeGetSelected(),
): WardenPromptsService {
  return { getSelected } as unknown as WardenPromptsService;
}

function makeService(
  callSession: ReturnType<typeof vi.fn>,
  repo: SessionRepository = makeRepo(),
  campaignRepo = makeCampaignRepo(),
  dice = makeDice(),
  rules = makeRules(),
  wardens = makeWardens(),
) {
  const anthropic = { callSession } as unknown as AnthropicService;
  return new SessionService(
    repo,
    anthropic,
    campaignRepo,
    dice,
    rules,
    wardens,
  );
}

const args = {
  adventureId: 'adv-1',
  campaignId: 'camp-1',
  playerUserId: 'u1',
  playerMessage: 'I check the airlock.',
};

describe('SessionService.sendMessage', () => {
  let callSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    callSession = vi.fn().mockResolvedValue(
      toolUseMessage('submit_gm_response', {
        playerText: 'The airlock is sealed.',
      }),
    );
  });

  it('persists player message before calling Claude, then bundles the turn atomically', async () => {
    const insertMessage = makeInsertMessage();
    const applyTurnAtomic = makeApplyTurnAtomic();
    const repo = makeRepo({ insertMessage, applyTurnAtomic });
    const service = makeService(callSession, repo);

    const result = await service.sendMessage(args);

    // Player message persisted once, outside the atomic call.
    expect(insertMessage).toHaveBeenCalledTimes(1);
    expect(insertMessage).toHaveBeenCalledWith({
      adventureId: 'adv-1',
      role: 'player',
      content: 'I check the airlock.',
    });

    // Atomic call receives the final payload.
    expect(applyTurnAtomic).toHaveBeenCalledTimes(1);
    const atomicArgs = applyTurnAtomic.mock.calls[0][0] as ApplyTurnAtomicArgs;
    expect(atomicArgs.gmText).toBe('The airlock is sealed.');
    expect(atomicArgs.correction).toBeUndefined();
    expect(atomicArgs.playerUserId).toBe('u1');
    expect(atomicArgs.autoPromoteCanon).toBe(true);

    expect(result.message.content).toBe('The airlock is sealed.');
    expect(result.applied).toBeDefined();
    expect(result.thresholds).toEqual([]);
  });

  it('persists the player message even when Claude call fails', async () => {
    callSession.mockRejectedValue(new Error('network'));
    const insertMessage = makeInsertMessage();
    const applyTurnAtomic = makeApplyTurnAtomic();
    const repo = makeRepo({ insertMessage, applyTurnAtomic });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toThrow('network');
    expect(insertMessage).toHaveBeenCalledTimes(1);
    expect(applyTurnAtomic).not.toHaveBeenCalled();
  });

  it('throws SessionOutputError when Claude returns text instead of a tool call', async () => {
    callSession.mockResolvedValue(textOnlyMessage('no tool use here'));
    const insertMessage = makeInsertMessage();
    const applyTurnAtomic = makeApplyTurnAtomic();
    const repo = makeRepo({ insertMessage, applyTurnAtomic });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionOutputError,
    );
    expect(insertMessage).toHaveBeenCalledTimes(1);
    expect(applyTurnAtomic).not.toHaveBeenCalled();
  });

  it('throws SessionToolLoopError when tool input persistently fails schema validation', async () => {
    // Every call returns the same malformed payload, so the inner loop's
    // retry (see session.tool-loop.spec.ts) never recovers and exhausts
    // INNER_TOOL_LOOP_CAP.
    callSession.mockResolvedValue(
      toolUseMessage('submit_gm_response', { playerText: 123 }),
    );
    const insertMessage = makeInsertMessage();
    const applyTurnAtomic = makeApplyTurnAtomic();
    const repo = makeRepo({ insertMessage, applyTurnAtomic });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionToolLoopError,
    );
    expect(applyTurnAtomic).not.toHaveBeenCalled();
  });

  it('recovers when a malformed submit_gm_response is followed by a valid one', async () => {
    callSession
      .mockResolvedValueOnce(
        toolUseMessage('submit_gm_response', { gmUpdates: 'not an object' }),
      )
      .mockResolvedValueOnce(
        toolUseMessage('submit_gm_response', { playerText: 'ok' }),
      );
    const insertMessage = makeInsertMessage();
    const applyTurnAtomic = makeApplyTurnAtomic();
    const repo = makeRepo({ insertMessage, applyTurnAtomic });
    const service = makeService(callSession, repo);
    await service.sendMessage(args);
    expect(callSession).toHaveBeenCalledTimes(2);
    expect(applyTurnAtomic).toHaveBeenCalledTimes(1);
  });

  it('throws SessionPreconditionError when gm_context is missing', async () => {
    const insertMessage = makeInsertMessage();
    const applyTurnAtomic = makeApplyTurnAtomic();
    const repo = makeRepo({
      getGmContextBlob: vi.fn().mockResolvedValue(null),
      insertMessage,
      applyTurnAtomic,
    });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionPreconditionError,
    );
    expect(insertMessage).not.toHaveBeenCalled();
    expect(applyTurnAtomic).not.toHaveBeenCalled();
  });

  it('throws SessionPreconditionError when campaign_state is missing', async () => {
    const insertMessage = makeInsertMessage();
    const repo = makeRepo({ insertMessage });
    const campaignRepo = makeCampaignRepo(vi.fn().mockResolvedValue(null));
    const service = makeService(callSession, repo, campaignRepo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionPreconditionError,
    );
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it('selects the Warden prompt by system slug, not by system id', async () => {
    const getSelected = makeGetSelected();
    const campaignRepo = makeCampaignRepo(
      undefined,
      vi.fn().mockResolvedValue('7c9e6679-7425-40de-944b-e07fc1f90ae7'),
      vi.fn().mockResolvedValue('mothership'),
    );
    const service = makeService(
      callSession,
      makeRepo(),
      campaignRepo,
      makeDice(),
      makeRules(),
      makeWardens(getSelected),
    );
    await service.sendMessage(args);
    expect(getSelected).toHaveBeenCalledWith('mothership');
  });

  it('throws SessionPreconditionError when the system slug has no Warden prompt', async () => {
    const insertMessage = makeInsertMessage();
    const repo = makeRepo({ insertMessage });
    const campaignRepo = makeCampaignRepo(
      undefined,
      undefined,
      vi.fn().mockResolvedValue('pathfinder'),
    );
    const service = makeService(callSession, repo, campaignRepo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionPreconditionError,
    );
    expect(callSession).not.toHaveBeenCalled();
  });

  it('throws SessionCorrectionError when both validation rounds reject', async () => {
    // Claude proposes an impossible pool delta twice.
    const rejectingResponse = toolUseMessage('submit_gm_response', {
      playerText: 'Damage applied.',
      stateChanges: {
        // Unknown pool, negative delta → reject.
        resourcePools: [
          { owner: 'xenomorph', pool: 'hp', delta: -3, reason: 'clawed' },
        ],
      },
    });
    callSession.mockResolvedValue(rejectingResponse);

    const applyTurnAtomic = makeApplyTurnAtomic();
    const repo = makeRepo({ applyTurnAtomic });
    const service = makeService(callSession, repo);

    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionCorrectionError,
    );
    expect(callSession).toHaveBeenCalledTimes(2);
    expect(applyTurnAtomic).not.toHaveBeenCalled();
  });
});
