import { Injectable, NotFoundException } from '@nestjs/common';

import { CampaignService } from '../campaign/campaign.service';

import { AdventureRepository } from './adventure.repository';

@Injectable()
export class AdventureService {
  constructor(
    private readonly repo: AdventureRepository,
    private readonly campaignService: CampaignService,
  ) {}

  async create(campaignId: string, userId: string) {
    await this.campaignService.assertMember(campaignId, userId);
    return this.repo.insert({ campaignId, callerId: userId });
  }

  async findAllForCampaign(campaignId: string, userId: string) {
    await this.campaignService.assertMember(campaignId, userId);
    return this.repo.findAllForCampaign(campaignId);
  }

  async findById(campaignId: string, adventureId: string, userId: string) {
    await this.campaignService.assertMember(campaignId, userId);
    const adventure = await this.repo.findById(adventureId, campaignId);
    if (!adventure) throw new NotFoundException('Adventure not found');
    return adventure;
  }
}
