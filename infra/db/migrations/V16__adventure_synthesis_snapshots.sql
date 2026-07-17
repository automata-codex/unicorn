CREATE TABLE adventure_synthesis_snapshots (
  adventure_id                   uuid        PRIMARY KEY REFERENCES adventure(id) ON DELETE CASCADE,
  gm_context_schema_version      integer     NOT NULL,
  gm_context_blob                jsonb       NOT NULL,
  campaign_state_schema_version  integer     NOT NULL,
  campaign_state_data            jsonb       NOT NULL,
  captured_at                    timestamptz NOT NULL DEFAULT now()
);
