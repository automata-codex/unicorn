import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdventureService } from './adventure.service';

function mockRepo() {
  return {
    insert: vi.fn(),
    findAllForCampaign: vi.fn(),
    findById: vi.fn(),
    abort: vi.fn(),
  };
}

function mockCampaignService() {
  return {
    assertMember: vi.fn().mockResolvedValue(undefined),
  };
}

const fakeAdventure = {
  id: 'a1',
  campaignId: 'c1',
  status: 'synthesizing' as const,
  mode: 'freeform' as const,
  callerId: 'u1',
  createdAt: new Date(),
  completedAt: null,
};

describe('AdventureService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let campaignSvc: ReturnType<typeof mockCampaignService>;
  let service: AdventureService;

  beforeEach(() => {
    repo = mockRepo();
    campaignSvc = mockCampaignService();
    service = new AdventureService(repo as any, campaignSvc as any);
  });

  describe('create', () => {
    it('checks membership and creates an adventure', async () => {
      repo.insert.mockResolvedValue(fakeAdventure);

      const result = await service.create('c1', 'u1');

      expect(campaignSvc.assertMember).toHaveBeenCalledWith('c1', 'u1');
      expect(repo.insert).toHaveBeenCalledWith({
        campaignId: 'c1',
        callerId: 'u1',
      });
      expect(result).toEqual(fakeAdventure);
    });

    it('throws ForbiddenException when not a member', async () => {
      campaignSvc.assertMember.mockRejectedValue(new ForbiddenException());

      await expect(service.create('c1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe('findAllForCampaign', () => {
    it('checks membership and returns adventures', async () => {
      repo.findAllForCampaign.mockResolvedValue([fakeAdventure]);

      const result = await service.findAllForCampaign('c1', 'u1');

      expect(campaignSvc.assertMember).toHaveBeenCalledWith('c1', 'u1');
      expect(result).toEqual([fakeAdventure]);
    });
  });

  describe('findById', () => {
    it('returns the adventure when found', async () => {
      repo.findById.mockResolvedValue(fakeAdventure);

      const result = await service.findById('c1', 'a1', 'u1');
      expect(result).toEqual(fakeAdventure);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.findById('c1', 'missing', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('abort', () => {
    it('checks membership and returns the aborted adventure', async () => {
      repo.findById.mockResolvedValue(fakeAdventure);
      const abortedAdventure = {
        id: 'a1',
        status: 'aborted',
        completedAt: new Date(),
      };
      repo.abort.mockResolvedValue(abortedAdventure);

      const result = await service.abort('c1', 'a1', 'u1');

      expect(campaignSvc.assertMember).toHaveBeenCalledWith('c1', 'u1');
      expect(repo.abort).toHaveBeenCalledWith('a1');
      expect(result).toEqual(abortedAdventure);
    });

    it('throws NotFoundException when the adventure does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.abort('c1', 'missing', 'u1')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.abort).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the adventure is not active', async () => {
      repo.findById.mockResolvedValue({
        ...fakeAdventure,
        status: 'completed',
      });
      repo.abort.mockResolvedValue(null);

      await expect(service.abort('c1', 'a1', 'u1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ForbiddenException when not a member', async () => {
      campaignSvc.assertMember.mockRejectedValue(new ForbiddenException());

      await expect(service.abort('c1', 'a1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });
});
