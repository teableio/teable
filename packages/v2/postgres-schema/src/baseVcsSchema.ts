/**
 * Schema bootstrap statements for Base VCS tables.
 *
 * Strictly for test harnesses and local PGlite bootstrap (`ensureSchema: true`).
 * Runtime PostgreSQL deployments create these tables via Prisma / Data DB migrations
 * (`20261118100000_add_base_vcs_tables`), never via request-path DDL.
 */
export const baseVcsSchemaStatements: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS base_vcs_head (
  base_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  enabled_barrier_xid xid8 NOT NULL DEFAULT '0'::xid8,
  head_revision bigint NOT NULL DEFAULT 0,
  min_retained_seq bigint NOT NULL DEFAULT 0,
  min_retained_xid xid8 NOT NULL DEFAULT '0'::xid8,
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS base_vcs_change (
  seq bigserial PRIMARY KEY,
  tx_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  base_id text NOT NULL,
  revision bigint,
  origin_push_id text,
  table_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  field_id text,
  op_kind text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS base_vcs_change_base_seq_idx
  ON base_vcs_change (base_id, seq)`,
  `CREATE INDEX IF NOT EXISTS base_vcs_change_base_tx_idx
  ON base_vcs_change (base_id, tx_id)`,
  `CREATE INDEX IF NOT EXISTS base_vcs_change_base_rev_idx
  ON base_vcs_change (base_id, revision)`,
  `CREATE INDEX IF NOT EXISTS base_vcs_change_origin_idx
  ON base_vcs_change (base_id, origin_push_id)`,
  `CREATE INDEX IF NOT EXISTS base_vcs_change_entity_idx
  ON base_vcs_change (base_id, table_id, entity_type, entity_id)`,
  `CREATE TABLE IF NOT EXISTS base_vcs_commit (
  commit_id text PRIMARY KEY,
  base_id text NOT NULL,
  revision bigint NOT NULL,
  parent_revision bigint NOT NULL,
  parents bigint[] NOT NULL DEFAULT '{}',
  seq_upto bigint NOT NULL DEFAULT 0,
  origin_push_id text,
  actor_id text NOT NULL,
  message text,
  summary_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS base_vcs_commit_base_rev_key
  ON base_vcs_commit (base_id, revision)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS base_vcs_commit_base_origin_push_key
  ON base_vcs_commit (base_id, origin_push_id)
  WHERE origin_push_id IS NOT NULL`,
];

export const baseVcsSchemaSql = baseVcsSchemaStatements.join(';\n\n');
