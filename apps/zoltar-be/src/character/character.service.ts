import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  deriveMothershipCharacterResourcePools,
  emptyMothershipCharacterState,
  type MothershipCharacterSheet,
  type MothershipEquipmentEntry,
  type MothershipSkillEntry,
  type MothershipWornArmor,
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
    options: {
      startingSkills?: MothershipSkillEntry[];
      startingEquipment?: MothershipEquipmentEntry[];
      wornArmor?: MothershipWornArmor | null;
    } = {},
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
    await this.campaignRepo.seedCharacterState(campaignId, data.entityId, {
      ...emptyMothershipCharacterState(),
      skills: options.startingSkills ?? [],
      equipment: options.startingEquipment ?? [],
      wornArmor: options.wornArmor ?? null,
    });

    return character;
  }

  /**
   * Re-deriving pools on update is **preserve-on-conflict, which means it is a
   * no-op for any pool that already exists** — and after creation they all do.
   * A sheet edit that changes a value the derivation feeds therefore does not
   * move the corresponding ceiling; the write silently does nothing.
   *
   * That is correct for live state (an in-progress adventure must not have its
   * HP reset by a sheet edit) but it is a trap for any future path that means
   * to change a ceiling — advancement, a house rule, a correction. Such a path
   * must write the pool directly. See M7.6 §1.4.
   *
   * **`seedCharacterState` behaves the same way and 018 gave it something to
   * lose.** It returns early when the entity already has state, so the skills
   * collected at creation cannot be changed by editing the sheet afterwards —
   * the write silently does nothing, exactly as above. Same justification (a
   * sheet edit must not reset conditions or bleeding mid-adventure) and the
   * same trap: skill advancement, when it arrives, writes
   * `characterState.skills` directly rather than re-seeding.
   */

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

    const existing = await this.repo.findByCampaignId(campaignId);
    const deleted = await this.repo.deleteByCampaignId(campaignId);
    if (!deleted) {
      throw new NotFoundException('No character sheet found for this campaign');
    }

    // Delete the character's pools with the sheet. Nested, this is one key
    // rather than the prefix scan that made it not worth doing before, and
    // leaving them behind is how a campaign accumulates pools for characters
    // that no longer exist.
    const entityId = (existing?.data as { entityId?: string } | undefined)
      ?.entityId;
    if (entityId) {
      await this.campaignRepo.deleteResourcePoolsForOwner(campaignId, entityId);
      await this.campaignRepo.deleteCharacterState(campaignId, entityId);
    }
  }
}
