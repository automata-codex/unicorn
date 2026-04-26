import { asc, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import {
  synthesisExportSchema,
  type SynthesisExport,
} from '../src/synthesis/synthesis-export.schema';

import { timestampLabel } from './save-synthesis.core';

import type { Db } from '../src/db/db.provider';

export class LoadSynthesisError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'LoadSynthesisError';
  }
}

export interface LoadSynthesisOptions {
  /** Already-parsed JS object. `parseSynthesisExport` handles the decode. */
  exportPayload: SynthesisExport;
  /**
   * Overrides the new campaign name. If omitted, the new name is
   * `<original campaign name> (clone <yyyymmdd-hhmmss>)`.
   */
  nameOverride?: string;
  /**
   * Explicit user to own the new campaign. If omitted, the caller falls
   * back to the first user in the DB and `warnings` captures the
   * autoselection.
   */
  userId?: string;
}

export interface LoadSynthesisResult {
  campaignId: string;
  adventureId: string;
  campaignName: string;
  resolvedUserId: string;
  playUrl: string;
  warnings: string[];
}

/**
 * Validates a raw JS value against the `SynthesisExport` Zod schema and
 * returns the typed object. Throws `LoadSynthesisError` on any shape
 * mismatch; the CLI maps that to a non-zero exit with the Zod message.
 */
export function parseSynthesisExport(raw: unknown): SynthesisExport {
  const result = synthesisExportSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.');
    throw new LoadSynthesisError(
      `synthesis file failed validation${path ? ` at \`${path}\`` : ''}: ${first?.message ?? result.error.message}`,
      2,
    );
  }
  return result.data;
}

/**
 * Runs the load transaction:
 *   1. Resolve the target user (explicit → env → first-row fallback).
 *   2. Resolve the `system_id` from the saved slug.
 *   3. In one transaction, INSERT new campaign + member + adventure +
 *      gm_context + campaign_state rows with fresh UUIDs and the saved
 *      blobs/data preserved verbatim.
 *
 * Returns the new ids plus a paste-ready play URL. Warnings are collected
 * rather than printed so the caller (CLI vs. test) can decide what to do
 * with them.
 */
export async function buildAndRunLoad(
  db: Db,
  opts: LoadSynthesisOptions,
): Promise<LoadSynthesisResult> {
  const { exportPayload, nameOverride, userId: explicitUserId } = opts;
  const warnings: string[] = [];

  // TS narrows `slug` to 'mothership' after parse, so this branch is
  // unreachable today. Keep the defensive check anyway — a future widening
  // of the Zod enum shouldn't silently let non-Mothership files through
  // while the load path still assumes Mothership. Cast to string for the
  // check + template so the lint doesn't flag the unreachable-branch type.
  const slug = exportPayload.system.slug as string;
  if (slug !== 'mothership') {
    throw new LoadSynthesisError(
      `Unsupported system slug '${slug}'. Only 'mothership' is supported in M7.1.`,
      1,
    );
  }

  // --- User resolution -----------------------------------------------------

  let userId: string;
  if (explicitUserId && explicitUserId.length > 0) {
    const [userRow] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, explicitUserId))
      .limit(1);
    if (!userRow) {
      throw new LoadSynthesisError(
        `PLAYTEST_LOAD_USER_ID=${explicitUserId} does not match any user row.`,
        1,
      );
    }
    userId = userRow.id;
  } else {
    const [firstUser] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .orderBy(asc(schema.users.id))
      .limit(1);
    if (!firstUser) {
      throw new LoadSynthesisError(
        'No users exist in the database. Set PLAYTEST_LOAD_USER_ID or create a user first.',
        1,
      );
    }
    userId = firstUser.id;
    warnings.push(
      `PLAYTEST_LOAD_USER_ID unset — defaulting campaign ownership to first user: ${firstUser.id} <${firstUser.email ?? 'no-email'}>`,
    );
  }

  // --- System resolution ---------------------------------------------------

  const [systemRow] = await db
    .select({ id: schema.gameSystems.id })
    .from(schema.gameSystems)
    .where(eq(schema.gameSystems.slug, exportPayload.system.slug))
    .limit(1);
  if (!systemRow) {
    throw new LoadSynthesisError(
      `game_system row with slug '${exportPayload.system.slug}' not found. The target database needs the system seeded before loading a synthesis.`,
      1,
    );
  }

  const newCampaignName =
    nameOverride && nameOverride.length > 0
      ? nameOverride
      : `${exportPayload.source.campaignName} (clone ${timestampLabel()})`;

  // --- The actual transaction ---------------------------------------------

  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(schema.campaigns)
      .values({
        systemId: systemRow.id,
        name: newCampaignName,
        visibility: 'private',
        diceMode: 'soft_accountability',
      })
      .returning({ id: schema.campaigns.id });

    await tx.insert(schema.campaignMembers).values({
      campaignId: campaign.id,
      userId,
      role: 'owner',
    });

    const [adventure] = await tx
      .insert(schema.adventures)
      .values({
        campaignId: campaign.id,
        status: 'ready',
        mode: exportPayload.adventure.mode,
        callerId: userId,
      })
      .returning({ id: schema.adventures.id });

    await tx.insert(schema.gmContexts).values({
      adventureId: adventure.id,
      schemaVersion: exportPayload.gmContext.schemaVersion,
      // Zod typed `blob` as unknown at the boundary; the DB accepts any JSON.
      blob: exportPayload.gmContext.blob as Record<string, unknown>,
    });

    await tx.insert(schema.campaignStates).values({
      campaignId: campaign.id,
      system: exportPayload.system.slug,
      schemaVersion: exportPayload.campaignState.schemaVersion,
      data: exportPayload.campaignState.data as Record<string, unknown>,
    });

    return { campaignId: campaign.id, adventureId: adventure.id };
  });

  return {
    campaignId: result.campaignId,
    adventureId: result.adventureId,
    campaignName: newCampaignName,
    resolvedUserId: userId,
    playUrl: `/campaigns/${result.campaignId}/adventures/${result.adventureId}/play`,
    warnings,
  };
}
