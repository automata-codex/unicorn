import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CampaignService } from './campaign.service';

function mockDb() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
  chain.select.mockReturnValue(chain);
  return chain;
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
  let db: ReturnType<typeof mockDb>;
  let service: CampaignService;

  beforeEach(() => {
    db = mockDb();
    service = new CampaignService(db as any);
  });

  describe('create', () => {
    it('creates campaign, membership, and state', async () => {
      // game system lookup
      db.limit.mockResolvedValueOnce([{ id: 'sys1', slug: 'mothership' }]);
      // campaign insert
      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([fakeCampaign]),
        }),
      });

      const result = await service.create(
        { name: 'Test', visibility: 'private', diceMode: 'soft_accountability' },
        'u1',
      );

      expect(result).toEqual(fakeCampaign);
      // insert called 3 times: campaign, membership, state
      expect(db.insert).toHaveBeenCalledTimes(3);
    });

    it('throws NotFoundException when mothership system is missing', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.create({ name: 'Test', visibility: 'private', diceMode: 'soft_accountability' }, 'u1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('returns the campaign when found', async () => {
      db.limit.mockResolvedValue([fakeCampaign]);
      const result = await service.findById('c1');
      expect(result).toEqual(fakeCampaign);
    });

    it('throws NotFoundException when not found', async () => {
      db.limit.mockResolvedValue([]);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertMember', () => {
    it('resolves when user is a member', async () => {
      db.limit.mockResolvedValue([{ campaignId: 'c1', userId: 'u1', role: 'player' }]);
      await expect(service.assertMember('c1', 'u1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when not a member', async () => {
      db.limit.mockResolvedValue([]);
      await expect(service.assertMember('c1', 'u1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('assertOwner', () => {
    it('resolves when user is the owner', async () => {
      db.limit.mockResolvedValue([{ campaignId: 'c1', userId: 'u1', role: 'owner' }]);
      await expect(service.assertOwner('c1', 'u1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when not the owner', async () => {
      db.limit.mockResolvedValue([]);
      await expect(service.assertOwner('c1', 'u1')).rejects.toThrow(ForbiddenException);
    });
  });
});
