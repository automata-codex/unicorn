import { emptyMothershipState } from '@uv/game-systems';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SessionCorrectionError,
  SessionOutputError,
  SessionPreconditionError,
  SessionService,
} from './session.service';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../anthropic/anthropic.service';
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
    location: 'loc',
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
      }),
  );
}

interface MockRepoOverrides {
  getGmContextBlob?: ReturnType<typeof vi.fn>;
  getPlayerEntityIds?: ReturnType<typeof vi.fn>;
  getMessagesAsc?: ReturnType<typeof vi.fn>;
  insertMessage?: ReturnType<typeof vi.fn>;
  applyTurnAtomic?: ReturnType<typeof vi.fn>;
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
  } as unknown as SessionRepository;
}

function makeCampaignRepo(
  getStateData: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue(emptyMothershipState()),
) {
  return { getStateData } as unknown as import(
    '../campaign/campaign.repository'
  ).CampaignRepository;
}

function makeService(
  callSession: ReturnType<typeof vi.fn>,
  repo: SessionRepository = makeRepo(),
  campaignRepo = makeCampaignRepo(),
) {
  const anthropic = { callSession } as unknown as AnthropicService;
  return new SessionService(repo, anthropic, campaignRepo);
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

  it('throws SessionOutputError when tool input fails schema validation', async () => {
    callSession.mockResolvedValue(
      toolUseMessage('submit_gm_response', { playerText: 123 }),
    );
    const insertMessage = makeInsertMessage();
    const applyTurnAtomic = makeApplyTurnAtomic();
    const repo = makeRepo({ insertMessage, applyTurnAtomic });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionOutputError,
    );
    expect(applyTurnAtomic).not.toHaveBeenCalled();
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

  it('throws SessionCorrectionError when both validation rounds reject', async () => {
    // Claude proposes an impossible pool delta twice.
    const rejectingResponse = toolUseMessage('submit_gm_response', {
      playerText: 'Damage applied.',
      stateChanges: {
        resourcePools: { xenomorph_hp: { delta: -3 } }, // unknown pool, negative delta → reject
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
