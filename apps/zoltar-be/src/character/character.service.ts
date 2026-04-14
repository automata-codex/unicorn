import { ConflictException, Injectable } from '@nestjs/common';

import { CampaignService } from '../campaign/campaign.service';

import { CharacterRepository } from './character.repository';

import type { MothershipCharacterSheet } from '@uv/game-systems';

@Injectable()
export class CharacterService {
  constructor(
    private readonly repo: CharacterRepository,
    private readonly campaignService: CampaignService,
  ) {}

  async findByCampaignId(campaignId: string, userId: string) {
    await this.campaignService.assertMember(campaignId, userId);
    return this.repo.findByCampaignId(campaignId);
  }

  async create(
    campaignId: string,
    userId: string,
    data: MothershipCharacterSheet,
  ) {
    await this.campaignService.assertMember(campaignId, userId);

    const exists = await this.repo.existsForCampaign(campaignId);
    if (exists) {
      throw new ConflictException(
        'This campaign already has a character sheet',
      );
    }

    return this.repo.insert({ campaignId, userId, data });
  }
}
