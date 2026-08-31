import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import type { Db } from '../db/db.provider';

/**
 * Only the fields this repository reads, which is one — and it has survived
 * every `gm_context` schema version so far, so the reads below are unmigrated
 * on purpose (`ADR-0118`).
 *
 * **If a migration ever touches `openingNarration`, this becomes a read site
 * that needs `migrateGmContextBlob` and the `schema_version` column with it.**
 * Widening this type is the signal to check.
 */
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
        adventure.status !== 'synthesizing'
          ? (blob?.openingNarration ?? null)
          : null,
    };
  }

  /**
   * Transitions an adventure to `aborted`, but only if it's currently in one
   * of the active statuses (`synthesizing`/`ready`/`in_progress`) — a
   * conditional update so calling this on an already-finished adventure is a
   * safe no-op (returns `null`) rather than clobbering a real `completed`/
   * `failed` outcome. Mirrors the "flip status on the first turn" pattern in
   * `SessionRepository` (`session.repository.ts`).
   */
  async abort(
    adventureId: string,
  ): Promise<{ id: string; status: string; completedAt: Date | null } | null> {
    const [row] = await this.db
      .update(schema.adventures)
      .set({ status: 'aborted', completedAt: new Date() })
      .where(
        and(
          eq(schema.adventures.id, adventureId),
          inArray(schema.adventures.status, [
            'synthesizing',
            'ready',
            'in_progress',
          ]),
        ),
      )
      .returning({
        id: schema.adventures.id,
        status: schema.adventures.status,
        completedAt: schema.adventures.completedAt,
      });
    return row ?? null;
  }
}
