import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { MothershipCharacterSheetSchema } from '@uv/game-systems';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { CharacterService } from './character.service';

import type { AuthUser } from '@uv/auth-core';
import type { MothershipCharacterSheet } from '@uv/game-systems';

@Controller('campaigns/:campaignId/characters')
@UseGuards(SessionGuard)
export class CharacterController {
  constructor(private readonly characterService: CharacterService) {}

  @Get()
  async findByCampaign(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.characterService.findByCampaignId(campaignId, user.id);
  }

  @Post()
  async create(
    @Param('campaignId') campaignId: string,
    @Body(new ZodValidationPipe(MothershipCharacterSheetSchema))
    data: MothershipCharacterSheet,
    @CurrentUser() user: AuthUser,
  ) {
    const character = await this.characterService.create(
      campaignId,
      user.id,
      data,
    );
    return {
      id: character.id,
      campaignId: character.campaignId,
      system: character.system,
      data: character.data,
    };
  }

  @Put()
  async update(
    @Param('campaignId') campaignId: string,
    @Body(new ZodValidationPipe(MothershipCharacterSheetSchema))
    data: MothershipCharacterSheet,
    @CurrentUser() user: AuthUser,
  ) {
    const character = await this.characterService.update(
      campaignId,
      user.id,
      data,
    );
    return {
      id: character.id,
      campaignId: character.campaignId,
      system: character.system,
      data: character.data,
    };
  }

  @Delete()
  @HttpCode(204)
  async delete(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.characterService.delete(campaignId, user.id);
  }
}
