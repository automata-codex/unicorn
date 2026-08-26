import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CharacterService } from './character.service';

import type { MothershipCharacterSheet } from '@uv/game-systems';

function mockRepo() {
  return {
    insert: vi.fn(),
    findByCampaignId: vi.fn(),
    existsForCampaign: vi.fn(),
    update: vi.fn(),
    deleteByCampaignId: vi.fn(),
    hasActiveAdventure: vi.fn().mockResolvedValue(false),
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
    deleteResourcePoolsForOwner: vi.fn().mockResolvedValue(undefined),
    seedCharacterState: vi.fn().mockResolvedValue(undefined),
    deleteCharacterState: vi.fn().mockResolvedValue(undefined),
  };
}

const fakeData: MothershipCharacterSheet = {
  entityId: 'vasquez',
  name: 'Vasquez',
  class: 'marine',
  creationRolls: {
    strength: [3, 4],
    speed: [3, 4],
    intellect: [3, 4],
    combat: [3, 4],
    sanity: [3, 4],
    fear: [3, 4],
    body: [3, 4],
    maxHp: [6],
    credits: [3, 4],
    trinket: [42],
    patch: [17],
  },
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
    it('seeds the starting skills alongside the empty character state', async () => {
      repo.existsForCampaign.mockResolvedValue(false);
      repo.insert.mockResolvedValue(fakeCharacter);

      await service.create('c1', 'u1', fakeData, {
        startingSkills: [
          { skill: 'Zero-G', tier: 'trained' },
          { skill: 'Piloting', tier: 'expert' },
        ],
      });

      expect(campaignRepo.seedCharacterState).toHaveBeenCalledWith(
        'c1',
        fakeData.entityId,
        expect.objectContaining({
          skills: [
            { skill: 'Zero-G', tier: 'trained' },
            { skill: 'Piloting', tier: 'expert' },
          ],
          conditions: [],
          rollModifiers: [],
          equipment: [],
          minimumStress: 2,
        }),
      );
    });

    it('seeds the loadout and worn armor', async () => {
      repo.existsForCampaign.mockResolvedValue(false);
      repo.insert.mockResolvedValue(fakeCharacter);

      await service.create('c1', 'u1', fakeData, {
        startingEquipment: [
          { item: 'Patch Kit', quantity: 3 },
          { item: 'Revolver', charges: 12 },
        ],
        wornArmor: {
          item: 'Vaccsuit',
          apBase: 3,
          apCurrent: 3,
          destroyed: false,
          dr: 0,
          o2Remaining: 240,
          features: [],
        },
      });

      expect(campaignRepo.seedCharacterState).toHaveBeenCalledWith(
        'c1',
        fakeData.entityId,
        expect.objectContaining({
          equipment: [
            { item: 'Patch Kit', quantity: 3 },
            { item: 'Revolver', charges: 12 },
          ],
          wornArmor: expect.objectContaining({
            item: 'Vaccsuit',
            apCurrent: 3,
          }),
        }),
      );
    });

    it('seeds an empty skill list when none are supplied', async () => {
      repo.existsForCampaign.mockResolvedValue(false);
      repo.insert.mockResolvedValue(fakeCharacter);

      await service.create('c1', 'u1', fakeData);

      expect(campaignRepo.seedCharacterState).toHaveBeenCalledWith(
        'c1',
        fakeData.entityId,
        expect.objectContaining({ skills: [] }),
      );
    });

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
      // Every roll in `fakeData` is [3, 4]; maxHp is [6]. Stats are +25, Saves
      // +10, and the Marine adds +10 Combat, +10 Body, +20 Fear.
      expect(campaignRepo.mergePlayerResourcePools).toHaveBeenCalledWith('c1', {
        vasquez: {
          hp: { current: 16, max: 16 },
          wounds: { current: 0, max: 3 },
          stress: { current: 2, max: null },
          strength: { current: 32, max: 32 },
          speed: { current: 32, max: 32 },
          intellect: { current: 32, max: 32 },
          combat: { current: 42, max: 42 },
          sanity: { current: 17, max: 17 },
          fear: { current: 37, max: 37 },
          body: { current: 27, max: 27 },
          credits: { current: 70, max: null },
        },
      });
      expect(campaignRepo.seedCharacterState).toHaveBeenCalledWith(
        'c1',
        'vasquez',
        {
          conditions: [],
          rollModifiers: [],
          skills: [],
          equipment: [],
          wornArmor: null,
          minimumStress: 2,
          bleeding: 0,
          pendingDeathSave: null,
        },
      );
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

  describe('update', () => {
    it('checks membership, updates the character, and refreshes resource pools', async () => {
      repo.update.mockResolvedValue(fakeCharacter);

      const result = await service.update('c1', 'u1', fakeData);

      expect(campaignSvc.assertMember).toHaveBeenCalledWith('c1', 'u1');
      expect(repo.hasActiveAdventure).toHaveBeenCalledWith('c1');
      expect(repo.update).toHaveBeenCalledWith('c1', fakeData);
      expect(campaignRepo.mergePlayerResourcePools).toHaveBeenCalled();
      expect(result).toEqual(fakeCharacter);
    });

    it('throws ForbiddenException when not a member', async () => {
      campaignSvc.assertMember.mockRejectedValue(new ForbiddenException());

      await expect(service.update('c1', 'u1', fakeData)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when an adventure is active', async () => {
      repo.hasActiveAdventure.mockResolvedValue(true);

      await expect(service.update('c1', 'u1', fakeData)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no character exists', async () => {
      repo.update.mockResolvedValue(null);

      await expect(service.update('c1', 'u1', fakeData)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('checks membership and deletes the character', async () => {
      repo.deleteByCampaignId.mockResolvedValue(true);

      await service.delete('c1', 'u1');

      expect(campaignSvc.assertMember).toHaveBeenCalledWith('c1', 'u1');
      expect(repo.hasActiveAdventure).toHaveBeenCalledWith('c1');
      expect(repo.deleteByCampaignId).toHaveBeenCalledWith('c1');
    });

    it("removes the character's pools along with the sheet", async () => {
      // Before M7.6 this meant a prefix scan over composite keys and was
      // skipped, which is how campaigns accumulated pools for characters that
      // no longer existed. Nested it is one key.
      repo.findByCampaignId.mockResolvedValue({ ...fakeCharacter });
      repo.deleteByCampaignId.mockResolvedValue(true);

      await service.delete('c1', 'u1');

      expect(campaignRepo.deleteResourcePoolsForOwner).toHaveBeenCalledWith(
        'c1',
        'vasquez',
      );
      expect(campaignRepo.deleteCharacterState).toHaveBeenCalledWith(
        'c1',
        'vasquez',
      );
    });

    it('reads the sheet before deleting it, not after', async () => {
      // The entity id is only recoverable from the row, so a lookup after the
      // delete would always find nothing and silently orphan the pools.
      const order: string[] = [];
      repo.findByCampaignId.mockImplementation(() => {
        order.push('read');
        return Promise.resolve({ ...fakeCharacter });
      });
      repo.deleteByCampaignId.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve(true);
      });

      await service.delete('c1', 'u1');

      expect(order).toEqual(['read', 'delete']);
    });

    it('does not touch pools when the delete found no sheet', async () => {
      repo.findByCampaignId.mockResolvedValue(null);
      repo.deleteByCampaignId.mockResolvedValue(false);

      await expect(service.delete('c1', 'u1')).rejects.toThrow();
      expect(campaignRepo.deleteResourcePoolsForOwner).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when not a member', async () => {
      campaignSvc.assertMember.mockRejectedValue(new ForbiddenException());

      await expect(service.delete('c1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.deleteByCampaignId).not.toHaveBeenCalled();
    });

    it('throws ConflictException when an adventure is active', async () => {
      repo.hasActiveAdventure.mockResolvedValue(true);

      await expect(service.delete('c1', 'u1')).rejects.toThrow(
        ConflictException,
      );
      expect(repo.deleteByCampaignId).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no character exists', async () => {
      repo.deleteByCampaignId.mockResolvedValue(false);

      await expect(service.delete('c1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
