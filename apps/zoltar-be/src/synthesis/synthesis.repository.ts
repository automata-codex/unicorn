import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import type { Db, DbOrTx } from '../db/db.provider';

export interface GridEntityRow {
  entityRef: string;
  x: number;
  y: number;
  z: number;
  visible: boolean;
  tags: string[];
}

export interface WriteGmContextArgs {
  adventureId: string;
  campaignId: string;
  gmContextBlob: Record<string, unknown>;
  /**
   * New `data` payload to write into `campaign_state`. The service pre-merges
   * this against whatever it read from `getCampaignStateData`, so by the time
   * the repo sees it there is no further merge logic to do.
   */
  campaignStateData: Record<string, unknown>;
  gridEntities: GridEntityRow[];
}

@Injectable()
export class SynthesisRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

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

  /**
   * Atomic write path for `submit_gm_context`. Runs the four table writes plus
   * auto-promote in a single transaction. On any failure the entire
   * transaction rolls back and the caller is responsible for flipping
   * `adventure.status` to `failed`.
   */
  async writeGmContextAtomic(args: WriteGmContextArgs): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.gmContexts)
        .values({
          adventureId: args.adventureId,
          blob: args.gmContextBlob,
        })
        .onConflictDoUpdate({
          target: schema.gmContexts.adventureId,
          set: { blob: args.gmContextBlob, updatedAt: sql`now()` },
        });

      await tx
        .insert(schema.campaignStates)
        .values({
          campaignId: args.campaignId,
          system: 'mothership',
          schemaVersion: 1,
          data: args.campaignStateData,
        })
        .onConflictDoUpdate({
          target: schema.campaignStates.campaignId,
          set: { data: args.campaignStateData, updatedAt: sql`now()` },
        });

      if (args.gridEntities.length > 0) {
        await tx.insert(schema.gridEntities).values(
          args.gridEntities.map((entity) => ({
            campaignId: args.campaignId,
            entityRef: entity.entityRef,
            x: entity.x,
            y: entity.y,
            z: entity.z,
            visible: entity.visible,
            tags: entity.tags,
          })),
        );
      }

      await tx
        .update(schema.adventures)
        .set({ status: 'ready' })
        .where(eq(schema.adventures.id, args.adventureId));

      await tx
        .update(schema.pendingCanon)
        .set({ status: 'promoted', reviewedAt: sql`now()` })
        .where(
          and(
            eq(schema.pendingCanon.adventureId, args.adventureId),
            eq(schema.pendingCanon.status, 'pending'),
          ),
        );
    });
  }

  async setAdventureFailed(
    adventureId: string,
    errorDetail?: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.adventures)
        .set({ status: 'failed' })
        .where(eq(schema.adventures.id, adventureId));

      if (errorDetail) {
        await tx
          .insert(schema.gmContexts)
          .values({
            adventureId,
            blob: { error: errorDetail },
          })
          .onConflictDoUpdate({
            target: schema.gmContexts.adventureId,
            set: { blob: { error: errorDetail }, updatedAt: sql`now()` },
          });
      }
    });
  }

  /**
   * Bulk-promote pending canon for an adventure. Extracted as a standalone
   * method so M6's `submit_gm_response` handler can reuse it after each turn
   * in Solo Blind campaigns. The write inside `writeGmContextAtomic` performs
   * the same operation as part of the synthesis transaction; this method is
   * the standalone entrypoint for callers outside that transaction.
   *
   * Accepts an optional `tx` so M6's per-turn orchestrator can run the
   * promotion inside its own transaction alongside state, event, and
   * telemetry writes. Defaults to `this.db` for the existing M4 call site.
   */
  async autoPromoteCanon(adventureId: string, tx?: DbOrTx): Promise<void> {
    const runner = tx ?? this.db;
    await runner
      .update(schema.pendingCanon)
      .set({ status: 'promoted', reviewedAt: sql`now()` })
      .where(
        and(
          eq(schema.pendingCanon.adventureId, adventureId),
          eq(schema.pendingCanon.status, 'pending'),
        ),
      );
  }
}
