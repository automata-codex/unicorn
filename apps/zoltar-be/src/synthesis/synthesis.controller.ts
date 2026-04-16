import {
  Body,
  ConflictException,
  Controller,
  Logger,
  Param,
  Post,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  getMothershipOraclePool,
  oracleSchemas,
  type MothershipOracleSelections,
} from '@uv/game-systems';

import { AdventureService } from '../adventure/adventure.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { CampaignRepository } from '../campaign/campaign.repository';
import { CampaignService } from '../campaign/campaign.service';
import { CharacterService } from '../character/character.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { SynthesizeRequestSchema } from './dto/synthesize.dto';
import {
  MOTHERSHIP_ORACLE_CATEGORIES,
  type MothershipOracleCategory,
} from './mothership/synthesis.prompts';
import { CoherenceConflictError, SynthesisService } from './synthesis.service';

import type { AuthUser } from '@uv/auth-core';
import type { OracleEntry } from '@uv/game-systems';
import type { FastifyReply } from 'fastify';
import type { SynthesizeRequestDto } from './dto/synthesize.dto';

@Controller('campaigns/:campaignId/adventures/:adventureId')
@UseGuards(SessionGuard)
export class SynthesisController {
  private readonly logger = new Logger(SynthesisController.name);

  constructor(
    private readonly synthesisService: SynthesisService,
    private readonly adventureService: AdventureService,
    private readonly campaignService: CampaignService,
    private readonly campaignRepo: CampaignRepository,
    private readonly characterService: CharacterService,
  ) {}

  @Post('synthesize')
  async synthesize(
    @Param('campaignId') campaignId: string,
    @Param('adventureId') adventureId: string,
    @Body(new ZodValidationPipe(SynthesizeRequestSchema))
    dto: SynthesizeRequestDto,
    @CurrentUser() user: AuthUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.campaignService.assertMember(campaignId, user.id);

    const adventure = await this.adventureService.findById(
      campaignId,
      adventureId,
      user.id,
    );
    if (adventure.status !== 'synthesizing') {
      throw new ConflictException(
        `Adventure status must be "synthesizing", got "${adventure.status}"`,
      );
    }

    const characterSheet = await this.characterService.findByCampaignId(
      campaignId,
      user.id,
    );
    if (!characterSheet) {
      throw new ConflictException(
        'A character sheet must exist before synthesis',
      );
    }

    const systemSlug = await this.campaignRepo.getSystemSlug(campaignId);
    if (!systemSlug) {
      throw new ConflictException('Campaign has no associated game system');
    }
    const oracleSchema = oracleSchemas[systemSlug];
    if (!oracleSchema) {
      throw new UnprocessableEntityException(
        `No oracle schema for system "${systemSlug}"`,
      );
    }
    const oracleParse = oracleSchema.safeParse(dto.oracleSelections);
    if (!oracleParse.success) {
      throw new UnprocessableEntityException(
        `Oracle selections failed validation: ${oracleParse.error.message}`,
      );
    }

    const selections =
      oracleParse.data as MothershipOracleSelections;

    const activePools = Object.fromEntries(
      MOTHERSHIP_ORACLE_CATEGORIES.map((cat) => [
        cat,
        getMothershipOraclePool(cat),
      ]),
    ) as Record<MothershipOracleCategory, OracleEntry[]>;

    try {
      const coherenceResult = await this.synthesisService.checkCoherence({
        selections,
        activePools,
      });
      const finalSelections = coherenceResult.selections;

      reply.status(202).send({ status: 'synthesizing' });

      // Fire-and-forget: synthesis runs async after the HTTP response.
      this.runSynthesisAsync(
        adventureId,
        campaignId,
        characterSheet.data,
        finalSelections,
        dto.addendum,
      );
    } catch (err) {
      if (err instanceof CoherenceConflictError) {
        reply.status(409).send({
          error: 'coherence_conflict',
          conflicts: err.conflicts.map((c) => ({
            category: c.category,
            description: c.description,
          })),
        });
        return;
      }
      throw err;
    }
  }

  private runSynthesisAsync(
    adventureId: string,
    campaignId: string,
    characterSheet: unknown,
    selections: MothershipOracleSelections,
    addendum?: string,
  ): void {
    this.synthesisService
      .runSynthesis({
        characterSheet:
          characterSheet as Parameters<
            typeof this.synthesisService.runSynthesis
          >[0]['characterSheet'],
        selections,
        addendum,
      })
      .then((gmContext) =>
        this.synthesisService.commitGmContext({
          adventureId,
          campaignId,
          input: gmContext,
        }),
      )
      .catch((err) => {
        this.logger.error(
          `Async synthesis failed for adventure=${adventureId}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
  }
}
