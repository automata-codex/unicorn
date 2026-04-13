import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { AdventureService } from './adventure.service';
import { CreateAdventureSchema } from './dto/create-adventure.dto';

import type { AuthUser } from '@uv/auth-core';
import type { FastifyReply } from 'fastify';
import type { CreateAdventureDto } from './dto/create-adventure.dto';

@Controller('campaigns/:campaignId/adventures')
@UseGuards(SessionGuard)
export class AdventureController {
  constructor(private readonly adventureService: AdventureService) {}

  @Post()
  async create(
    @Param('campaignId') campaignId: string,
    @Body(new ZodValidationPipe(CreateAdventureSchema))
    _dto: CreateAdventureDto,
    @CurrentUser() user: AuthUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const adventure = await this.adventureService.create(campaignId, user.id);
    reply.status(202).send({
      id: adventure.id,
      campaignId: adventure.campaignId,
      status: adventure.status,
      createdAt: adventure.createdAt,
    });
  }

  @Get()
  async list(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adventureService.findAllForCampaign(campaignId, user.id);
  }

  @Get(':adventureId')
  async findOne(
    @Param('campaignId') campaignId: string,
    @Param('adventureId') adventureId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adventureService.findById(campaignId, adventureId, user.id);
  }
}
