import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { emptyMothershipState } from '@uv/game-systems';

import { CampaignRepository } from './campaign.repository';

import type { CreateCampaignDto } from './dto/create-campaign.dto';

@Injectable()
export class CampaignService {
  constructor(private readonly repo: CampaignRepository) {}

  async create(dto: CreateCampaignDto, userId: string) {
    const system = await this.repo.findGameSystemBySlug('mothership');
    if (!system) {
      throw new NotFoundException(
        'Game system "mothership" not found — ensure migrations are applied',
      );
    }

    const campaign = await this.repo.insertCampaign({
      systemId: system.id,
      name: dto.name,
      visibility: dto.visibility,
      diceMode: dto.diceMode,
    });

    await this.repo.insertMember({
      campaignId: campaign.id,
      userId,
      role: 'owner',
    });

    await this.repo.insertState({
      campaignId: campaign.id,
      system: 'mothership',
      data: emptyMothershipState(),
    });

    return campaign;
  }

  async findAllForUser(userId: string) {
    return this.repo.findAllForUser(userId);
  }

  async findById(campaignId: string) {
    const campaign = await this.repo.findById(campaignId);
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async assertMember(campaignId: string, userId: string): Promise<void> {
    const member = await this.repo.findMember(campaignId, userId);
    if (!member) throw new ForbiddenException('Not a member of this campaign');
  }

  async getStateData(
    campaignId: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    await this.assertMember(campaignId, userId);
    const data = await this.repo.getStateData(campaignId);
    if (!data) {
      throw new NotFoundException('Campaign state not found');
    }
    return data;
  }

  async assertOwner(campaignId: string, userId: string): Promise<void> {
    const owner = await this.repo.findOwner(campaignId, userId);
    if (!owner) throw new ForbiddenException('Not the owner of this campaign');
  }

  async rename(campaignId: string, userId: string, name: string) {
    await this.assertOwner(campaignId, userId);
    const campaign = await this.repo.updateName(campaignId, name);
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async delete(campaignId: string, userId: string) {
    await this.assertOwner(campaignId, userId);

    const active = await this.repo.hasActiveAdventure(campaignId);
    if (active) {
      throw new ConflictException(
        'Cannot delete campaign while an adventure is active',
      );
    }

    const deleted = await this.repo.deleteCampaign(campaignId);
    if (!deleted) {
      throw new NotFoundException('Campaign not found');
    }
  }
}
