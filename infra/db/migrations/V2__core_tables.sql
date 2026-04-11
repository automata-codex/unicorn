-- Core domain tables. game_system is defined first so campaign.system_id
-- can reference it.

CREATE TYPE campaign_visibility AS ENUM ('private', 'invite', 'org');
CREATE TYPE dice_mode AS ENUM ('soft_accountability', 'commitment');
CREATE TYPE campaign_member_role AS ENUM ('owner', 'player');
CREATE TYPE adventure_mode AS ENUM ('freeform', 'initiative');
CREATE TYPE message_role AS ENUM ('player', 'gm', 'system');
CREATE TYPE index_source AS ENUM ('user_provided', 'srd');

CREATE TABLE game_system (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        NOT NULL UNIQUE,  -- 'mothership' | 'uvg' | 'fived' | 'ose' | etc.
  name          text        NOT NULL,          -- display name: 'Mothership', 'D&D 5e'
  index_source  index_source NOT NULL,         -- how the rules index is built
  embedding_dim integer     NOT NULL DEFAULT 1024,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign (
  id          uuid                NOT NULL DEFAULT gen_random_uuid(),
  org_id      uuid,                           -- nullable; null in self-hosted
  system_id   uuid                NOT NULL REFERENCES game_system(id),
  name        text                NOT NULL,
  visibility  campaign_visibility NOT NULL DEFAULT 'private',
  dice_mode   dice_mode           NOT NULL DEFAULT 'soft_accountability',
  created_at  timestamptz         NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE adventure (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid           NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  mode             adventure_mode NOT NULL DEFAULT 'freeform',
  caller_id        text           REFERENCES "user"(id) ON DELETE SET NULL,
  initiative_order text[],                    -- ordered array of entity identifiers; null when freeform
  rolling_summary  text,                      -- compressed history of messages outside the context window
  created_at       timestamptz    NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

CREATE TABLE gm_context (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id uuid        NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  blob         jsonb       NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (adventure_id)
);

CREATE TABLE campaign_state (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid        NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  system         text        NOT NULL,  -- slug; denormalized for now
  schema_version integer     NOT NULL DEFAULT 1,
  data           jsonb       NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);

CREATE TABLE campaign_member (
  campaign_id uuid                 NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  user_id     text                 NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role        campaign_member_role NOT NULL DEFAULT 'player',
  joined_at   timestamptz          NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE character_sheet (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid        NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  user_id        text        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  system         text        NOT NULL,  -- slug; denormalized for now
  schema_version integer     NOT NULL DEFAULT 1,
  data           jsonb       NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);

CREATE TABLE message (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id uuid         NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  role         message_role NOT NULL,
  content      text         NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now()
);
