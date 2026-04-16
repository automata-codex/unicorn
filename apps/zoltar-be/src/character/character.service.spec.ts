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

function mockCampaignRepo() {
  return {
    mergePlayerResourcePools: vi.fn().mockResolvedValue(undefined),
  };
}

const fakeData: MothershipCharacterSheet = {
  entityId: 'vasquez',
  name: 'Vasquez',
  class: 'marine',
  level: 1,
  stats: {
    strength: 40,
    speed: 35,
    intellect: 30,
    combat: 45,
    instinct: 30,
    sanity: 30,
  },
  saves: { fear: 30, body: 30, armor: 30, armorMax: 30 },
  maxHp: 20,
  maxStress: 3,
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
  let campaignRepo: ReturnType<typeof mockCampaignRepo>;
  let service: CharacterService;

  beforeEach(() => {
    repo = mockRepo();
    campaignSvc = mockCampaignService();
    campaignRepo = mockCampaignRepo();
    service = new CharacterService(
      repo as any,
      campaignSvc as any,
      campaignRepo as any,
    );
  });

  describe('create', () => {
    it('checks membership, creates a character, and seeds player resource pools', async () => {
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
      expect(campaignRepo.mergePlayerResourcePools).toHaveBeenCalledWith('c1', {
        vasquez_hp: { current: 20, max: 20 },
        vasquez_stress: { current: 0, max: 3 },
      });
      expect(result).toEqual(fakeCharacter);
    });

    it('throws ForbiddenException when not a member', async () => {
      campaignSvc.assertMember.mockRejectedValue(new ForbiddenException());

      await expect(service.create('c1', 'u1', fakeData)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.insert).not.toHaveBeenCalled();
      expect(campaignRepo.mergePlayerResourcePools).not.toHaveBeenCalled();
    });

    it('throws ConflictException when campaign already has a character', async () => {
      repo.existsForCampaign.mockResolvedValue(true);

      await expect(service.create('c1', 'u1', fakeData)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.insert).not.toHaveBeenCalled();
      expect(campaignRepo.mergePlayerResourcePools).not.toHaveBeenCalled();
    });
  });
});
