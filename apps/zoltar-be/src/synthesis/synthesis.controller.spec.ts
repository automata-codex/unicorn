import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeOracleEntry } from './synthesis.fixtures';
import { SynthesisController } from './synthesis.controller';
import { CoherenceConflictError } from './synthesis.service';

import type { MothershipOracleSelections } from '@uv/game-systems';

const fakeUser = { id: 'u1', email: 'a@x.test', name: 'Alice' };

const validSelections: MothershipOracleSelections = {
  survivor: makeOracleEntry('survivor_1'),
  threat: makeOracleEntry('threat_1'),
  secret: makeOracleEntry('secret_1'),
  vessel_type: makeOracleEntry('vessel_1'),
  tone: makeOracleEntry('tone_1'),
};

function mockReply() {
  const reply: Record<string, ReturnType<typeof vi.fn>> = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply;
}

function mockSynthesisService() {
  return {
    checkCoherence: vi.fn().mockResolvedValue({
      selections: validSelections,
      report: { conflicts: [], resolution: 'proceed' },
      rerolled: false,
    }),
    runSynthesis: vi.fn().mockResolvedValue({}),
    commitGmContext: vi.fn().mockResolvedValue(undefined),
  };
}

function mockAdventureService() {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 'a1',
      campaignId: 'c1',
      status: 'synthesizing',
    }),
  };
}

function mockCampaignService() {
  return {
    assertMember: vi.fn().mockResolvedValue(undefined),
  };
}

function mockCampaignRepo() {
  return {
    getSystemSlug: vi.fn().mockResolvedValue('mothership'),
  };
}

function mockCharacterService() {
  return {
    findByCampaignId: vi.fn().mockResolvedValue({
      id: 'cs1',
      data: { entityId: 'vasquez', name: 'Vasquez' },
    }),
  };
}

describe('SynthesisController', () => {
  let synthSvc: ReturnType<typeof mockSynthesisService>;
  let advSvc: ReturnType<typeof mockAdventureService>;
  let campSvc: ReturnType<typeof mockCampaignService>;
  let campRepo: ReturnType<typeof mockCampaignRepo>;
  let charSvc: ReturnType<typeof mockCharacterService>;
  let controller: SynthesisController;

  beforeEach(() => {
    synthSvc = mockSynthesisService();
    advSvc = mockAdventureService();
    campSvc = mockCampaignService();
    campRepo = mockCampaignRepo();
    charSvc = mockCharacterService();
    controller = new SynthesisController(
      synthSvc as any,
      advSvc as any,
      campSvc as any,
      campRepo as any,
      charSvc as any,
    );
  });

  describe('POST synthesize', () => {
    const dto = { oracleSelections: validSelections };

    it('returns 202 and kicks off async synthesis on the happy path', async () => {
      const reply = mockReply();

      await controller.synthesize('c1', 'a1', dto, fakeUser, reply as any);

      expect(campSvc.assertMember).toHaveBeenCalledWith('c1', 'u1');
      expect(advSvc.findById).toHaveBeenCalledWith('c1', 'a1', 'u1');
      expect(charSvc.findByCampaignId).toHaveBeenCalledWith('c1', 'u1');
      expect(campRepo.getSystemSlug).toHaveBeenCalledWith('c1');
      expect(synthSvc.checkCoherence).toHaveBeenCalledOnce();
      expect(reply.status).toHaveBeenCalledWith(202);
      expect(reply.send).toHaveBeenCalledWith({ status: 'synthesizing' });
    });

    it('propagates ForbiddenException from membership check', async () => {
      campSvc.assertMember.mockRejectedValue(new ForbiddenException());
      const reply = mockReply();

      await expect(
        controller.synthesize('c1', 'a1', dto, fakeUser, reply as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns 409 when adventure is not in synthesizing status', async () => {
      advSvc.findById.mockResolvedValue({
        id: 'a1',
        campaignId: 'c1',
        status: 'ready',
      });
      const reply = mockReply();

      await expect(
        controller.synthesize('c1', 'a1', dto, fakeUser, reply as any),
      ).rejects.toThrow(ConflictException);
    });

    it('returns 409 when no character sheet exists', async () => {
      charSvc.findByCampaignId.mockResolvedValue(null);
      const reply = mockReply();

      await expect(
        controller.synthesize('c1', 'a1', dto, fakeUser, reply as any),
      ).rejects.toThrow(ConflictException);
    });

    it('returns 422 when oracle selections fail system-specific validation', async () => {
      const reply = mockReply();
      const badDto = { oracleSelections: { survivor: 'not an entry' } };

      await expect(
        controller.synthesize('c1', 'a1', badDto, fakeUser, reply as any),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns 409 with coherence conflicts on CoherenceConflictError', async () => {
      const conflicts = [
        {
          category: 'threat',
          description: 'contradicts survivor',
          rerollable: false,
        },
      ];
      synthSvc.checkCoherence.mockRejectedValue(
        new CoherenceConflictError(conflicts),
      );
      const reply = mockReply();

      await controller.synthesize('c1', 'a1', dto, fakeUser, reply as any);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'coherence_conflict',
        conflicts: [
          { category: 'threat', description: 'contradicts survivor' },
        ],
      });
    });

    it('propagates NotFoundException when adventure is not found', async () => {
      advSvc.findById.mockRejectedValue(new NotFoundException());
      const reply = mockReply();

      await expect(
        controller.synthesize('c1', 'a1', dto, fakeUser, reply as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
