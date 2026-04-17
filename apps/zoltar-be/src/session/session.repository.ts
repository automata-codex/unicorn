import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import type { Db } from '../db/db.provider';
import type { DbMessage } from './session.window';

@Injectable()
export class SessionRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async getGmContextBlob(
    adventureId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.db
      .select({ blob: schema.gmContexts.blob })
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, adventureId))
      .limit(1);
    return (rows[0]?.blob as Record<string, unknown> | undefined) ?? null;
  }

  async getCampaignStateData(
    campaignId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.db
      .select({ data: schema.campaignStates.data })
      .from(schema.campaignStates)
      .where(eq(schema.campaignStates.campaignId, campaignId))
      .limit(1);
    return (rows[0]?.data as Record<string, unknown> | undefined) ?? null;
  }

  async getPlayerEntityIds(campaignId: string): Promise<string[]> {
    const rows = await this.db
      .select({ data: schema.characterSheets.data })
      .from(schema.characterSheets)
      .where(eq(schema.characterSheets.campaignId, campaignId));
    const ids: string[] = [];
    for (const row of rows) {
      const entityId = (row.data as { entityId?: unknown } | null)?.entityId;
      if (typeof entityId === 'string' && entityId.length > 0) {
        ids.push(entityId);
      }
    }
    return ids;
  }

  async getMessagesAsc(adventureId: string): Promise<DbMessage[]> {
    return this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.adventureId, adventureId))
      .orderBy(asc(schema.messages.createdAt));
  }

  async insertMessage(args: {
    adventureId: string;
    role: DbMessage['role'];
    content: string;
  }): Promise<DbMessage> {
    const rows = await this.db
      .insert(schema.messages)
      .values({
        adventureId: args.adventureId,
        role: args.role,
        content: args.content,
      })
      .returning();
    return rows[0];
  }
}
