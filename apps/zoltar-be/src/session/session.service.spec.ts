import { emptyMothershipState } from '@uv/game-systems';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SessionOutputError,
  SessionPreconditionError,
  SessionService,
} from './session.service';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../anthropic/anthropic.service';
import type { SessionRepository } from './session.repository';
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
  } as unknown as Anthropic.Message;
}

function textOnlyMessage(text: string): Anthropic.Message {
  return {
    content: [{ type: 'text', text } as unknown as Anthropic.ContentBlock],
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

// Default insert-message stub: resolves with a plausible DbMessage shape.
// Callers that care about the mock's call history keep a local reference.
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

interface MockRepoOverrides {
  getGmContextBlob?: ReturnType<typeof vi.fn>;
  getCampaignStateData?: ReturnType<typeof vi.fn>;
  getPlayerEntityIds?: ReturnType<typeof vi.fn>;
  getMessagesAsc?: ReturnType<typeof vi.fn>;
  insertMessage?: ReturnType<typeof vi.fn>;
}

function makeRepo(overrides: MockRepoOverrides = {}): SessionRepository {
  return {
    getGmContextBlob:
      overrides.getGmContextBlob ?? vi.fn().mockResolvedValue(baseBlob),
    getCampaignStateData:
      overrides.getCampaignStateData ??
      vi.fn().mockResolvedValue(emptyMothershipState()),
    getPlayerEntityIds:
      overrides.getPlayerEntityIds ?? vi.fn().mockResolvedValue([]),
    getMessagesAsc: overrides.getMessagesAsc ?? vi.fn().mockResolvedValue([]),
    insertMessage: overrides.insertMessage ?? makeInsertMessage(),
  } as unknown as SessionRepository;
}

function makeService(
  callSession: ReturnType<typeof vi.fn>,
  repo: SessionRepository = makeRepo(),
) {
  const anthropic = { callSession } as unknown as AnthropicService;
  return new SessionService(repo, anthropic);
}

const args = {
  adventureId: 'adv-1',
  campaignId: 'camp-1',
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

  it('persists player and GM messages and returns proposals on happy path', async () => {
    const insertMessage = makeInsertMessage();
    const repo = makeRepo({ insertMessage });
    const service = makeService(callSession, repo);
    const result = await service.sendMessage(args);

    expect(insertMessage).toHaveBeenNthCalledWith(1, {
      adventureId: 'adv-1',
      role: 'player',
      content: 'I check the airlock.',
    });
    expect(insertMessage).toHaveBeenNthCalledWith(2, {
      adventureId: 'adv-1',
      role: 'gm',
      content: 'The airlock is sealed.',
    });
    expect(result.message.content).toBe('The airlock is sealed.');
    expect(result.proposals.playerText).toBe('The airlock is sealed.');
  });

  it('persists the player message even when Claude call fails', async () => {
    callSession.mockRejectedValue(new Error('network'));
    const insertMessage = makeInsertMessage();
    const repo = makeRepo({ insertMessage });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toThrow('network');
    expect(insertMessage).toHaveBeenCalledTimes(1);
    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'player' }),
    );
  });

  it('throws SessionOutputError when Claude returns text instead of a tool call', async () => {
    callSession.mockResolvedValue(textOnlyMessage('no tool use here'));
    const insertMessage = makeInsertMessage();
    const repo = makeRepo({ insertMessage });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionOutputError,
    );
    // Player message persisted, GM message never is.
    expect(insertMessage).toHaveBeenCalledTimes(1);
  });

  it('throws SessionOutputError when tool input fails schema validation', async () => {
    callSession.mockResolvedValue(
      toolUseMessage('submit_gm_response', { playerText: 123 }),
    );
    const insertMessage = makeInsertMessage();
    const repo = makeRepo({ insertMessage });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionOutputError,
    );
    expect(insertMessage).toHaveBeenCalledTimes(1);
  });

  it('throws SessionPreconditionError when gm_context is missing', async () => {
    const insertMessage = makeInsertMessage();
    const repo = makeRepo({
      getGmContextBlob: vi.fn().mockResolvedValue(null),
      insertMessage,
    });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionPreconditionError,
    );
    // No message persisted — we bail before any write.
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it('throws SessionPreconditionError when campaign_state is missing', async () => {
    const insertMessage = makeInsertMessage();
    const repo = makeRepo({
      getCampaignStateData: vi.fn().mockResolvedValue(null),
      insertMessage,
    });
    const service = makeService(callSession, repo);
    await expect(service.sendMessage(args)).rejects.toBeInstanceOf(
      SessionPreconditionError,
    );
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it('passes player entity ids from character sheets into the snapshot input', async () => {
    const getPlayerEntityIds = vi.fn().mockResolvedValue(['dr_chen']);
    const repo = makeRepo({ getPlayerEntityIds });
    const service = makeService(callSession, repo);
    await service.sendMessage(args);
    expect(getPlayerEntityIds).toHaveBeenCalledWith('camp-1');
    // First system block is the GM context; the snapshot's player override
    // would be the only mechanism to surface dr_chen when hidden, so assert
    // the call shape reached the Anthropic client.
    expect(callSession).toHaveBeenCalledTimes(1);
  });
});
