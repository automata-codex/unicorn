import { eq } from 'drizzle-orm';

import * as schema from '../../src/db/schema';
import {
  LoadSynthesisError,
  parseSynthesisExport,
} from '../load-synthesis.core';

import type { Db } from '../../src/db/db.provider';

export class ImportLegacySnapshotError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'ImportLegacySnapshotError';
  }
}

export interface ImportLegacySnapshotResult {
  adventureId: string;
}

/**
 * Validates `rawJson` as a legacy `SynthesisExport` (the shape the
 * now-removed `save-synthesis` CLI produced), confirms it matches
 * `adventureId`, confirms the adventure exists and has no snapshot row yet,
 * then inserts exactly one `adventure_synthesis_snapshots` row. Inserts
 * only — never overwrites an existing row.
 *
 * Exported for direct use from the integration test; the CLI wrapper
 * (`import-legacy-synthesis-snapshot.ts`) just handles file I/O and the DB
 * pool around this.
 */
export async function importLegacySynthesisSnapshot(
  db: Db,
  rawJson: unknown,
  adventureId: string,
): Promise<ImportLegacySnapshotResult> {
  let exportPayload: ReturnType<typeof parseSynthesisExport>;
  try {
    exportPayload = parseSynthesisExport(rawJson);
  } catch (err) {
    if (err instanceof LoadSynthesisError) {
      throw new ImportLegacySnapshotError(err.message, err.exitCode);
    }
    throw err;
  }

  if (exportPayload.source.adventureId !== adventureId) {
    throw new ImportLegacySnapshotError(
      "refusing to import: the file's source.adventureId " +
        `(${exportPayload.source.adventureId}) does not match the provided ` +
        `adventure id (${adventureId}). Pass the adventure id this file was ` +
        'actually saved from.',
      1,
    );
  }

  const [adventureRow] = await db
    .select({ id: schema.adventures.id })
    .from(schema.adventures)
    .where(eq(schema.adventures.id, adventureId))
    .limit(1);
  if (!adventureRow) {
    throw new ImportLegacySnapshotError(
      `no adventure found with id ${adventureId} in the target database.`,
      1,
    );
  }

  const [existingSnapshot] = await db
    .select({ adventureId: schema.adventureSynthesisSnapshots.adventureId })
    .from(schema.adventureSynthesisSnapshots)
    .where(eq(schema.adventureSynthesisSnapshots.adventureId, adventureId))
    .limit(1);
  if (existingSnapshot) {
    throw new ImportLegacySnapshotError(
      `adventure ${adventureId} already has a synthesis snapshot — this ` +
        'script inserts, it does not overwrite. Nothing to do.',
      1,
    );
  }

  await db.insert(schema.adventureSynthesisSnapshots).values({
    adventureId,
    gmContextSchemaVersion: exportPayload.gmContext.schemaVersion,
    gmContextBlob: exportPayload.gmContext.blob as Record<string, unknown>,
    campaignStateSchemaVersion: exportPayload.campaignState.schemaVersion,
    campaignStateData: exportPayload.campaignState.data as Record<
      string,
      unknown
    >,
  });

  return { adventureId };
}
