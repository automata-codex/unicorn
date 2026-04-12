import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdventureController } from './adventure.controller';

const fakeUser = { id: 'u1', email: 'a@x.com', name: 'Alice' };

function mockAdventureService() {
  return {
    create: vi.fn(),
    findAllForCampaign: vi.fn(),
    findById: vi.fn(),
  };
}

function mockReply() {
  const reply: any = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply;
}

describe('AdventureController', () => {
  let svc: ReturnType<typeof mockAdventureService>;
  let controller: AdventureController;

  beforeEach(() => {
    svc = mockAdventureService();
    controller = new AdventureController(svc as any);
  });

  describe('POST /campaigns/:campaignId/adventures', () => {
    it('creates an adventure and returns 202', async () => {
      const adventure = {
        id: 'a1',
        campaignId: 'c1',
        status: 'synthesizing',
        createdAt: new Date(),
      };
      svc.create.mockResolvedValue(adventure);
      const reply = mockReply();

      await controller.create('c1', {}, fakeUser, reply);

      expect(svc.create).toHaveBeenCalledWith('c1', 'u1');
      expect(reply.status).toHaveBeenCalledWith(202);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1', status: 'synthesizing' }),
      );
    });

    it('propagates ForbiddenException from membership check', async () => {
      svc.create.mockRejectedValue(new ForbiddenException());
      const reply = mockReply();

      await expect(controller.create('c1', {}, fakeUser, reply)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('GET /campaigns/:campaignId/adventures', () => {
    it('returns adventures for the campaign', async () => {
      const adventures = [{ id: 'a1', status: 'synthesizing' }];
      svc.findAllForCampaign.mockResolvedValue(adventures);

      const result = await controller.list('c1', fakeUser);
      expect(svc.findAllForCampaign).toHaveBeenCalledWith('c1', 'u1');
      expect(result).toEqual(adventures);
    });
  });

  describe('GET /campaigns/:campaignId/adventures/:adventureId', () => {
    it('returns the adventure when found', async () => {
      const adventure = { id: 'a1', status: 'synthesizing' };
      svc.findById.mockResolvedValue(adventure);

      const result = await controller.findOne('c1', 'a1', fakeUser);
      expect(svc.findById).toHaveBeenCalledWith('c1', 'a1', 'u1');
      expect(result).toEqual(adventure);
    });

    it('throws NotFoundException when not found', async () => {
      svc.findById.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('c1', 'missing', fakeUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
