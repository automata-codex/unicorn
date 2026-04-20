import { type MothershipCampaignState } from '@uv/game-systems';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';

import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import type { Db, DbOrTx } from '../db/db.provider';
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

  async writeCampaignState(args: {
    campaignId: string;
    data: MothershipCampaignState;
    tx?: DbOrTx;
  }): Promise<void> {
    const runner = args.tx ?? this.db;
    await runner
      .update(schema.campaignStates)
      .set({ data: args.data, updatedAt: sql`now()` })
      .where(eq(schema.campaignStates.campaignId, args.campaignId));
  }

  async insertPendingCanon(args: {
    tx: DbOrTx;
    adventureId: string;
    entries: Array<{ summary: string; context: string }>;
  }): Promise<void> {
    if (args.entries.length === 0) return;
    await args.tx.insert(schema.pendingCanon).values(
      args.entries.map((entry) => ({
        adventureId: args.adventureId,
        summary: entry.summary,
        context: entry.context,
        status: 'pending' as const,
      })),
    );
  }

  /**
   * Merges Claude's `gmUpdates.npcStates` into `gm_context.blob.narrative.npcAgendas`.
   * Reads the current blob, shallow-merges the new agendas over existing
   * ones (Claude wins on key collision), and writes the updated blob back.
   * No-op when `npcStates` is empty — avoids a pointless read/write that
   * would invalidate the blob's cache byte range for no semantic change.
   *
   * `gmUpdates.notes` is intentionally NOT persisted here; it lives in
   * `adventure_telemetry.payload.notes` instead (see spec §"Part 6 → GM
   * context blob merges").
   */
  async mergeNpcAgendas(args: {
    tx: DbOrTx;
    adventureId: string;
    npcStates: Record<string, string>;
  }): Promise<void> {
    if (Object.keys(args.npcStates).length === 0) return;

    const rows = await args.tx
      .select({ blob: schema.gmContexts.blob })
      .from(schema.gmContexts)
      .where(eq(schema.gmContexts.adventureId, args.adventureId))
      .limit(1);

    const currentBlob =
      (rows[0]?.blob as Record<string, unknown> | undefined) ?? {};
    const currentNarrative =
      (currentBlob.narrative as Record<string, unknown> | undefined) ?? {};
    const existingAgendas =
      (currentNarrative.npcAgendas as Record<string, string> | undefined) ?? {};

    const updatedBlob = {
      ...currentBlob,
      narrative: {
        ...currentNarrative,
        npcAgendas: { ...existingAgendas, ...args.npcStates },
      },
    };

    await args.tx
      .update(schema.gmContexts)
      .set({ blob: updatedBlob, updatedAt: sql`now()` })
      .where(eq(schema.gmContexts.adventureId, args.adventureId));
  }
}
