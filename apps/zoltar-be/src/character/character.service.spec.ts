import { ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CharacterService } from './character.service';

import type { MothershipCharacterSheet } from '@uv/game-systems';

function mockRepo() {
  return {
    insert: vi.fn(),
    findByCampaignId: vi.fn(),
    existsForCampaign: vi.fn(),
  };
}

function mockCampaignService() {
  return {
    assertMember: vi.fn().mockResolvedValue(undefined),
  };
}

const fakeData: MothershipCharacterSheet = {
  entityId: 'vasquez',
  name: 'Vasquez',
  class: 'marine',
  stats: {
    strength: 40,
    speed: 35,
    intellect: 30,
    combat: 45,
    instinct: 30,
    sanity: 30,
  },
  saves: { fear: 30, body: 30, armor: 30, armorMax: 30 },
  currentHp: 20,
  maxHp: 20,
  stress: { current: 0, max: 3 },
  skills: ['Heavy weapons'],
  equipment: ['Pulse rifle'],
};

const fakeCharacter = {
  id: 'ch1',
  campaignId: 'c1',
  userId: 'u1',
  system: 'mothership',
  schemaVersion: 1,
  data: fakeData,
  updatedAt: new Date(),
};

describe('CharacterService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let campaignSvc: ReturnType<typeof mockCampaignService>;
  let service: CharacterService;

  beforeEach(() => {
    repo = mockRepo();
    campaignSvc = mockCampaignService();
    service = new CharacterService(repo as any, campaignSvc as any);
  });

  describe('create', () => {
    it('checks membership and creates a character', async () => {
      repo.existsForCampaign.mockResolvedValue(false);
      repo.insert.mockResolvedValue(fakeCharacter);

      const result = await service.create('c1', 'u1', fakeData);

      expect(campaignSvc.assertMember).toHaveBeenCalledWith('c1', 'u1');
      expect(repo.existsForCampaign).toHaveBeenCalledWith('c1');
      expect(repo.insert).toHaveBeenCalledWith({
        campaignId: 'c1',
        userId: 'u1',
        data: fakeData,
      });
      expect(result).toEqual(fakeCharacter);
    });

    it('throws ForbiddenException when not a member', async () => {
      campaignSvc.assertMember.mockRejectedValue(new ForbiddenException());

      await expect(service.create('c1', 'u1', fakeData)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('throws ConflictException when campaign already has a character', async () => {
      repo.existsForCampaign.mockResolvedValue(true);

      await expect(service.create('c1', 'u1', fakeData)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });
});
