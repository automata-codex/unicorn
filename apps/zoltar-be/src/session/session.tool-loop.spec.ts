import { emptyMothershipState } from '@uv/game-systems';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INNER_TOOL_LOOP_CAP,
  SessionOutputError,
  SessionService,
  SessionToolLoopError,
  SessionToolSyntaxError,
  TOOL_SYNTAX_RETRY_BUDGET,
} from './session.service';

import type Anthropic from '@anthropic-ai/sdk';
import type {
  AnthropicService,
  CallSessionParams,
} from '../anthropic/anthropic.service';
import type { CampaignRepository } from '../campaign/campaign.repository';
import type { DiceService } from '../dice/dice.service';
import type { RulesLookupService } from '../rules/rules-lookup.service';
import type { WardenPromptsService } from '../wardens/warden-prompts.service';
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
    lookup:
      overrides.lookup ??
      // `lookup` returns the tool payload in `output`, with preprocessing
      // metadata alongside it — the metadata must never reach the tool_result.
      vi.fn().mockResolvedValue({ output: { results: [] } }),
  } as unknown as RulesLookupService;
  const repo = {} as unknown as SessionRepository;
  const campaignRepo = {
    getStateData: vi.fn().mockResolvedValue(emptyMothershipState()),
    getSystemId: vi.fn().mockResolvedValue('system-uuid-mothership'),
    getSystemSlug: vi.fn().mockResolvedValue('mothership'),
  } as unknown as CampaignRepository;
  // Keyed by slug and throwing on a miss, like the real service — an
  // arg-ignoring stub would accept the `getSystemId` UUID just as happily.
  const wardens = {
    getSelected: vi.fn((system: string) => {
      if (system !== 'mothership') {
        throw new Error(`No Warden prompt available for system '${system}'.`);
      }
      return {
        filename: 'mothership-m7.txt',
        hash: 'testhash',
        text: 'Test Warden prompt.',
      };
    }),
  } as unknown as WardenPromptsService;
  return {
    service: new SessionService(
      repo,
      anthropic,
      campaignRepo,
      dice,
      rules,
      wardens,
    ),
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

/**
 * `loopArgs` with a known-entity set, so `actingEntityId` is validated.
 *
 * Kept separate rather than folded into `loopArgs` because the empty-set case
 * is a real production state — a campaign with no `character_sheet` row makes
 * `getPlayerEntityIds` return `[]` — and every other test in this file should
 * keep exercising it.
 */
const loopArgsWithEntities = {
  ...loopArgs,
  knownEntityIds: ['corporate_spy_1', 'lt_alvarez'],
  // The check is gated on `playerEntityIds`, not on the union: a campaign with
  // seeded NPCs but no character sheet cannot have a set that contains the
  // player, so rejecting against it would reject every player roll (M7.6 §1.3).
  playerEntityIds: ['lt_alvarez'],
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
            actingEntityId: 'alvarez',
            rollType: 'panic_check',
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
        rollId: 'roll_1',
        notation: '1d100',
        purpose: 'Panic check',
        results: [73],
        modifier: 0,
        total: 73,
        rollType: 'panic_check',
        actingEntityId: 'alvarez',
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
            actingEntityId: 'alvarez',
            rollType: 'check',
          }),
          toolUse('toolu_2', 'roll_dice', {
            notation: '2d6',
            purpose: 'B',
            actingEntityId: 'corporate_spy_1',
            rollType: 'damage',
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
            actingEntityId: 'alvarez',
            rollType: 'panic_check',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const lookup = vi.fn().mockResolvedValue({
      output: {
        results: [
          {
            text: 'On 71–80…',
            source: 'PSG p.42',
            similarity: 0.87,
          },
        ],
      },
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

  it('allocates rollIds in issue order and hands each back in its tool_result', async () => {
    // `gatedByRollId` is useless unless Claude can see the id to reference,
    // and it cannot be the game_events row id — that UUID is minted when the
    // turn is written, after this loop has already ended.
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '1d100',
            purpose: 'To-hit',
            actingEntityId: 'corporate_spy_1',
            rollType: 'check',
          }),
          toolUse('toolu_2', 'roll_dice', {
            notation: '2d6',
            purpose: 'Damage if it hit',
            actingEntityId: 'corporate_spy_1',
            rollType: 'damage',
            gatedByRollId: 'roll_1',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    let n = 0;
    const rollForGm = vi.fn((input: { notation: string }) => {
      n++;
      return {
        notation: input.notation,
        results: n === 1 ? [42] : [3, 4],
        modifier: 0,
        total: n === 1 ? 42 : 7,
      };
    });
    const { service } = makeService(callSession, { rollForGm });

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.executedRolls.map((r) => r.rollId)).toEqual([
      'roll_1',
      'roll_2',
    ]);
    expect(result.executedRolls[1].gatedByRollId).toBe('roll_1');

    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResultTurn = secondCall.messages[
      secondCall.messages.length - 1
    ] as { content: Anthropic.ToolResultBlockParam[] };
    expect(toolResultTurn.content[0].content).toMatch(/"rollId":"roll_1"/);
    expect(toolResultTurn.content[1].content).toMatch(/"rollId":"roll_2"/);
  });

  it('rejects a gatedByRollId that names no roll from this turn, listing the ids that exist', async () => {
    // A dangling reference is worse than no reference: it makes
    // out-of-order-resolution's in-turn case look decidable while pointing at
    // nothing, which is a false verdict rather than a missing one.
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '1d100',
            purpose: 'To-hit',
            actingEntityId: 'corporate_spy_1',
            rollType: 'check',
          }),
          toolUse('toolu_2', 'roll_dice', {
            notation: '2d6',
            purpose: 'Damage',
            actingEntityId: 'corporate_spy_1',
            rollType: 'damage',
            gatedByRollId: 'roll_7',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const rollForGm = vi.fn((input: { notation: string }) => ({
      notation: input.notation,
      results: [42],
      modifier: 0,
      total: 42,
    }));
    const { service } = makeService(callSession, { rollForGm });

    const result = await service.runInnerToolLoop(loopArgs);

    // The first roll still lands; only the dangling one is refused.
    expect(result.executedRolls.map((r) => r.rollId)).toEqual(['roll_1']);

    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResultTurn = secondCall.messages[
      secondCall.messages.length - 1
    ] as { content: Anthropic.ToolResultBlockParam[] };
    expect(toolResultTurn.content[1]).toMatchObject({
      tool_use_id: 'toolu_2',
      is_error: true,
    });
    expect(toolResultTurn.content[1].content).toMatch(/roll_7/);
    expect(toolResultTurn.content[1].content).toMatch(
      /Available this turn: roll_1/,
    );
  });

  it('tells Claude to omit gatedByRollId when no roll has resolved yet this turn', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '2d6',
            purpose: 'Damage',
            actingEntityId: 'corporate_spy_1',
            rollType: 'damage',
            gatedByRollId: 'roll_1',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.executedRolls).toEqual([]);
    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResult = (
      secondCall.messages[secondCall.messages.length - 1] as {
        content: Anthropic.ToolResultBlockParam[];
      }
    ).content[0];
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/omit gatedByRollId/);
  });

  it('returns is_error tool_result when roll_dice input is invalid and lets Claude recover', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          // Missing `purpose`, `actingEntityId`, `rollType` → Zod reject.
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
            actingEntityId: 'alvarez',
            rollType: 'other',
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

  it('throws SessionToolLoopError on iteration cap exhaustion, with a per-iteration tool-call summary distinguishing dice spam from a stuck loop', async () => {
    // Claude never calls submit_gm_response — always rolls, forever.
    callSession.mockResolvedValue(
      message([
        toolUse('toolu_roll', 'roll_dice', {
          notation: '1d100',
          purpose: 'x',
          actingEntityId: 'alvarez',
          rollType: 'check',
        }),
      ]),
    );
    const { service } = makeService(callSession);

    const expectedToolCalls = Array(INNER_TOOL_LOOP_CAP)
      .fill('roll_dice')
      .join(', ');
    const expectedRolls = Array(INNER_TOOL_LOOP_CAP)
      .fill('1d100 for "x"=50')
      .join('; ');
    await expect(service.runInnerToolLoop(loopArgs)).rejects.toMatchObject({
      message: `Inner tool loop did not terminate within ${INNER_TOOL_LOOP_CAP} iterations for adventure=adv-1. Tool calls per iteration: [${expectedToolCalls}]. Rolls: [${expectedRolls}]. Lookups: []`,
    });
    // Called once per iteration up to the cap (inclusive); the (cap+1)-th
    // call would break the invariant.
    expect(callSession).toHaveBeenCalledTimes(INNER_TOOL_LOOP_CAP);
  });

  it('lists distinct roll purposes and lookup queries in the exhaustion summary, not just counts', async () => {
    // A busy-but-legitimate turn: a different purpose each time, not the
    // same check repeated — the summary should make that distinguishable
    // from a stuck loop re-rolling for the same reason.
    let call = 0;
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    callSession.mockImplementation(() => {
      call++;
      return Promise.resolve(
        message([
          toolUse('toolu_lookup', 'rules_lookup', {
            query: `npc_${call} stealth check rule`,
          }),
        ]),
      );
    });
    const { service } = makeService(callSession);

    await expect(service.runInnerToolLoop(loopArgs)).rejects.toMatchObject({
      message: expect.stringContaining(
        'Lookups: ["npc_1 stealth check rule"; "npc_2 stealth check rule"',
      ),
    });
  });

  it('names the invalid field paths in the exhaustion summary when stuck retrying a malformed submit_gm_response', async () => {
    callSession.mockResolvedValue(
      message([
        submitGmBlock({ playerText: 'ok', gmUpdates: 'not an object' }),
      ]),
    );
    const { service } = makeService(callSession);

    await expect(service.runInnerToolLoop(loopArgs)).rejects.toMatchObject({
      message: expect.stringMatching(
        /submit_gm_response\(invalid: gmUpdates\)/,
      ),
    });
    expect(callSession).toHaveBeenCalledTimes(INNER_TOOL_LOOP_CAP);
  });

  it('rejects an actingEntityId that names no known entity and lets Claude recover', async () => {
    // Sonnet 4.6 filled this field with resource pool names 13 times across
    // the frozen 2026-08-09 run — `lt_alvarez_hp`, `alvarez_armor` — because
    // the state snapshot shows it pool names and no player entity, so those
    // are the only id-shaped strings it has to copy. Rejected at the boundary
    // like a dangling gatedByRollId, with the valid ids named so the model can
    // correct itself in-loop.
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '1d10',
            purpose: 'Damage',
            actingEntityId: 'lt_alvarez_hp',
            rollType: 'damage',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgsWithEntities);

    expect(result.iterations).toBe(2);
    // Rejected before rolling: a roll that cannot be attributed must not
    // reach `executedRolls`, or it lands in game_events anyway.
    expect(result.executedRolls).toHaveLength(0);

    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResult = (
      secondCall.messages[secondCall.messages.length - 1] as {
        content: Anthropic.ContentBlockParam[];
      }
    ).content[0] as Anthropic.ToolResultBlockParam;
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/is not a known entity/);
    // The recovery path is only usable if the message says what to use.
    expect(toolResult.content).toMatch(/corporate_spy_1/);
  });

  it('skips the check when NPCs are known but the player is not', async () => {
    // The M7.6 §1.3 fix. Gating on the *union* got this backwards: a campaign
    // with seeded NPCs and no character sheet has a non-empty union, so the
    // check ran against a set that could not contain the player and rejected
    // every one of the player's rolls. The gate is on `playerEntityIds`.
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '1d10',
            purpose: 'Damage',
            actingEntityId: 'lt_alvarez',
            rollType: 'damage',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop({
      ...loopArgs,
      knownEntityIds: ['corporate_spy_1'],
      playerEntityIds: [],
    });

    expect(result.executedRolls).toHaveLength(1);
    expect(result.executedRolls[0].actingEntityId).toBe('lt_alvarez');
  });

  it('rejects a garbage actingEntityId once the player is known', async () => {
    // Same knownEntityIds as the skip case above, plus a player id. The set is
    // complete now, so an id in neither half is genuinely wrong.
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '1d10',
            purpose: 'Damage',
            actingEntityId: 'alvarez_armor',
            rollType: 'damage',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop({
      ...loopArgs,
      knownEntityIds: ['corporate_spy_1', 'lt_alvarez'],
      playerEntityIds: ['lt_alvarez'],
    });

    expect(result.executedRolls).toHaveLength(0);
  });

  it('accepts an actingEntityId naming a player entity, case-insensitively', async () => {
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '1d100',
            purpose: 'Panic check',
            actingEntityId: 'LT_Alvarez',
            rollType: 'panic_check',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgsWithEntities);

    expect(result.executedRolls).toHaveLength(1);
  });

  it('does not validate actingEntityId when no known entities are supplied', async () => {
    // A campaign with no `character_sheet` row yields `playerEntityIds: []`,
    // and validating against a set that is missing the player would reject
    // every one of the player's own rolls. No set, no opinion.
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_1', 'roll_dice', {
            notation: '1d10',
            purpose: 'Damage',
            actingEntityId: 'whoever_this_is',
            rollType: 'damage',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock()]));
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.executedRolls).toHaveLength(1);
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

  it('retries and recovers when submit_gm_response input fails schema validation', async () => {
    callSession
      .mockResolvedValueOnce(message([submitGmBlock({ playerText: 123 })]))
      .mockResolvedValueOnce(
        message([submitGmBlock({ playerText: 'The door opens.' })]),
      );
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(2);
    expect(result.finalParsed.playerText).toBe('The door opens.');

    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResult = (
      secondCall.messages[secondCall.messages.length - 1] as {
        content: Anthropic.ContentBlockParam[];
      }
    ).content[0] as Anthropic.ToolResultBlockParam;
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/Invalid submit_gm_response input/);
  });

  it('throws SessionToolLoopError when submit_gm_response never passes schema validation', async () => {
    // Claude keeps sending a malformed gmUpdates (string instead of object)
    // no matter how many times it's corrected.
    callSession.mockResolvedValue(
      message([submitGmBlock({ gmUpdates: 'not an object' })]),
    );
    const { service } = makeService(callSession);

    await expect(service.runInnerToolLoop(loopArgs)).rejects.toBeInstanceOf(
      SessionToolLoopError,
    );
    expect(callSession).toHaveBeenCalledTimes(INNER_TOOL_LOOP_CAP);
  });

  // A payload that serialized its own parameters into `playerText` is
  // schema-valid — `playerText` is the only required field — so before this
  // guard it terminated the loop, shipped the markup to the player, and
  // dropped every state change without a log line.
  const LEAKED_PAYLOAD = {
    playerText:
      'The lever refuses to move.</playerText>\n' +
      '<parameter name="stateChanges">{"resourcePools":[{"owner":"dr_kennedy","pool":"hp","delta":-12}]}</parameter>',
  };

  it('rejects a leaked payload and recovers on the retry', async () => {
    callSession
      .mockResolvedValueOnce(message([submitGmBlock(LEAKED_PAYLOAD)]))
      .mockResolvedValueOnce(
        message([submitGmBlock({ playerText: 'The lever refuses to move.' })]),
      );
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(2);
    expect(result.finalParsed.playerText).toBe('The lever refuses to move.');
  });

  it('tells Claude to resend the parameters as parameters', async () => {
    callSession
      .mockResolvedValueOnce(message([submitGmBlock(LEAKED_PAYLOAD)]))
      .mockResolvedValueOnce(
        message([submitGmBlock({ playerText: 'The lever holds.' })]),
      );
    const { service } = makeService(callSession);

    await service.runInnerToolLoop(loopArgs);

    const secondCall = callSession.mock.calls[1][0] as CallSessionParams;
    const toolResult = (
      secondCall.messages[secondCall.messages.length - 1] as {
        content: Anthropic.ContentBlockParam[];
      }
    ).content[0] as Anthropic.ToolResultBlockParam;
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toMatch(/raw tool-call syntax/);
    expect(toolResult.content).toMatch(/separate tool parameters/);
  });

  it('abandons the turn after one retry rather than spending the whole loop', async () => {
    // The 2026-08-18 re-baseline produced ten consecutive leaked payloads on
    // one turn and no recovery, so the retry budget is one — the number
    // `ADR-0041` argues for everywhere else in the turn path.
    callSession.mockResolvedValue(message([submitGmBlock(LEAKED_PAYLOAD)]));
    const { service } = makeService(callSession);

    await expect(service.runInnerToolLoop(loopArgs)).rejects.toBeInstanceOf(
      SessionToolSyntaxError,
    );
    expect(callSession).toHaveBeenCalledTimes(TOOL_SYNTAX_RETRY_BUDGET + 1);
  });

  it('names the leak in the error rather than reporting cap exhaustion', async () => {
    // The two 502s mean opposite things: one is "still working", this one is
    // "finished the same wrong way twice".
    callSession.mockResolvedValue(message([submitGmBlock(LEAKED_PAYLOAD)]));
    const { service } = makeService(callSession);

    await expect(service.runInnerToolLoop(loopArgs)).rejects.toThrow(
      /leaked tool-call syntax 2 times in a row/,
    );
  });

  it('does not spend the budget on a busy turn that leaks only once', async () => {
    // Decoupling the two caps is half the point: a turn that has already
    // spent iterations on legitimate rolls must not get fewer retries.
    callSession
      .mockResolvedValueOnce(
        message([
          toolUse('toolu_r1', 'roll_dice', {
            notation: '1d100',
            purpose: 'probe',
            actingEntityId: 'alvarez',
            rollType: 'check',
          }),
        ]),
      )
      .mockResolvedValueOnce(message([submitGmBlock(LEAKED_PAYLOAD)]))
      .mockResolvedValueOnce(
        message([submitGmBlock({ playerText: 'The lever holds.' })]),
      );
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.finalParsed.playerText).toBe('The lever holds.');
    expect(result.iterations).toBe(3);
  });

  it('gives a fresh budget when the failures alternate mode', async () => {
    // leak → schema-invalid → leak is not the stuck shape, so the counter
    // resets and the turn still gets its retry.
    callSession
      .mockResolvedValueOnce(message([submitGmBlock(LEAKED_PAYLOAD)]))
      .mockResolvedValueOnce(
        message([submitGmBlock({ playerText: 1 as unknown as string })]),
      )
      .mockResolvedValueOnce(message([submitGmBlock(LEAKED_PAYLOAD)]))
      .mockResolvedValueOnce(
        message([submitGmBlock({ playerText: 'Recovered.' })]),
      );
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.finalParsed.playerText).toBe('Recovered.');
  });

  it('does not trip on narration that merely contains an angle bracket', async () => {
    callSession.mockResolvedValueOnce(
      message([
        submitGmBlock({
          playerText: 'Her pulse is < 40. The stencil reads <MANUAL OVERRIDE>.',
        }),
      ]),
    );
    const { service } = makeService(callSession);

    const result = await service.runInnerToolLoop(loopArgs);

    expect(result.iterations).toBe(1);
  });
});
