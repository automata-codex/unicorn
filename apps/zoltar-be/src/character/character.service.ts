import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  private async assertNoActiveAdventure(campaignId: string) {
    const active = await this.repo.hasActiveAdventure(campaignId);
    if (active) {
      throw new ConflictException(
        'Cannot modify character while an adventure is active',
      );
    }
  }

  async update(
    campaignId: string,
    userId: string,
    data: MothershipCharacterSheet,
  ) {
    await this.campaignService.assertMember(campaignId, userId);
    await this.assertNoActiveAdventure(campaignId);

    const character = await this.repo.update(campaignId, data);
    if (!character) {
      throw new NotFoundException('No character sheet found for this campaign');
    }

    const playerPools = deriveMothershipCharacterResourcePools(data);
    await this.campaignRepo.mergePlayerResourcePools(campaignId, playerPools);

    return character;
  }

  async delete(campaignId: string, userId: string) {
    await this.campaignService.assertMember(campaignId, userId);
    await this.assertNoActiveAdventure(campaignId);

    const deleted = await this.repo.deleteByCampaignId(campaignId);
    if (!deleted) {
      throw new NotFoundException('No character sheet found for this campaign');
    }
  }
}
