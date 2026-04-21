import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignController } from './campaign.controller';

const fakeUser = { id: 'u1', email: 'a@x.com', name: 'Alice' };

function mockCampaignService() {
  return {
    create: vi.fn(),
    findAllForUser: vi.fn(),
    findById: vi.fn(),
    assertMember: vi.fn().mockResolvedValue(undefined),
    assertOwner: vi.fn().mockResolvedValue(undefined),
    getStateData: vi.fn(),
  };
}

describe('CampaignController', () => {
  let svc: ReturnType<typeof mockCampaignService>;
  let controller: CampaignController;

  beforeEach(() => {
    svc = mockCampaignService();
    controller = new CampaignController(svc as any);
  });

  describe('POST /campaigns', () => {
    it('creates a campaign and returns it', async () => {
      const campaign = {
        id: 'c1',
        name: 'The Persephone Incident',
        visibility: 'private',
        diceMode: 'soft_accountability',
        createdAt: new Date(),
      };
      svc.create.mockResolvedValue(campaign);

      const result = await controller.create(
        {
          name: 'The Persephone Incident',
          visibility: 'private',
          diceMode: 'soft_accountability',
        },
        fakeUser,
      );

      expect(svc.create).toHaveBeenCalledWith(
        {
          name: 'The Persephone Incident',
          visibility: 'private',
          diceMode: 'soft_accountability',
        },
        'u1',
      );
      expect(result.id).toBe('c1');
      expect(result.system).toBe('mothership');
    });
  });

  describe('GET /campaigns', () => {
    it('returns campaigns for the user', async () => {
      const campaigns = [{ id: 'c1', name: 'Camp 1' }];
      svc.findAllForUser.mockResolvedValue(campaigns);

      const result = await controller.list(fakeUser);
      expect(svc.findAllForUser).toHaveBeenCalledWith('u1');
      expect(result).toEqual(campaigns);
    });
  });

  describe('GET /campaigns/:campaignId', () => {
    it('returns the campaign when user is a member', async () => {
      const campaign = { id: 'c1', name: 'Camp 1' };
      svc.findById.mockResolvedValue(campaign);

      const result = await controller.findOne('c1', fakeUser);
      expect(svc.assertMember).toHaveBeenCalledWith('c1', 'u1');
      expect(result).toEqual(campaign);
    });

    it('throws ForbiddenException when not a member', async () => {
      svc.assertMember.mockRejectedValue(new ForbiddenException());

      await expect(controller.findOne('c1', fakeUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when campaign does not exist', async () => {
      svc.findById.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('missing', fakeUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('GET /campaigns/:campaignId/state', () => {
    it('returns the campaign state data wrapped in { data }', async () => {
      const stateData = {
        schemaVersion: 1,
        resourcePools: { dr_chen_hp: { current: 8, max: 10 } },
        entities: {},
        flags: {},
        scenarioState: {},
        worldFacts: {},
      };
      svc.getStateData.mockResolvedValue(stateData);

      const result = await controller.getState('c1', fakeUser);
      expect(svc.getStateData).toHaveBeenCalledWith('c1', 'u1');
      expect(result).toEqual({ data: stateData });
    });

    it('propagates ForbiddenException when the user is not a member', async () => {
      svc.getStateData.mockRejectedValue(new ForbiddenException());
      await expect(controller.getState('c1', fakeUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('propagates NotFoundException when state is missing', async () => {
      svc.getStateData.mockRejectedValue(new NotFoundException());
      await expect(controller.getState('c1', fakeUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
