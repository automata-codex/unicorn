-- Append-only diagnostic telemetry. One row per GM turn. Distinct from the
-- player-facing session export format.

CREATE TABLE adventure_telemetry (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id     uuid        NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  sequence_number  integer     NOT NULL,    -- matches game_events.sequence_number for the gm_response event
  payload          jsonb       NOT NULL,    -- player input, full submit_gm_response output,
                                            -- all roll_dice calls (notation, purpose, results),
                                            -- prompt_tokens, completion_tokens
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (adventure_id, sequence_number)
);

CREATE INDEX adventure_telemetry_adventure_idx ON adventure_telemetry (adventure_id);
