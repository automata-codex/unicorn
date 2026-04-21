import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { SessionController } from './session.controller';
import {
  SessionCorrectionError,
  SessionOutputError,
  SessionPreconditionError,
} from './session.service';

const fakeUser = { id: 'u1', email: 'a@x.test', name: 'Alice' };

function mockAdventureService(
  status: 'ready' | 'synthesizing' | 'failed' | 'completed' = 'ready',
) {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 'a1',
      campaignId: 'c1',
      status,
    }),
  };
}

function mockSessionService() {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      message: {
        id: 'msg-gm-1',
        adventureId: 'a1',
        role: 'gm',
        content: 'The airlock is sealed.',
        createdAt: new Date('2026-04-17T12:00:00Z'),
      },
      applied: {
        resourcePools: {},
        entities: {},
        flags: {},
        scenarioState: {},
        worldFacts: {},
      },
      thresholds: [],
    }),
  };
}

describe('SessionController', () => {
  let sessionService: ReturnType<typeof mockSessionService>;
  let adventureService: ReturnType<typeof mockAdventureService>;
  let controller: SessionController;

  beforeEach(() => {
    sessionService = mockSessionService();
    adventureService = mockAdventureService();
    controller = new SessionController(
      sessionService as never,
      adventureService as never,
    );
  });

  const dto = { content: 'I check the airlock.' };

  describe('happy path', () => {
    it('returns the persisted GM message, applied deltas, and thresholds', async () => {
      const result = await controller.sendMessage('c1', 'a1', dto, fakeUser);
      expect(adventureService.findById).toHaveBeenCalledWith('c1', 'a1', 'u1');
      expect(sessionService.sendMessage).toHaveBeenCalledWith({
        adventureId: 'a1',
        campaignId: 'c1',
        playerUserId: 'u1',
        playerMessage: 'I check the airlock.',
      });
      expect(result.message.role).toBe('assistant');
      expect(result.message.content).toBe('The airlock is sealed.');
      expect(result.message.createdAt).toBe('2026-04-17T12:00:00.000Z');
      expect(result.applied).toBeDefined();
      expect(result.thresholds).toEqual([]);
    });
  });

  describe('preconditions', () => {
    it.each([
      ['synthesizing'] as const,
      ['failed'] as const,
      ['completed'] as const,
    ])('returns 409 when adventure status is %s', async (status) => {
      adventureService = mockAdventureService(status);
      controller = new SessionController(
        sessionService as never,
        adventureService as never,
      );
      await expect(
        controller.sendMessage('c1', 'a1', dto, fakeUser),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sessionService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 409 when the service raises SessionPreconditionError', async () => {
      sessionService.sendMessage.mockRejectedValue(
        new SessionPreconditionError('gm_context missing'),
      );
      await expect(
        controller.sendMessage('c1', 'a1', dto, fakeUser),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('error mapping', () => {
    it('returns 502 when the service raises SessionOutputError', async () => {
      sessionService.sendMessage.mockRejectedValue(
        new SessionOutputError('tool input failed validation'),
      );
      await expect(
        controller.sendMessage('c1', 'a1', dto, fakeUser),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('returns 502 with gm_correction_failed code when SessionCorrectionError fires', async () => {
      sessionService.sendMessage.mockRejectedValue(
        new SessionCorrectionError('both rounds rejected', [], []),
      );
      await expect(
        controller.sendMessage('c1', 'a1', dto, fakeUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'gm_correction_failed' }),
        status: 502,
      });
    });

    it('propagates unknown errors unchanged', async () => {
      sessionService.sendMessage.mockRejectedValue(new Error('boom'));
      await expect(
        controller.sendMessage('c1', 'a1', dto, fakeUser),
      ).rejects.toThrow('boom');
    });
  });

  describe('body validation (pipe behavior)', () => {
    it('rejects an empty content string via ZodValidationPipe', () => {
      const pipe = new ZodValidationPipe(
        z.object({ content: z.string().min(1) }),
      );
      expect(() => pipe.transform({ content: '' })).toThrow(
        BadRequestException,
      );
    });
  });
});
