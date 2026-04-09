CREATE EXTENSION IF NOT EXISTS vector;

-- Seed Phase 1 game systems.
-- Additional systems are inserted here as phases progress — no migration required per system.
INSERT INTO game_system (slug, name, index_source, embedding_dim) VALUES
  ('mothership', 'Mothership', 'user_provided', 1024);

CREATE TABLE rules_chunk (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id    uuid        NOT NULL REFERENCES game_system(id) ON DELETE CASCADE,
  source       text        NOT NULL,   -- e.g. 'Mothership Player''s Survival Guide p.34'
  section_path text[]      NOT NULL,   -- e.g. '{Combat,"Panic Checks"}'
  content      text        NOT NULL,
  embedding    vector(1024),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rules_chunk_system_idx ON rules_chunk (system_id);
CREATE INDEX rules_chunk_embedding_idx ON rules_chunk
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
