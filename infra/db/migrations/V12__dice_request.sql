CREATE TYPE dice_request_status AS ENUM ('pending', 'resolved', 'cancelled');

CREATE TABLE dice_request (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  adventure_id         uuid        NOT NULL REFERENCES adventure(id) ON DELETE CASCADE,
  issued_at_sequence   integer     NOT NULL,                   -- gm_response sequence_number that issued the request
  notation             text        NOT NULL,
  purpose              text        NOT NULL,
  target               integer,                                -- null in commitment mode
  status               dice_request_status NOT NULL DEFAULT 'pending',
  resolved_at_sequence integer,                                -- dice_roll sequence_number that resolved it
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dice_request_adventure_idx        ON dice_request (adventure_id);
CREATE INDEX dice_request_adventure_status_idx ON dice_request (adventure_id, status);
