-- Auth.js tables. Do not modify the shape without checking
-- Auth.js Drizzle adapter compatibility.

CREATE TABLE "user" (
  id             text PRIMARY KEY,
  name           text,
  email          text UNIQUE,
  email_verified timestamptz,
  image          text
);

CREATE TABLE account (
  user_id             text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type                text NOT NULL,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token       text,
  access_token        text,
  expires_at          integer,
  token_type          text,
  scope               text,
  id_token            text,
  session_state       text,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE session (
  session_token text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires       timestamptz NOT NULL
);

CREATE TABLE verification_token (
  identifier text NOT NULL,
  token      text NOT NULL,
  expires    timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);
