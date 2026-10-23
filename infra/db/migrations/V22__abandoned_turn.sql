-- ADR-0125 — record a turn the tool loop or an unrecoverable leak abandoned.
--
-- Such a turn writes no game events, so it has no sequence number and no
-- `adventure_telemetry` row. It gets its own table instead, which no reader of
-- `adventure_telemetry` can mistake for a finished turn.
--
-- `after_sequence_number` is the adventure's highest `game_event` sequence
-- number when the row was written (0 when there were none). Not unique: two
-- abandoned turns in a row share it.
--
-- `reason` is text rather than an enum so a new reason needs no migration.

CREATE TABLE abandoned_turn (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id          uuid        NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  reason                text        NOT NULL,
  after_sequence_number integer     NOT NULL,
  payload               jsonb       NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX abandoned_turn_adventure_idx ON abandoned_turn (adventure_id);
