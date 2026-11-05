-- Room store tables. Forward-only: a change ships as a new numbered file.
CREATE TABLE events (
  auction_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  body jsonb NOT NULL,
  PRIMARY KEY (auction_id, seq)
);

CREATE TABLE snapshots (
  auction_id text PRIMARY KEY,
  seq integer NOT NULL,
  state jsonb NOT NULL
);

CREATE TABLE jti_used (
  jti text PRIMARY KEY,
  until_ms bigint NOT NULL
);

CREATE TABLE jti_denied (
  jti text PRIMARY KEY,
  until_ms bigint NOT NULL
);

CREATE TABLE journals (
  key text PRIMARY KEY,
  version integer NOT NULL,
  value jsonb NOT NULL
);
