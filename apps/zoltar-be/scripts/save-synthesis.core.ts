import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import type { SynthesisExport } from '../src/synthesis/synthesis-export.schema';

import type { Db } from '../src/db/db.provider';

export class SaveSynthesisError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'SaveSynthesisError';
  }
}

/** Lowercase, underscores, alphanumerics only, truncated to 40 chars. */
export function slugifyCampaignName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'campaign'
  );
}

export function timestampLabel(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Reads the four source rows and produces a `SynthesisExport` shaped
 * for JSON serialization. Exported for direct use from the integration
 * test; the CLI just wraps I/O around it.
 *
 * Preconditions (each throws `SaveSynthesisError` with a clear message
 * and a non-zero exit code):
 *   - Adventure exists.
 *   - Adventure.mode === 'freeform' (initiative-mode export is Phase 2+).
 *   - Zero `gm_response` events — save is for starting conditions only.
 *   - Campaign + game_system rows resolve; system slug is 'mothership'.
 *   - gm_context row exists for the adventure.
 *   - campaign_state row exists for the campaign.
 */
export async function buildSynthesisExport(
  db: Db,
  adventureId: string,
): Promise<SynthesisExport> {
  const [adventureRow] = await db
    .select({
      id: schema.adventures.id,
      campaignId: schema.adventures.campaignId,
      mode: schema.adventures.mode,
    })
    .from(schema.adventures)
    .where(eq(schema.adventures.id, adventureId))
    .limit(1);
  if (!adventureRow) {
    throw new SaveSynthesisError(
      `No adventure found with id ${adventureId}.`,
      1,
    );
  }
  if (adventureRow.mode !== 'freeform') {
    throw new SaveSynthesisError(
      `Adventure ${adventureId} has mode '${adventureRow.mode}'. Only freeform adventures can be saved in M7.1.`,
      1,
    );
  }

  // Zero-turn precondition: no `gm_response` events for this adventure.
  // Any played turn disqualifies — save is for starting conditions only.
  // Players who want to export a played adventure should use the review
  // CLI (`task playtest:review`); a mid-session export is Phase 2+.
  const gmResponseCountResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM game_event
    WHERE adventure_id = ${adventureId}
      AND event_type = 'gm_response'
  `);
  const gmResponseCount = Number(gmResponseCountResult.rows[0]?.count ?? '0');
  if (gmResponseCount > 0) {
    throw new SaveSynthesisError(
      `Adventure ${adventureId} already has ${gmResponseCount} GM response${gmResponseCount === 1 ? '' : 's'} — save-synthesis is for zero-turn (unstarted) adventures only. Use \`task playtest:review -- ${adventureId}\` to export a played adventure as a review report.`,
      1,
    );
  }

  const [campaignRow] = await db
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      systemId: schema.campaigns.systemId,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, adventureRow.campaignId))
    .limit(1);
  if (!campaignRow) {
    // FK guarantees this can't happen in normal operation, but surfacing
    // a clear error here beats a cryptic undefined access downstream.
    throw new SaveSynthesisError(
      `Adventure ${adventureId} references missing campaign ${adventureRow.campaignId}.`,
      1,
    );
  }

  const [systemRow] = await db
    .select({ slug: schema.gameSystems.slug })
    .from(schema.gameSystems)
    .where(eq(schema.gameSystems.id, campaignRow.systemId))
    .limit(1);
  if (!systemRow) {
    throw new SaveSynthesisError(
      `Campaign ${campaignRow.id} references missing game_system ${campaignRow.systemId}.`,
      1,
    );
  }
  if (systemRow.slug !== 'mothership') {
    throw new SaveSynthesisError(
      `Campaign ${campaignRow.id} is system '${systemRow.slug}'. Only Mothership campaigns can be saved in M7.1.`,
      1,
    );
  }

  // gm_context is keyed by adventure_id (UNIQUE). V14 added schema_version
  // symmetrically with campaign_state; default is 1 for pre-V14 rows.
  const [gmContextRow] = await db
    .select({
      schemaVersion: schema.gmContexts.schemaVersion,
      blob: schema.gmContexts.blob,
    })
    .from(schema.gmContexts)
    .where(eq(schema.gmContexts.adventureId, adventureId))
    .limit(1);
  if (!gmContextRow) {
    throw new SaveSynthesisError(
      `Adventure ${adventureId} has no gm_context row — synthesis may not have completed.`,
      1,
    );
  }

  // campaign_state is keyed by campaign_id (UNIQUE) and carries its own
  // schema_version column.
  const [campaignStateRow] = await db
    .select({
      schemaVersion: schema.campaignStates.schemaVersion,
      data: schema.campaignStates.data,
    })
    .from(schema.campaignStates)
    .where(
      and(
        eq(schema.campaignStates.campaignId, campaignRow.id),
        eq(schema.campaignStates.system, systemRow.slug),
      ),
    )
    .limit(1);
  if (!campaignStateRow) {
    throw new SaveSynthesisError(
      `Campaign ${campaignRow.id} has no campaign_state row — synthesis may not have completed.`,
      1,
    );
  }

  const exportPayload: SynthesisExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: {
      campaignId: campaignRow.id,
      adventureId: adventureRow.id,
      campaignName: campaignRow.name,
    },
    system: { slug: 'mothership' },
    gmContext: {
      schemaVersion: gmContextRow.schemaVersion,
      blob: gmContextRow.blob,
    },
    campaignState: {
      schemaVersion: campaignStateRow.schemaVersion,
      data: campaignStateRow.data,
    },
    adventure: { mode: 'freeform' },
  };
  return exportPayload;
}
