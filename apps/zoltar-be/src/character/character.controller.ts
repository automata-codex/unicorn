import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
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
}
