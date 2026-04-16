import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import type { Db } from '../db/db.provider';

type ResourcePool = { current: number; max: number | null };

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

  /**
   * Merges new resource pools into `campaign_state.data.resourcePools` for a
   * campaign, preserving any pools already present. Used at character
   * creation time to seed player HP / stress. Existing keys always win so
   * that an in-progress adventure can never have its live state clobbered by
   * re-running character creation (today that path is blocked upstream, but
   * the merge is cheap insurance).
   *
   * Runs inside a transaction so concurrent callers can't race the read and
   * the write.
   */
  async mergePlayerResourcePools(
    campaignId: string,
    newPools: Record<string, ResourcePool>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ data: schema.campaignStates.data })
        .from(schema.campaignStates)
        .where(eq(schema.campaignStates.campaignId, campaignId))
        .limit(1);
      if (rows.length === 0) {
        throw new Error(
          `campaign_state row missing for campaign ${campaignId}`,
        );
      }
      const data = (rows[0].data as Record<string, unknown> | null) ?? {};
      const existingPools =
        (data.resourcePools as Record<string, ResourcePool> | undefined) ?? {};
      const mergedPools: Record<string, ResourcePool> = { ...newPools };
      for (const [key, value] of Object.entries(existingPools)) {
        mergedPools[key] = value;
      }
      const nextData = { ...data, resourcePools: mergedPools };
      await tx
        .update(schema.campaignStates)
        .set({ data: nextData, updatedAt: sql`now()` })
        .where(eq(schema.campaignStates.campaignId, campaignId));
    });
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

  async getSystemSlug(campaignId: string): Promise<string | null> {
    const rows = await this.db
      .select({ slug: schema.gameSystems.slug })
      .from(schema.campaigns)
      .innerJoin(
        schema.gameSystems,
        eq(schema.campaigns.systemId, schema.gameSystems.id),
      )
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    return rows[0]?.slug ?? null;
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

  async hasActiveAdventure(campaignId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.adventures.id })
      .from(schema.adventures)
      .where(
        and(
          eq(schema.adventures.campaignId, campaignId),
          inArray(schema.adventures.status, ['synthesizing', 'ready', 'in_progress']),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async updateName(campaignId: string, name: string) {
    const [campaign] = await this.db
      .update(schema.campaigns)
      .set({ name })
      .where(eq(schema.campaigns.id, campaignId))
      .returning();
    return campaign ?? null;
  }

  async deleteCampaign(campaignId: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .returning({ id: schema.campaigns.id });
    return rows.length > 0;
  }
}
