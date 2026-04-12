import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../db/db.provider';
import type { Db } from '../db/db.provider';
import * as schema from '../db/schema';

@Injectable()
export class AdventureRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async insert(values: { campaignId: string; callerId: string }) {
    const [adventure] = await this.db
      .insert(schema.adventures)
      .values({
        campaignId: values.campaignId,
        callerId: values.callerId,
        status: 'synthesizing',
      })
      .returning();
    return adventure;
  }

  async findAllForCampaign(campaignId: string) {
    return this.db
      .select({
        id: schema.adventures.id,
        campaignId: schema.adventures.campaignId,
        status: schema.adventures.status,
        mode: schema.adventures.mode,
        callerId: schema.adventures.callerId,
        createdAt: schema.adventures.createdAt,
        completedAt: schema.adventures.completedAt,
      })
      .from(schema.adventures)
      .where(eq(schema.adventures.campaignId, campaignId))
      .orderBy(desc(schema.adventures.createdAt));
  }

  async findById(adventureId: string, campaignId: string) {
    const rows = await this.db
      .select()
      .from(schema.adventures)
      .where(
        and(
          eq(schema.adventures.id, adventureId),
          eq(schema.adventures.campaignId, campaignId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
