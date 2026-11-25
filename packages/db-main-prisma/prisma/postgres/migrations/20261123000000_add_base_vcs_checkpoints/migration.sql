CREATE TABLE IF NOT EXISTS base_vcs_object (
  base_id text NOT NULL REFERENCES base_vcs_head(base_id) ON DELETE CASCADE,
  hash text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (base_id, hash)
);

CREATE TABLE IF NOT EXISTS base_vcs_checkpoint (
  base_id text NOT NULL REFERENCES base_vcs_head(base_id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision >= 0),
  base_name text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  tables jsonb NOT NULL,
  contains_foreign_references boolean NOT NULL DEFAULT true,
  PRIMARY KEY (base_id, revision)
);
