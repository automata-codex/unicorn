import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  // A regular function, not an arrow function: `new Anthropic(...)` in the
  // service under test needs something constructible, and arrow functions
  // have no [[Construct]] — `new` on one throws "is not a constructor".
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: mockCreate } };
  }),
}));

import { AnthropicService } from './anthropic.service';

import type { ConfigService } from '@nestjs/config';

function fakeConfig(): ConfigService {
  return { getOrThrow: () => 'fake-api-key' } as unknown as ConfigService;
}

const SESSION_PARAMS = {
  systemBlocks: [],
  messages: [],
  tools: [],
  toolChoice: { type: 'auto' as const },
};

const MESSAGES_PARAMS = {
  system: 'system prompt',
  messages: [],
  tools: [],
  toolChoice: { type: 'any' as const },
};

describe('AnthropicService', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ content: [] });
  });

  describe('callSession', () => {
    it('forwards temperature when given', async () => {
      const service = new AnthropicService(fakeConfig());
      await service.callSession({ ...SESSION_PARAMS, temperature: 0.3 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.3 }),
      );
    });

    it('omits the temperature key entirely when not given', async () => {
      const service = new AnthropicService(fakeConfig());
      await service.callSession(SESSION_PARAMS);

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect('temperature' in callArgs).toBe(false);
    });
  });

  describe('callMessages', () => {
    it('forwards temperature when given', async () => {
      const service = new AnthropicService(fakeConfig());
      await service.callMessages({ ...MESSAGES_PARAMS, temperature: 0 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0 }),
      );
    });

    it('omits the temperature key entirely when not given', async () => {
      const service = new AnthropicService(fakeConfig());
      await service.callMessages(MESSAGES_PARAMS);

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect('temperature' in callArgs).toBe(false);
    });
  });
});
