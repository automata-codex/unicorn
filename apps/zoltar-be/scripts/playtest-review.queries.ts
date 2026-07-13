import { sql } from 'drizzle-orm';

import type { Db } from '../src/db/db.provider';

import type {
  CorrectionRow,
  HeaderRow,
  TurnRow,
} from './playtest-review.render';

// The three views are raw SQL — they are not modelled in `src/db/schema.ts`
// (Drizzle does not represent views natively). The queries below run through
// the Drizzle `sql` tag, which gives us parameterized values + typed results
// while staying off the schema builder.

// ---------------------------------------------------------------------------
// Header — joins adventure, campaign, and game_system so the report can
// render a human-readable header. Turn count / date range are computed via
// subqueries against turn_log so a single round-trip suffices.
// ---------------------------------------------------------------------------

// Using `type` rather than `interface` — Drizzle's `db.execute<T>` constrains
// T to `Record<string, unknown>`, which object-literal types satisfy
// implicitly but interfaces do not. Same applies to the two types below.
// Drizzle's `db.execute` bypasses pg's default type parsers for timestamptz
// columns — values come back as ISO strings rather than Date instances.
// We normalize to Date at the query-layer boundary so the renderer stays
// typed against Date and doesn't have to care about the mapping.
type HeaderQueryRow = {
  adventure_id: string;
  campaign_id: string;
  campaign_name: string;
  game_system_name: string;
  turn_count: string; // COUNT returns bigint — pg driver yields string.
  first_turn_at: Date | string | null;
  last_turn_at: Date | string | null;
};

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

export async function queryHeader(
  db: Db,
  adventureId: string,
): Promise<HeaderRow | null> {
  const { rows } = await db.execute<HeaderQueryRow>(sql`
    SELECT
      a.id                                                  AS adventure_id,
      c.id                                                  AS campaign_id,
      c.name                                                AS campaign_name,
      gs.name                                               AS game_system_name,
      (SELECT COUNT(*) FROM turn_log tl
        WHERE tl.adventure_id = a.id)                       AS turn_count,
      (SELECT MIN(turn_created_at) FROM turn_log tl
        WHERE tl.adventure_id = a.id)                       AS first_turn_at,
      (SELECT MAX(turn_created_at) FROM turn_log tl
        WHERE tl.adventure_id = a.id)                       AS last_turn_at
    FROM adventure a
    JOIN campaign c ON c.id = a.campaign_id
    JOIN game_system gs ON gs.id = c.system_id
    WHERE a.id = ${adventureId}
  `);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    adventureId: r.adventure_id,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    gameSystemName: r.game_system_name,
    turnCount: Number(r.turn_count),
    firstTurnAt: toDate(r.first_turn_at) ?? new Date(0),
    lastTurnAt: toDate(r.last_turn_at) ?? new Date(0),
  };
}

// ---------------------------------------------------------------------------
// Turns — one row per gm_response, ordered chronologically. The full
// telemetry_payload is returned as jsonb (pg driver yields parsed JSON).
// ---------------------------------------------------------------------------

type TurnQueryRow = {
  gm_response_seq: number;
  turn_created_at: Date | string;
  superseded_by: string | null;
  telemetry_payload: unknown;
  warden_prompt_filename: string | null;
  warden_prompt_hash: string | null;
};

export async function queryTurns(
  db: Db,
  adventureId: string,
): Promise<TurnRow[]> {
  const { rows } = await db.execute<TurnQueryRow>(sql`
    SELECT
      gm_response_seq,
      turn_created_at,
      superseded_by,
      telemetry_payload,
      warden_prompt_filename,
      warden_prompt_hash
    FROM turn_log
    WHERE adventure_id = ${adventureId}
    ORDER BY gm_response_seq
  `);
  return rows.map((r) => ({
    gmResponseSeq: r.gm_response_seq,
    turnCreatedAt: toDate(r.turn_created_at) as Date,
    supersededBy: r.superseded_by,
    telemetryPayload: r.telemetry_payload as TurnRow['telemetryPayload'],
    wardenPromptFilename: r.warden_prompt_filename,
    wardenPromptHash: r.warden_prompt_hash,
  }));
}

// ---------------------------------------------------------------------------
// Corrections — one row per correction event, joined to the superseded
// gm_response and its telemetry row. Join direction matches V13:
// `orig.superseded_by = c.id`.
// ---------------------------------------------------------------------------

type CorrectionQueryRow = {
  correction_seq: number;
  corrected_at: Date | string;
  original_seq: number;
  original_response: unknown;
  corrected_response: unknown;
  rejections: unknown;
  correction_prompt_tokens: number | null;
  correction_completion_tokens: number | null;
};

export async function queryCorrections(
  db: Db,
  adventureId: string,
): Promise<CorrectionRow[]> {
  const { rows } = await db.execute<CorrectionQueryRow>(sql`
    SELECT
      correction_seq,
      corrected_at,
      original_seq,
      original_response,
      corrected_response,
      rejections,
      correction_prompt_tokens,
      correction_completion_tokens
    FROM correction_log
    WHERE adventure_id = ${adventureId}
    ORDER BY correction_seq
  `);
  return rows.map((r) => ({
    correctionSeq: r.correction_seq,
    correctedAt: toDate(r.corrected_at) as Date,
    originalSeq: r.original_seq,
    // game_event.payload for a gm_response carries the raw `SubmitGmResponse`.
    // Casting through unknown: this is the boundary between jsonb and TS.
    originalResponse: r.original_response as CorrectionRow['originalResponse'],
    correctedResponse: r.corrected_response as CorrectionRow['correctedResponse'],
    rejections: (r.rejections ?? []) as CorrectionRow['rejections'],
    correctionPromptTokens: r.correction_prompt_tokens,
    correctionCompletionTokens: r.correction_completion_tokens,
  }));
}
