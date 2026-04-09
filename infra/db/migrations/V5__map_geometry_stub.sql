-- Reserved for Phase 3. Created now to avoid a painful retrofit when
-- sub-cell geometry is added.

CREATE TYPE geometry_type AS ENUM ('wall', 'door', 'point_feature');

CREATE TABLE map_geometry (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid          NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  type            geometry_type NOT NULL,
  shape           jsonb         NOT NULL,  -- GeoJSON or simple coordinate array
  blocks_los      boolean       NOT NULL DEFAULT false,
  blocks_movement boolean       NOT NULL DEFAULT false
);
