-- Three read-only views that shape game_event + adventure_telemetry into
-- review-friendly rows. Consumed by the playtest-review CLI (M7.1 Part 4)
-- and by humans issuing ad-hoc psql queries during playtest review.
--
-- DROP ... CASCADE before CREATE OR REPLACE so a subsequent migration that
-- changes a view's column shape (not just SQL body) applies cleanly without
-- requiring a manual drop. None of the views depend on another view, so
-- CASCADE is a no-op today; it's in place defensively for future iteration.
--
-- `superseded_by` direction: verified by reading apps/zoltar-be/src/session/
-- session.events.ts (at the time V13 was authored, line 163). The pointer
-- is set on the ORIGINAL gm_response row, referencing the correction's id.
-- Correction rows do NOT carry their own `superseded_by`. The correction_log
-- view below joins accordingly (`orig.superseded_by = c.id`), which is the
-- opposite direction from what the M7.1 spec text §3.3 wrote — the spec was
-- updated during implementation but the original wording was incorrect for
-- this codebase.

DROP VIEW IF EXISTS turn_log CASCADE;
DROP VIEW IF EXISTS state_history CASCADE;
DROP VIEW IF EXISTS correction_log CASCADE;

-- ---------------------------------------------------------------------------
-- turn_log: one row per gm_response event, joined to its telemetry row. The
-- primary per-turn view consumed by the review CLI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW turn_log AS
SELECT
  ge.adventure_id,
  ge.sequence_number                                        AS gm_response_seq,
  ge.created_at                                             AS turn_created_at,
  ge.superseded_by                                          AS superseded_by,
  at.sequence_number                                        AS telemetry_seq,
  at.payload                                                AS telemetry_payload,
  at.payload->>'playerMessage'                              AS player_message,
  at.payload->'originalResponse'->>'playerText'             AS gm_player_text,
  at.payload->'wardenPrompt'->>'filename'                   AS warden_prompt_filename,
  at.payload->'wardenPrompt'->>'hash'                       AS warden_prompt_hash,
  (at.payload->'originalRequest'->>'promptTokens')::int     AS prompt_tokens,
  (at.payload->'originalRequest'->>'completionTokens')::int AS completion_tokens,
  (at.payload->>'toolLoopIterations')::int                  AS tool_loop_iterations,
  jsonb_array_length(at.payload->'diceRolls')               AS dice_roll_count,
  jsonb_array_length(at.payload->'rulesLookups')            AS rules_lookup_count,
  (at.payload ? 'correction')                               AS had_correction
FROM game_event ge
JOIN adventure_telemetry at
  ON at.adventure_id = ge.adventure_id
  AND at.sequence_number = ge.sequence_number
WHERE ge.event_type = 'gm_response';

-- ---------------------------------------------------------------------------
-- state_history: one row per state_update event. Surfaces applied deltas
-- joined to the preceding gm_response / correction that caused them. Not
-- read by the CLI; useful for ad-hoc "how did HP evolve" queries in psql.
--
-- The correlated subquery identifies the most recent gm_response or
-- correction in the same adventure before this state_update. Fine at MVP
-- scale (hundreds of turns per adventure); rewrite as a window function if
-- a future adventure grows to tens of thousands of events.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW state_history AS
SELECT
  ge.adventure_id,
  ge.sequence_number         AS state_update_seq,
  ge.created_at              AS applied_at,
  ge.payload->'applied'      AS applied,
  ge.payload->'thresholds'   AS thresholds,
  (SELECT ge2.sequence_number
     FROM game_event ge2
    WHERE ge2.adventure_id = ge.adventure_id
      AND ge2.sequence_number < ge.sequence_number
      AND ge2.event_type IN ('gm_response', 'correction')
    ORDER BY ge2.sequence_number DESC
    LIMIT 1)                AS source_response_seq
FROM game_event ge
WHERE ge.event_type = 'state_update';

-- ---------------------------------------------------------------------------
-- correction_log: one row per correction event. Joins back to the superseded
-- gm_response and to the telemetry row that carries rejection + token
-- metadata for the correction round.
--
-- Join direction: the ORIGINAL gm_response carries `superseded_by = c.id`,
-- so the predicate is `orig.superseded_by = c.id`. Correction rows do not
-- reference the original. Telemetry is keyed to the original's sequence
-- number, because the correction's `payload.correction` lives inside the
-- same jsonb blob as the original's telemetry entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW correction_log AS
SELECT
  c.adventure_id,
  c.sequence_number                                                         AS correction_seq,
  c.created_at                                                              AS corrected_at,
  orig.sequence_number                                                      AS original_seq,
  orig.payload                                                              AS original_response,
  c.payload                                                                 AS corrected_response,
  at.payload->'correction'->'rejections'                                    AS rejections,
  (at.payload->'correction'->'correctionRequest'->>'promptTokens')::int     AS correction_prompt_tokens,
  (at.payload->'correction'->'correctionRequest'->>'completionTokens')::int AS correction_completion_tokens
FROM game_event c
JOIN game_event orig
  ON orig.adventure_id = c.adventure_id
  AND orig.superseded_by = c.id
JOIN adventure_telemetry at
  ON at.adventure_id = orig.adventure_id
  AND at.sequence_number = orig.sequence_number
WHERE c.event_type = 'correction';
