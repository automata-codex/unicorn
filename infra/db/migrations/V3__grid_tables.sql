CREATE TYPE terrain_type AS ENUM (
  'open',
  'full_blocker',        -- columns, walls, closed doors
  'partial_blocker',     -- low walls, crates: block LOS standing, not prone
  'transparent_blocker', -- iron bars: block movement, not LOS
  'difficult'            -- movement cost modifier
);

CREATE TABLE grid_cell (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid         NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  x               integer      NOT NULL,
  y               integer      NOT NULL,
  z               integer      NOT NULL DEFAULT 0,
  terrain_type    terrain_type NOT NULL DEFAULT 'open',
  blocks_los      boolean      NOT NULL DEFAULT false,
  blocks_movement boolean      NOT NULL DEFAULT false,
  climbable       boolean      NOT NULL DEFAULT false,
  elevation       integer      NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, x, y, z)
);

CREATE TABLE grid_entity (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid    NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  entity_ref  text    NOT NULL,  -- references a character, NPC, or terrain feature by identifier
  x           integer NOT NULL,
  y           integer NOT NULL,
  z           integer NOT NULL DEFAULT 0,
  visible     boolean NOT NULL DEFAULT true,  -- visible to player party
  tags        jsonb   NOT NULL DEFAULT '[]',
  UNIQUE (campaign_id, entity_ref)
);
