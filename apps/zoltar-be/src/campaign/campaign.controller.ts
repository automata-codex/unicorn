import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '@uv/auth-core';
import { SessionGuard } from '../auth/session.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CampaignService } from './campaign.service';
import { CreateCampaignSchema } from './dto/create-campaign.dto';
import type { CreateCampaignDto } from './dto/create-campaign.dto';

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
}
