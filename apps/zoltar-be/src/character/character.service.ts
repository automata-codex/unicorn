import { ConflictException, Injectable } from '@nestjs/common';
import {
  deriveMothershipCharacterResourcePools,
  type MothershipCharacterSheet,
} from '@uv/game-systems';

import { CampaignRepository } from '../campaign/campaign.repository';
import { CampaignService } from '../campaign/campaign.service';

import { CharacterRepository } from './character.repository';

@Injectable()
export class CharacterService {
  constructor(
    private readonly repo: CharacterRepository,
    private readonly campaignService: CampaignService,
    private readonly campaignRepo: CampaignRepository,
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

    const character = await this.repo.insert({ campaignId, userId, data });

    const playerPools = deriveMothershipCharacterResourcePools(data);
    await this.campaignRepo.mergePlayerResourcePools(campaignId, playerPools);

    return character;
  }
}
