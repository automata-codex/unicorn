import { emptyMothershipState } from '@uv/game-systems';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INNER_TOOL_LOOP_CAP,
  SessionOutputError,
  SessionService,
  SessionToolLoopError,
} from './session.service';

import type Anthropic from '@anthropic-ai/sdk';
import type {
  AnthropicService,
  CallSessionParams,
} from '../anthropic/anthropic.service';
import type { CampaignRepository } from '../campaign/campaign.repository';
import type { DiceService } from '../dice/dice.service';
import type { RulesLookupService } from '../rules/rules-lookup.service';
import type { SessionRepository } from './session.repository';

// --- helpers --------------------------------------------------------------

function message(
  blocks: Anthropic.ContentBlock[],
  overrides: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    content: blocks,
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 0, output_tokens: 0 },
    ...overrides,
  } as unknown as Anthropic.Message;
}

function toolUse(
  id: string,
  name: string,
  input: unknown,
): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name, input } as Anthropic.ToolUseBlock;
}

function submitGmBlock(
  input: Record<string, unknown> = { playerText: 'ok' },
): Anthropic.ToolUseBlock {
  return toolUse('toolu_submit', 'submit_gm_response', input);
}

const baseRequest: CallSessionParams = {
  systemBlocks: [{ type: 'text', text: 'warden' }],
  messages: [
    { role: 'user', content: '<state_snapshot>…</state_snapshot>' },
    { role: 'user', content: 'Open the door.' },
  ],
  tools: [{ name: 'submit_gm_response' } as unknown as Anthropic.Tool],
  toolChoice: { type: 'any' },
};

