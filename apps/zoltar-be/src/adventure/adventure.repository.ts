import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import type { Db } from '../db/db.provider';

type GmContextBlob = { openingNarration?: string | null };

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
      .select({
        id: schema.adventures.id,
        campaignId: schema.adventures.campaignId,
        status: schema.adventures.status,
        mode: schema.adventures.mode,
        callerId: schema.adventures.callerId,
        createdAt: schema.adventures.createdAt,
        completedAt: schema.adventures.completedAt,
        gmContextBlob: schema.gmContexts.blob,
      })
      .from(schema.adventures)
      .leftJoin(
        schema.gmContexts,
        eq(schema.adventures.id, schema.gmContexts.adventureId),
      )
      .where(
        and(
          eq(schema.adventures.id, adventureId),
          eq(schema.adventures.campaignId, campaignId),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;

    const { gmContextBlob, ...adventure } = rows[0];
    const blob = gmContextBlob as GmContextBlob | null;
    return {
      ...adventure,
      openingNarration:
        adventure.status === 'ready' ? (blob?.openingNarration ?? null) : null,
    };
  }
}
