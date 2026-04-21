import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { DB_TOKEN } from '../db/db.provider';
import * as schema from '../db/schema';

import type { Db, DbOrTx } from '../db/db.provider';

/**
 * Owns reads and writes on the `pending_canon` table. Shared between
 * synthesis (creates and auto-promotes canon at adventure assembly) and
 * session (inserts fresh canon per turn; auto-promotes after each turn in
 * Solo Blind mode). Both entrypoints are tx-aware so callers can bundle
 * canon work into larger atomic transactions.
 */
@Injectable()
export class CanonRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

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
   * Bulk-promote all `pending` rows for an adventure to `promoted` with a
   * `reviewed_at` timestamp. Used by Solo Blind — players do not review
   * canon in that mode, so entries land promoted immediately.
   *
   * `tx` is optional; omit to run as a standalone statement.
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
