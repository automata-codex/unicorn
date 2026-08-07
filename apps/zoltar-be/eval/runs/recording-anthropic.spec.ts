import { describe, expect, it, vi } from 'vitest';

import { RecordingAnthropicService } from './recording-anthropic';

import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicService } from '../../src/anthropic/anthropic.service';

function fakeMessage(id: string): Anthropic.Message {
  return { id, content: [] } as unknown as Anthropic.Message;
}

function fakeInner(): {
  service: AnthropicService;
  callSession: ReturnType<typeof vi.fn>;
  callMessages: ReturnType<typeof vi.fn>;
} {
  const callSession = vi
    .fn()
    .mockResolvedValue(fakeMessage('session-response'));
  const callMessages = vi
    .fn()
    .mockResolvedValue(fakeMessage('messages-response'));
  return {
    service: { callSession, callMessages } as unknown as AnthropicService,
    callSession,
    callMessages,
  };
}

const BASE_SESSION_PARAMS = {
  systemBlocks: [],
  messages: [],
  tools: [],
  toolChoice: { type: 'auto' as const },
};

describe('RecordingAnthropicService', () => {
  it('forces model and temperature on callSession even when the caller supplied neither', async () => {
    const inner = fakeInner();
    const recorder = new RecordingAnthropicService(
      inner.service,
      'claude-sonnet-4-6',
      0.7,
    );

    await recorder.callSession(BASE_SESSION_PARAMS);

    expect(inner.callSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6', temperature: 0.7 }),
    );
  });

  it("overrides a caller-supplied model — the harness's --model wins", async () => {
    const inner = fakeInner();
    const recorder = new RecordingAnthropicService(
      inner.service,
      'claude-sonnet-4-6',
      1.0,
    );

    await recorder.callSession({
      ...BASE_SESSION_PARAMS,
      model: 'claude-opus-5',
    });

    expect(inner.callSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('forwards callMessages byte-identically, injecting no model or temperature', async () => {
    const inner = fakeInner();
    const recorder = new RecordingAnthropicService(
      inner.service,
      'claude-sonnet-4-6',
      0.7,
    );
    const params = {
      system: 'system prompt',
      messages: [],
      tools: [],
      toolChoice: { type: 'any' as const },
    };

    await recorder.callMessages(params);

    expect(inner.callMessages).toHaveBeenCalledWith(params);
    expect(inner.callMessages).toHaveBeenCalledTimes(1);
  });

  it('accumulates multiple callSession calls within one beginFixture() in order', async () => {
    const inner = fakeInner();
    inner.callSession
      .mockResolvedValueOnce(fakeMessage('first'))
      .mockResolvedValueOnce(fakeMessage('second'));
    const recorder = new RecordingAnthropicService(
      inner.service,
      'claude-sonnet-4-6',
      1.0,
    );

    recorder.beginFixture();
    await recorder.callSession({ ...BASE_SESSION_PARAMS });
    await recorder.callSession({ ...BASE_SESSION_PARAMS });

    const captured = recorder.takeCaptured();
    expect(captured).toHaveLength(2);
    expect(captured[0].response.id).toBe('first');
    expect(captured[1].response.id).toBe('second');
  });

  it('takeCaptured() clears the buffer', async () => {
    const inner = fakeInner();
    const recorder = new RecordingAnthropicService(
      inner.service,
      'claude-sonnet-4-6',
      1.0,
    );

    recorder.beginFixture();
    await recorder.callSession(BASE_SESSION_PARAMS);
    expect(recorder.takeCaptured()).toHaveLength(1);
    expect(recorder.takeCaptured()).toHaveLength(0);
  });

  it('beginFixture() discards anything left over from a prior fixture', async () => {
    const inner = fakeInner();
    const recorder = new RecordingAnthropicService(
      inner.service,
      'claude-sonnet-4-6',
      1.0,
    );

    await recorder.callSession(BASE_SESSION_PARAMS);
    recorder.beginFixture();
    expect(recorder.takeCaptured()).toHaveLength(0);
  });
});
