import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignService } from './campaign.service';

function mockRepo() {
  return {
    findGameSystemBySlug: vi.fn(),
    insertCampaign: vi.fn(),
    insertMember: vi.fn().mockResolvedValue(undefined),
    insertState: vi.fn().mockResolvedValue(undefined),
    findAllForUser: vi.fn(),
    findById: vi.fn(),
    findMember: vi.fn(),
    findOwner: vi.fn(),
    hasActiveAdventure: vi.fn().mockResolvedValue(false),
    deleteCampaign: vi.fn(),
  };
}

const fakeCampaign = {
  id: 'c1',
  name: 'Test Campaign',
  systemId: 'sys1',
  visibility: 'private' as const,
  diceMode: 'soft_accountability' as const,
  createdAt: new Date(),
  orgId: null,
};

describe('CampaignService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let service: CampaignService;

  beforeEach(() => {
    repo = mockRepo();
    service = new CampaignService(repo as any);
  });

  describe('create', () => {
    it('creates campaign, membership, and state', async () => {
      repo.findGameSystemBySlug.mockResolvedValue({
        id: 'sys1',
        slug: 'mothership',
      });
      repo.insertCampaign.mockResolvedValue(fakeCampaign);

      const result = await service.create(
        {
          name: 'Test',
          visibility: 'private',
          diceMode: 'soft_accountability',
        },
        'u1',
      );

      expect(result).toEqual(fakeCampaign);
      expect(repo.findGameSystemBySlug).toHaveBeenCalledWith('mothership');
      expect(repo.insertCampaign).toHaveBeenCalledWith({
        systemId: 'sys1',
        name: 'Test',
        visibility: 'private',
        diceMode: 'soft_accountability',
      });
      expect(repo.insertMember).toHaveBeenCalledWith({
        campaignId: 'c1',
        userId: 'u1',
        role: 'owner',
      });
      expect(repo.insertState).toHaveBeenCalledWith({
        campaignId: 'c1',
        system: 'mothership',
        data: expect.objectContaining({ schemaVersion: 1 }),
      });
    });

    it('throws NotFoundException when mothership system is missing', async () => {
      repo.findGameSystemBySlug.mockResolvedValue(null);

      await expect(
        service.create(
          {
            name: 'Test',
            visibility: 'private',
            diceMode: 'soft_accountability',
          },
          'u1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('returns the campaign when found', async () => {
      repo.findById.mockResolvedValue(fakeCampaign);
      const result = await service.findById('c1');
      expect(result).toEqual(fakeCampaign);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assertMember', () => {
    it('resolves when user is a member', async () => {
      repo.findMember.mockResolvedValue({
        campaignId: 'c1',
        userId: 'u1',
        role: 'player',
      });
      await expect(service.assertMember('c1', 'u1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when not a member', async () => {
      repo.findMember.mockResolvedValue(null);
      await expect(service.assertMember('c1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('assertOwner', () => {
    it('resolves when user is the owner', async () => {
      repo.findOwner.mockResolvedValue({
        campaignId: 'c1',
        userId: 'u1',
        role: 'owner',
      });
      await expect(service.assertOwner('c1', 'u1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when not the owner', async () => {
      repo.findOwner.mockResolvedValue(null);
      await expect(service.assertOwner('c1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('delete', () => {
    it('checks ownership and deletes the campaign', async () => {
      repo.findOwner.mockResolvedValue({ campaignId: 'c1', userId: 'u1', role: 'owner' });
      repo.deleteCampaign.mockResolvedValue(true);

      await service.delete('c1', 'u1');

      expect(repo.findOwner).toHaveBeenCalledWith('c1', 'u1');
      expect(repo.hasActiveAdventure).toHaveBeenCalledWith('c1');
      expect(repo.deleteCampaign).toHaveBeenCalledWith('c1');
    });

    it('throws ForbiddenException when not the owner', async () => {
      repo.findOwner.mockResolvedValue(null);

      await expect(service.delete('c1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.deleteCampaign).not.toHaveBeenCalled();
    });

    it('throws ConflictException when an adventure is active', async () => {
      repo.findOwner.mockResolvedValue({ campaignId: 'c1', userId: 'u1', role: 'owner' });
      repo.hasActiveAdventure.mockResolvedValue(true);

      await expect(service.delete('c1', 'u1')).rejects.toThrow(
        ConflictException,
      );
      expect(repo.deleteCampaign).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when campaign does not exist', async () => {
      repo.findOwner.mockResolvedValue({ campaignId: 'c1', userId: 'u1', role: 'owner' });
      repo.deleteCampaign.mockResolvedValue(false);

      await expect(service.delete('c1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
