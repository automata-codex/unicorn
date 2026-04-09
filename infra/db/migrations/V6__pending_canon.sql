CREATE TYPE canon_status AS ENUM ('pending', 'promoted', 'discarded');

CREATE TABLE pending_canon (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id uuid         NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  summary      text         NOT NULL,       -- one or two sentence description of the improvisation
  context      text         NOT NULL,       -- why it came up — what player action or fiction prompted it
  status       canon_status NOT NULL DEFAULT 'pending',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  reviewed_at  timestamptz                  -- null until promoted or discarded
);

CREATE INDEX pending_canon_adventure_idx ON pending_canon (adventure_id);
CREATE INDEX pending_canon_status_idx ON pending_canon (adventure_id, status);
