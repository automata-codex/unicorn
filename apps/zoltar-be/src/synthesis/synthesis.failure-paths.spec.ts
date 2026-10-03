import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { SynthesizeRequestSchema } from './dto/synthesize.dto';
import { SynthesisController } from './synthesis.controller';
import { makeOracleEntry, vasquezSheet } from './synthesis.fixtures';
import { SynthesisService } from './synthesis.service';

import type Anthropic from '@anthropic-ai/sdk';
import type { MothershipOracleSelections } from '@uv/game-systems';
import type { AnthropicService } from '../anthropic/anthropic.service';
import type { CampaignRepository } from '../campaign/campaign.repository';
import type { SynthesisRepository } from './synthesis.repository';

/**
 * Synthesis failure handling. Both blocks came out of reading the code while
 * writing `docs/human/adventure-synthesis.md`.
 *
 * The first is a regression test for a bug that is fixed. The second pins the
 * decision that a failed adventure is not retried — see the note on that block.
 */

const fakeUser = { id: 'u1', email: 'a@x.test', name: 'Alice' };

// Real entry ids: `resolveActivePools` rejects ids the shipped tables lack.
const validSelections: MothershipOracleSelections = {
  survivor: makeOracleEntry('corporate_spy'),
  threat: makeOracleEntry('parasitic_organism'),
  secret: makeOracleEntry('company_knew'),
  vessel_type: makeOracleEntry('freight_hauler'),
  tone: makeOracleEntry('creeping_dread'),
};

const validActiveEntryIds: Record<string, string[]> = {
  survivor: ['corporate_spy', 'burned_out_medic'],
  threat: ['parasitic_organism', 'corporate_asset'],
  secret: ['company_knew', 'signal_origin'],
  vessel_type: ['freight_hauler', 'research_station'],
  tone: ['creeping_dread', 'paranoia'],
};

const validDto = {
  oracleSelections: validSelections,
  activeEntryIds: validActiveEntryIds,
};

function toolUseMessage(name: string, input: unknown): Anthropic.Message {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_fake',
        name,
        input,
      } as unknown as Anthropic.ToolUseBlock,
    ],
  } as unknown as Anthropic.Message;
}

function textMessage(text: string): Anthropic.Message {
  return {
    content: [{ type: 'text', text } as unknown as Anthropic.ContentBlock],
  } as unknown as Anthropic.Message;
}

function mockReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

/**
 * A controller wired to the REAL `SynthesisService`, with only the service's
 * own dependencies stubbed (Claude and the repositories). Bug 1 lives in the
 * hand-off between controller and service, so mocking the service away would
 * hide it.
 */
function makeController(args: {
  callMessages: ReturnType<typeof vi.fn>;
  adventureStatus?: string;
}) {
  const repo = {
    writeGmContextAtomic: vi.fn().mockResolvedValue(undefined),
    setAdventureFailed: vi.fn().mockResolvedValue(undefined),
  };
  const campaignRepo = {
    getSystemSlug: vi.fn().mockResolvedValue('mothership'),
    getStateData: vi.fn().mockResolvedValue(null),
  };
  const service = new SynthesisService(
    { callMessages: args.callMessages } as unknown as AnthropicService,
    repo as unknown as SynthesisRepository,
    campaignRepo as unknown as CampaignRepository,
  );
  const controller = new SynthesisController(
    service,
    {
      findById: vi.fn().mockResolvedValue({
        id: 'a1',
        campaignId: 'c1',
        status: args.adventureStatus ?? 'synthesizing',
      }),
    } as any,
    { assertMember: vi.fn().mockResolvedValue(undefined) } as any,
    campaignRepo as any,
    {
      findByCampaignId: vi
        .fn()
        .mockResolvedValue({ id: 'cs1', data: vasquezSheet }),
    } as any,
  );
  return { controller, repo };
}

describe('a failed synthesis call marks the adventure failed', () => {
  /**
   * Regression test. The coherence check passes, the endpoint returns 202, and
   * then the background synthesis call fails because Claude replies without
   * calling `submit_gm_context`.
   *
   * The controller's `.catch` used to only log, so the adventure stayed
   * `synthesizing` forever and the browser polled a status that never changed.
   *
   * `setAdventureFailed` is the one way to mark an adventure failed, so the
   * test asks only that it gets called — not where the call lives.
   */
  it('marks the adventure failed when Claude does not call submit_gm_context', async () => {
    const callMessages = vi
      .fn()
      // 1st call: the coherence check — no conflicts, proceed.
      .mockResolvedValueOnce(
        toolUseMessage('report_coherence', {
          conflicts: [],
          resolution: 'proceed',
        }),
      )
      // 2nd call: synthesis — plain text, no tool call.
      .mockResolvedValueOnce(textMessage('I would rather not.'));
    const { controller, repo } = makeController({ callMessages });
    const reply = mockReply();

    await controller.synthesize('c1', 'a1', validDto, fakeUser, reply as any);
    expect(reply.status).toHaveBeenCalledWith(202);

    // Synthesis runs after the response; give the background work time to settle.
    await vi.waitFor(
      () => {
        expect(callMessages).toHaveBeenCalledTimes(2);
        expect(repo.setAdventureFailed).toHaveBeenCalledWith(
          'a1',
          expect.any(String),
        );
      },
      { timeout: 1000 },
    );
  });
});

describe('a failed adventure is not synthesized again', () => {
  /**
   * There is no retry of a failed adventure. The synthesis screen used to show
   * a RETRY button that posted `{ oracleSelections: {} }` here, which could
   * never succeed: the body is invalid, and the endpoint only accepts an
   * adventure that is `synthesizing`. Nothing saves the original oracle draw,
   * so there is nothing to retry with.
   *
   * The button now sends the player back to the oracle screen, which creates a
   * new adventure from a new draw. These two tests pin the back-end half of
   * that decision, so a future retry feature has to change them on purpose.
   */
  it('rejects a request with no activeEntryIds', () => {
    const pipe = new ZodValidationPipe(SynthesizeRequestSchema);

    expect(() => pipe.transform({ oracleSelections: {} })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a failed adventure, even with a valid body', async () => {
    const callMessages = vi.fn();
    const { controller } = makeController({
      callMessages,
      adventureStatus: 'failed',
    });

    await expect(
      controller.synthesize('c1', 'a1', validDto, fakeUser, mockReply() as any),
    ).rejects.toThrow(ConflictException);
    expect(callMessages).not.toHaveBeenCalled();
  });
});
