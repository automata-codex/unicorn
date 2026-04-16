import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { CampaignService } from './campaign.service';
import { CreateCampaignSchema } from './dto/create-campaign.dto';
import { RenameCampaignSchema } from './dto/rename-campaign.dto';

import type { AuthUser } from '@uv/auth-core';
import type { CreateCampaignDto } from './dto/create-campaign.dto';
import type { RenameCampaignDto } from './dto/rename-campaign.dto';

@Controller('campaigns')
@UseGuards(SessionGuard)
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateCampaignSchema)) dto: CreateCampaignDto,
    @CurrentUser() user: AuthUser,
  ) {
    const campaign = await this.campaignService.create(dto, user.id);
    return {
      id: campaign.id,
      name: campaign.name,
      system: 'mothership',
      visibility: campaign.visibility,
      diceMode: campaign.diceMode,
      createdAt: campaign.createdAt,
    };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.campaignService.findAllForUser(user.id);
  }

  @Get(':campaignId')
  async findOne(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.campaignService.assertMember(campaignId, user.id);
    return this.campaignService.findById(campaignId);
  }

  @Patch(':campaignId')
  async rename(
    @Param('campaignId') campaignId: string,
    @Body(new ZodValidationPipe(RenameCampaignSchema)) dto: RenameCampaignDto,
    @CurrentUser() user: AuthUser,
  ) {
    const campaign = await this.campaignService.rename(
      campaignId,
      user.id,
      dto.name,
    );
    return {
      id: campaign.id,
      name: campaign.name,
      visibility: campaign.visibility,
      diceMode: campaign.diceMode,
      createdAt: campaign.createdAt,
    };
  }

  @Delete(':campaignId')
  @HttpCode(204)
  async delete(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.campaignService.delete(campaignId, user.id);
  }
}
