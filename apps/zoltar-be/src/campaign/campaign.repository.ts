import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../db/db.provider';
import type { Db } from '../db/db.provider';
import * as schema from '../db/schema';

@Injectable()
export class CampaignRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async findGameSystemBySlug(slug: string) {
    const rows = await this.db
      .select()
      .from(schema.gameSystems)
      .where(eq(schema.gameSystems.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertCampaign(values: {
    systemId: string;
    name: string;
    visibility: 'private' | 'invite' | 'org';
    diceMode: 'soft_accountability' | 'commitment';
  }) {
    const [campaign] = await this.db
      .insert(schema.campaigns)
      .values(values)
      .returning();
    return campaign;
  }

  async insertMember(values: {
    campaignId: string;
    userId: string;
    role: 'owner' | 'player';
  }) {
    await this.db.insert(schema.campaignMembers).values(values);
  }

  async insertState(values: {
    campaignId: string;
    system: string;
    data: Record<string, unknown>;
  }) {
    await this.db.insert(schema.campaignStates).values(values);
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
    return rows[0] ?? null;
  }

  async findMember(campaignId: string, userId: string) {
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
    return rows[0] ?? null;
  }

  async findOwner(campaignId: string, userId: string) {
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
    return rows[0] ?? null;
  }
}
