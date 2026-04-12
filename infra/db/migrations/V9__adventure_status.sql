CREATE TYPE adventure_status AS ENUM ('synthesizing', 'ready', 'completed', 'failed');

ALTER TABLE adventure
  ADD COLUMN status adventure_status NOT NULL DEFAULT 'synthesizing';

-- Back-fill: adventures that already have a gm_context row are 'ready'.
UPDATE adventure a
SET status = 'ready'
WHERE EXISTS (
  SELECT 1 FROM gm_context g WHERE g.adventure_id = a.id
);

-- Adventures with completed_at set are 'completed'.
UPDATE adventure
SET status = 'completed'
WHERE completed_at IS NOT NULL;
