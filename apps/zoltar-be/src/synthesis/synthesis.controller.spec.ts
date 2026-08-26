import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SynthesisController } from './synthesis.controller';
import { makeOracleEntry } from './synthesis.fixtures';
import { CoherenceConflictError } from './synthesis.service';

import type { MothershipOracleSelections } from '@uv/game-systems';

const fakeUser = { id: 'u1', email: 'a@x.test', name: 'Alice' };

/**
 * Real entry ids, not synthetic ones. `resolveActivePools` resolves every id in
 * `activeEntryIds` against the shipped oracle tables and rejects one it does not
 * recognise, so a fixture built on invented ids would 422 on the happy path.
 */
const validSelections: MothershipOracleSelections = {
  survivor: makeOracleEntry('corporate_spy'),
  threat: makeOracleEntry('parasitic_organism'),
  secret: makeOracleEntry('company_knew'),
  vessel_type: makeOracleEntry('freight_hauler'),
  tone: makeOracleEntry('creeping_dread'),
};

/** Two live entries per category, the selection above plus one alternative. */
const validActiveEntryIds: Record<string, string[]> = {
  survivor: ['corporate_spy', 'burned_out_medic'],
  threat: ['parasitic_organism', 'corporate_asset'],
  secret: ['company_knew', 'signal_origin'],
  vessel_type: ['freight_hauler', 'research_station'],
  tone: ['creeping_dread', 'paranoia'],
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
    const dto = {
      oracleSelections: validSelections,
      activeEntryIds: validActiveEntryIds,
    };

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
      const badDto = {
        oracleSelections: { survivor: 'not an entry' },
        activeEntryIds: validActiveEntryIds,
      };

      await expect(
        controller.synthesize('c1', 'a1', badDto, fakeUser, reply as any),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('passes only the active entries as the reroll pool', async () => {
      const reply = mockReply();

      await controller.synthesize('c1', 'a1', dto, fakeUser, reply as any);

      const passed = synthSvc.checkCoherence.mock.calls[0][0];
      expect(Object.keys(passed.activePools).sort()).toEqual([
        'secret',
        'survivor',
        'threat',
        'tone',
        'vessel_type',
      ]);
      // Two live entries, not the six the tone table actually ships.
      expect(passed.activePools.tone.map((e: { id: string }) => e.id)).toEqual([
        'creeping_dread',
        'paranoia',
      ]);
    });

    /**
     * The playtest failure, as a test. `body_horror` deselected must not be
     * reachable — before `activeEntryIds` existed the backend rebuilt the pool
     * from every shipped entry, and a reroll substituted exactly this.
     */
    it('excludes a deselected entry from the reroll pool', async () => {
      const reply = mockReply();

      await controller.synthesize(
        'c1',
        'a1',
        {
          ...dto,
          activeEntryIds: { ...validActiveEntryIds, tone: ['creeping_dread'] },
        },
        fakeUser,
        reply as any,
      );

      const passed = synthSvc.checkCoherence.mock.calls[0][0];
      expect(passed.activePools.tone.map((e: { id: string }) => e.id)).toEqual([
        'creeping_dread',
      ]);
      expect(
        passed.activePools.tone.some(
          (e: { id: string }) => e.id === 'body_horror',
        ),
      ).toBe(false);
    });

    it('returns 422 when a category is missing from activeEntryIds', async () => {
      const reply = mockReply();
      const { tone: _tone, ...withoutTone } = validActiveEntryIds;

      await expect(
        controller.synthesize(
          'c1',
          'a1',
          { ...dto, activeEntryIds: withoutTone },
          fakeUser,
          reply as any,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns 422 on an entry id no oracle table ships', async () => {
      const reply = mockReply();

      await expect(
        controller.synthesize(
          'c1',
          'a1',
          {
            ...dto,
            activeEntryIds: { ...validActiveEntryIds, tone: ['tone_1'] },
          },
          fakeUser,
          reply as any,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    /**
     * The two halves of the request disagreeing. Nothing here can tell which is
     * right, and guessing produces a plausible adventure built on a filter the
     * player never asked for.
     */
    it('returns 422 when the selection sits outside its own active pool', async () => {
      const reply = mockReply();

      await expect(
        controller.synthesize(
          'c1',
          'a1',
          {
            ...dto,
            activeEntryIds: { ...validActiveEntryIds, tone: ['paranoia'] },
          },
          fakeUser,
          reply as any,
        ),
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
