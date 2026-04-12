import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../db/db.provider';
import type { Db } from '../db/db.provider';
import * as schema from '../db/schema';
import { emptyMothershipState } from '@uv/game-systems';
import type { CreateCampaignDto } from './dto/create-campaign.dto';

@Injectable()
export class CampaignService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async create(dto: CreateCampaignDto, userId: string) {
    // Look up mothership game system (seeded in V7)
    const systems = await this.db
      .select()
      .from(schema.gameSystems)
      .where(eq(schema.gameSystems.slug, 'mothership'))
      .limit(1);

    const system = systems[0];
    if (!system) {
      throw new NotFoundException('Game system "mothership" not found — ensure migrations are applied');
    }

    // Create campaign
    const [campaign] = await this.db
      .insert(schema.campaigns)
      .values({
        systemId: system.id,
        name: dto.name,
        visibility: dto.visibility,
        diceMode: dto.diceMode,
      })
      .returning();

    // Create owner membership
    await this.db.insert(schema.campaignMembers).values({
      campaignId: campaign.id,
      userId,
      role: 'owner',
    });

    // Initialize campaign state with empty Mothership state
    await this.db.insert(schema.campaignStates).values({
      campaignId: campaign.id,
      system: 'mothership',
      data: emptyMothershipState(),
    });

    return campaign;
  }

  async findAllForUser(userId: string) {
    return this.db
      .select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        visibility: schema.campaigns.visibility,
        diceMode: schema.campaigns.diceMode,
        createdAt: schema.campaigns.createdAt,
      })
      .from(schema.campaigns)
      .innerJoin(
        schema.campaignMembers,
        eq(schema.campaigns.id, schema.campaignMembers.campaignId),
      )
      .where(eq(schema.campaignMembers.userId, userId));
  }

  async findById(campaignId: string) {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!rows[0]) throw new NotFoundException('Campaign not found');
    return rows[0];
  }

  async assertMember(campaignId: string, userId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(schema.campaignMembers)
      .where(
        and(
          eq(schema.campaignMembers.campaignId, campaignId),
          eq(schema.campaignMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!rows[0]) throw new ForbiddenException('Not a member of this campaign');
  }

  async assertOwner(campaignId: string, userId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(schema.campaignMembers)
      .where(
        and(
          eq(schema.campaignMembers.campaignId, campaignId),
          eq(schema.campaignMembers.userId, userId),
          eq(schema.campaignMembers.role, 'owner'),
        ),
      )
      .limit(1);

    if (!rows[0]) throw new ForbiddenException('Not the owner of this campaign');
  }
}
