CREATE TYPE event_type AS ENUM (
  'player_action',
  'gm_response',
  'dice_roll',
  'state_update',
  'correction'
);

CREATE TYPE actor_type AS ENUM ('player', 'system', 'gm');

CREATE TYPE roll_source AS ENUM ('system_generated', 'player_entered');

CREATE TABLE game_event (
  id               uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid       NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  adventure_id     uuid       NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  sequence_number  integer    NOT NULL,
  event_type       event_type NOT NULL,
  actor_type       actor_type NOT NULL,
  actor_id         text,                   -- user_id for player events, null for system/gm
  roll_source      roll_source,            -- populated for dice_roll events only
  payload          jsonb      NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  superseded_by    uuid REFERENCES game_event(id),  -- null unless this event has been corrected
  UNIQUE (adventure_id, sequence_number)
);

CREATE INDEX game_event_campaign_idx ON game_event (campaign_id);
CREATE INDEX game_event_adventure_idx ON game_event (adventure_id);