function makeService(
  callSession: ReturnType<typeof vi.fn>,
  overrides: {
    rollForGm?: ReturnType<typeof vi.fn>;
    lookup?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const anthropic = { callSession } as unknown as AnthropicService;
  const dice = {
    rollForGm:
      overrides.rollForGm ??
      vi.fn((input: { notation: string; purpose: string }) => ({
        notation: input.notation,
        results: [50],
        modifier: 0,
        total: 50,
      })),
  } as unknown as DiceService;
  const rules = {
    lookup: overrides.lookup ?? vi.fn().mockResolvedValue({ results: [] }),
  } as unknown as RulesLookupService;
  const repo = {} as unknown as SessionRepository;
  const campaignRepo = {
    getStateData: vi.fn().mockResolvedValue(emptyMothershipState()),
    getSystemId: vi.fn().mockResolvedValue('system-uuid-mothership'),
  } as unknown as CampaignRepository;
  return {
    service: new SessionService(repo, anthropic, campaignRepo, dice, rules),
    callSession,
    dice,
    rules,
  };
}

const loopArgs = {
  initialRequest: baseRequest,
  systemId: 'system-uuid-mothership',
  adventureId: 'adv-1',
};

// --- tests ---------------------------------------------------------------

describe('SessionService.runInnerToolLoop', () => {
  let callSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    callSession = vi.fn();
  });

  it('returns on the first call when submit_gm_response arrives immediately', async () => {
    callSession.mockResolvedValueOnce(
      message([submitGmBlock({ playerText: 'The door opens.' })]),
    );
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(1);
    expect(result.finalParsed.playerText).toBe('The door opens.');
    expect(result.executedRolls).toEqual([]);
    expect(result.rulesLookups).toEqual([]);
    expect(callSession).toHaveBeenCalledTimes(1);
  });

  it('executes a single roll_dice call and returns submit_gm_response on the next iteration', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_roll1', 'roll_dice', {
            notation: '1d100',
            purpose: 'Panic check',
          }),
        ]),
      )
      .mockResolvedValueOnce(
        message([submitGmBlock({ playerText: 'Panic rises.' })]),
      );
    const rollForGm = vi.fn(() => ({
      notation: '1d100',
      results: [73],
      modifier: 0,
      total: 73,
    }));
    const { service } = makeService(callSession, { rollForGm });

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(2);
    expect(result.executedRolls).toEqual([
      {
        notation: '1d100',
        purpose: 'Panic check',
        results: [73],
        modifier: 0,
        total: 73,
      },
    ]);
    expect(rollForGm).toHaveBeenCalledTimes(1);

    // Second call received an assistant turn and a tool_result user turn.
    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResultTurn = secondCall.messages[
      secondCall.messages.length - 1
    ] as { role: string; content: Anthropic.ContentBlockParam[] };
    expect(toolResultTurn.role).toBe('user');
    expect(toolResultTurn.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_roll1',
      content: expect.stringContaining('"total":73'),
    });
  });

  it('executes two roll_dice calls in a single assistant turn before looping', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '1d100',
            purpose: 'A',
          }),
          toolUse('toolu_2', 'roll_dice', {
            notation: '2d6',
            purpose: 'B',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    let n = 0;
    const rollForGm = vi.fn((input: { notation: string }) => {
      n++;
      return {
        notation: input.notation,
        results: n === 1 ? [12] : [3, 4],
        modifier: 0,
        total: n === 1 ? 12 : 7,
      };
    });
    const { service } = makeService(callSession, { rollForGm });

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(2);
    expect(result.executedRolls).toHaveLength(2);
    expect(result.executedRolls[0].total).toBe(12);
    expect(result.executedRolls[1].total).toBe(7);

    // Both tool_results threaded back in the single follow-up user turn.
    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResultTurn = secondCall.messages[
      secondCall.messages.length - 1
    ] as { content: Anthropic.ContentBlockParam[] };
    expect(toolResultTurn.content).toHaveLength(2);
  });

  it('chains rules_lookup → roll_dice → submit_gm_response across three iterations', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_l1', 'rules_lookup', {
            query: 'panic result 73',
            limit: 3,
          }),
        ]),
      )
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_r1', 'roll_dice', {
            notation: '1d100',
            purpose: 'Panic',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const lookup = vi.fn().mockResolvedValue({
      results: [
        {
          text: 'On 71–80…',
          source: 'PSG p.42',
          similarity: 0.87,
        },
      ],
    });
    const { service } = makeService(callSession, { lookup });

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(3);
    expect(result.executedRolls).toHaveLength(1);
    expect(result.rulesLookups).toEqual([
      {
        query: 'panic result 73',
        limit: 3,
        resultCount: 1,
        topSimilarity: 0.87,
        sources: ['PSG p.42'],
      },
    ]);
    expect(lookup).toHaveBeenCalledWith('system-uuid-mothership', {
      query: 'panic result 73',
      limit: 3,
    });
  });

  it('captures empty-index rules_lookup with resultCount 0 and null topSimilarity', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_lookup', 'rules_lookup', {
            query: 'wound severity',
            limit: 3,
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.rulesLookups).toEqual([
      {
        query: 'wound severity',
        limit: 3,
        resultCount: 0,
        topSimilarity: null,
        sources: [],
      },
    ]);
  });

  it('returns is_error tool_result when roll_dice input is invalid and lets Claude recover', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          // Missing `purpose` → Zod reject.
          toolUse('toolu_bad', 'roll_dice', { notation: '1d100' }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(2);
    expect(result.executedRolls).toEqual([]);

    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResult = (
      secondCall.messages[secondCall.messages.length - 1] as {
        content: Anthropic.ContentBlockParam[];
      }
    ).content[0] as Anthropic.ToolResultBlockParam;
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/Invalid roll_dice input/);
  });

  it('returns is_error tool_result when DiceService throws and lets Claude recover', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_roll', 'roll_dice', {
            notation: '1d7',
            purpose: 'x',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const rollForGm = vi.fn(() => {
      throw new Error('Unsupported die sides: d7');
    });
    const { service } = makeService(callSession, { rollForGm });

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(2);
    expect(result.executedRolls).toEqual([]);

    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResult = (
      secondCall.messages[secondCall.messages.length - 1] as {
        content: Anthropic.ContentBlockParam[];
      }
    ).content[0] as Anthropic.ToolResultBlockParam;
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/d7/);
  });

  it('returns is_error tool_result for an unknown tool name', async () => {
    callSession
      .mockResolvedValueOnce(message([toolUse('toolu_x', 'mystery_tool', {})]))
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(2);

    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResult = (
      secondCall.messages[secondCall.messages.length - 1] as {
        content: Anthropic.ContentBlockParam[];
      }
    ).content[0] as Anthropic.ToolResultBlockParam;
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/Unknown tool/);
  });

  it('throws SessionToolLoopError on iteration cap exhaustion', async () => {
    // Claude never calls submit_gm_response — always rolls, forever.
    callSession.mockResolvedValue(
      message([
        toolUse('toolu_roll', 'roll_dice', {
          notation: '1d100',
          purpose: 'x',
        }),
      ]),
    );
    const { service } = makeService(callSession);

    await expect(service.runInnerToolLoop(loopArgs)).rejects.toBeInstanceOf(
      SessionToolLoopError,
    );
    // Called once per iteration up to the cap (inclusive); the (cap+1)-th
    // call would break the invariant.
    expect(callSession).toHaveBeenCalledTimes(INNER_TOOL_LOOP_CAP);
  });

  it('throws SessionOutputError when Claude returns a message with no tool_use blocks', async () => {
    callSession.mockResolvedValueOnce(
      message([{ type: 'text', text: 'plain text' } as Anthropic.ContentBlock]),
    );
    const { service } = makeService(callSession);

    await expect(service.runInnerToolLoop(loopArgs)).rejects.toBeInstanceOf(
      SessionOutputError,
    );
  });

  it('throws SessionOutputError when submit_gm_response input fails schema validation', async () => {
    callSession.mockResolvedValueOnce(
      message([submitGmBlock({ playerText: 123 })]),
    );
    const { service } = makeService(callSession);

    await expect(service.runInnerToolLoop(loopArgs)).rejects.toBeInstanceOf(
      SessionOutputError,
    );
  });
});
