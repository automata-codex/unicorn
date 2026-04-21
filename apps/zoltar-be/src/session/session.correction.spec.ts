import { describe, expect, it } from 'vitest';

import { buildCorrectionRequest } from './session.correction';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { ValidationRejection } from './session.validator';

function originalRequest(): CallSessionParams {
  return {
    systemBlocks: [{ type: 'text', text: 'warden system prompt' }],
    messages: [
      { role: 'user', content: '<state_snapshot>...</state_snapshot>' },
      { role: 'user', content: 'Open the door.' },
    ],
    tools: [{ name: 'submit_gm_response' } as unknown as Anthropic.Tool],
    toolChoice: { type: 'tool', name: 'submit_gm_response' },
  };
}

function originalAssistantWithToolUse(toolUseId: string): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
    content: [
      {
        type: 'tool_use',
        id: toolUseId,
        name: 'submit_gm_response',
        input: { playerText: '...', stateChanges: {} },
      },
    ],
  } as unknown as Anthropic.Message;
}

const rejections: ValidationRejection[] = [
  {
    path: 'resourcePools.xenomorph_hp',
    reason:
      'Pool does not exist — bootstrap with a positive delta before applying damage or spending.',
    received: { delta: -3 },
  },
  {
    path: 'flags.secret_door_found',
    reason: 'New flag requires a trigger string.',
    received: { value: true },
  },
];

describe('buildCorrectionRequest', () => {
  it('appends the original assistant response and a tool_result user turn', () => {
    const request = originalRequest();
    const assistant = originalAssistantWithToolUse('toolu_1');

    const corrected = buildCorrectionRequest({
      originalRequest: request,
      originalAssistant: assistant,
      rejections,
    });

    expect(corrected.messages).toHaveLength(request.messages.length + 2);
    const appendedAssistant = corrected.messages[corrected.messages.length - 2];
    expect(appendedAssistant.role).toBe('assistant');
    expect(appendedAssistant.content).toBe(assistant.content);

    const userTurn = corrected.messages[corrected.messages.length - 1];
    expect(userTurn.role).toBe('user');
    expect(Array.isArray(userTurn.content)).toBe(true);
    const blocks = userTurn.content as Anthropic.ContentBlockParam[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('tool_result');
  });

  it('sets tool_use_id on the tool_result to match the original tool call', () => {
    const corrected = buildCorrectionRequest({
      originalRequest: originalRequest(),
      originalAssistant: originalAssistantWithToolUse('toolu_abc'),
      rejections,
    });
    const blocks = (
      corrected.messages[corrected.messages.length - 1]
        .content as Anthropic.ContentBlockParam[]
    )[0] as Anthropic.ToolResultBlockParam;
    expect(blocks.tool_use_id).toBe('toolu_abc');
    expect(blocks.is_error).toBe(true);
  });

  it('includes every rejection, one per line, in the tool_result text', () => {
    const corrected = buildCorrectionRequest({
      originalRequest: originalRequest(),
      originalAssistant: originalAssistantWithToolUse('toolu_1'),
      rejections,
    });
    const toolResult = (
      corrected.messages[corrected.messages.length - 1]
        .content as Anthropic.ContentBlockParam[]
    )[0] as Anthropic.ToolResultBlockParam;
    const text = (
      toolResult.content as Array<{ type: 'text'; text: string }>
    )[0].text;

    expect(text).toContain('- resourcePools.xenomorph_hp:');
    expect(text).toContain('- flags.secret_door_found:');
    expect(text).toContain('Re-narrate this turn');
  });

  it('preserves tool_choice, tools, and systemBlocks from the original request', () => {
    const request = originalRequest();
    const corrected = buildCorrectionRequest({
      originalRequest: request,
      originalAssistant: originalAssistantWithToolUse('toolu_1'),
      rejections,
    });
    expect(corrected.toolChoice).toEqual(request.toolChoice);
    expect(corrected.tools).toBe(request.tools);
    expect(corrected.systemBlocks).toBe(request.systemBlocks);
  });

  it('throws when the original assistant response has no submit_gm_response tool_use', () => {
    const assistantWithoutToolUse = {
      ...originalAssistantWithToolUse('toolu_1'),
      content: [{ type: 'text', text: 'just text' }],
    } as unknown as Anthropic.Message;

    expect(() =>
      buildCorrectionRequest({
        originalRequest: originalRequest(),
        originalAssistant: assistantWithoutToolUse,
        rejections,
      }),
    ).toThrow(/submit_gm_response tool_use/);
  });
});
