import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import type { MothershipCharacterSheet } from '@uv/game-systems';
import type { Db } from '../db/db.provider';

@Injectable()
export class CharacterRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async insert(values: {
    campaignId: string;
    userId: string;
    data: MothershipCharacterSheet;
  }) {
    const [character] = await this.db
      .insert(schema.characterSheets)
      .values({
        campaignId: values.campaignId,
        userId: values.userId,
        system: 'mothership',
        data: values.data,
      })
      .returning();
    return character;
  }

  async findByCampaignId(campaignId: string) {
    const rows = await this.db
      .select()
      .from(schema.characterSheets)
      .where(eq(schema.characterSheets.campaignId, campaignId))
      .limit(1);
    return rows[0] ?? null;
  }

  async existsForCampaign(campaignId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.characterSheets.id })
      .from(schema.characterSheets)
      .where(eq(schema.characterSheets.campaignId, campaignId))
      .limit(1);
    return rows.length > 0;
  }

  async update(campaignId: string, data: MothershipCharacterSheet) {
    const [character] = await this.db
      .update(schema.characterSheets)
      .set({ data, updatedAt: new Date() })
      .where(eq(schema.characterSheets.campaignId, campaignId))
      .returning();
    return character ?? null;
  }

  async deleteByCampaignId(campaignId: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.characterSheets)
      .where(eq(schema.characterSheets.campaignId, campaignId))
      .returning({ id: schema.characterSheets.id });
    return rows.length > 0;
  }

  async hasActiveAdventure(campaignId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.adventures.id })
      .from(schema.adventures)
      .where(
        and(
          eq(schema.adventures.campaignId, campaignId),
          inArray(schema.adventures.status, ['synthesizing', 'ready']),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
