-- Add `schema_version` to gm_context. Symmetric with the
-- `campaign_state.schema_version` column that V2 added. Motivated by
-- M7.1's save-synthesis CLI, which needs a durable versioning marker
-- on the gm_context blob — without this column the save script would
-- have to pin an implicit constant, and any future blob-shape change
-- would require a follow-up migration anyway.
--
-- Default `1` matches the existing implicit shape. Existing rows get
-- the default via the NOT NULL DEFAULT combination; no application
-- code needs to backfill.

ALTER TABLE gm_context
  ADD COLUMN schema_version integer NOT NULL DEFAULT 1;
