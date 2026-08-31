import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const doublePrecision = 'double precision';

export type TableQueryObservationDatabase = {
  table_query_observation_shard: {
    space_id: string | null;
    base_id: string;
    table_id: string;
    query_kind: string;
    shape_hash: string;
    window_start: Date;
    writer_id: string;
    window_size_seconds: number;
    request_count: number;
    slow_count: number;
    timeout_count: number;
    db_error_count: number;
    total_duration_ms: number;
    max_duration_ms: number;
    total_db_duration_ms: number | null;
    max_db_duration_ms: number | null;
    shape: unknown;
    sql_diagnostics: unknown | null;
    created_time?: Date;
    last_modified_time?: Date | null;
  };
};

export type TableQueryOpsDatabase = {
  table_query_recommendation: {
    id: string;
    space_id: string | null;
    base_id: string;
    table_id: string;
    shape_hash: string;
    policy_version: string;
    status: string;
    risk_level: string;
    risk_score: number;
    reason_codes: unknown;
    remediation_candidates: unknown;
    snapshot: unknown;
    created_time?: Date;
    last_modified_time?: Date | null;
  };
  table_query_remediation_task: {
    id: string;
    recommendation_id: string | null;
    base_id: string;
    table_id: string;
    kind: string;
    status: string;
    payload: unknown;
    result: unknown | null;
    attempts: number;
    max_attempts: number;
    locked_at?: Date | null;
    locked_by?: string | null;
    last_error?: string | null;
    created_time?: Date;
    last_modified_time?: Date | null;
  };
  table_query_ops_lease: {
    lease_key: string;
    owner_id: string;
    expires_at: Date;
    updated_time: Date;
  };
  table_query_decision_log: {
    id: string;
    base_id: string;
    table_id: string;
    scope_key: string;
    action: string;
    actor: string;
    outcome: string;
    reason_codes: unknown;
    recommendation_id: string | null;
    would_auto_accept: boolean;
    cooldown_until: Date | null;
    decided_at: Date;
    created_time?: Date;
    last_modified_time?: Date | null;
  };
  table_query_search_vector_config: {
    id: string;
    space_id: string | null;
    base_id: string;
    table_id: string;
    candidate_key: string;
    semantics: string;
    access_path: string;
    provider: string;
    operator_class: string | null;
    language_config: string | null;
    generated_column_name: string;
    index_name: string;
    field_ids: unknown;
    field_db_names: unknown;
    search_scope: string;
    status: string;
    last_inspection: unknown | null;
    reclaim_idx_scan_baseline: number | null;
    reclaim_sampled_at: Date | null;
    reclaim_disabled_at: Date | null;
    reclaim_drop_after: Date | null;
    reclaim_drop_queued_at: Date | null;
    created_time?: Date;
    last_modified_time?: Date | null;
  };
};

export type EnsureTableQueryObservationSchemaOptions = {
  readonly lockTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
};

export const ensureTableQueryObservationSchema = async (
  db: Kysely<TableQueryObservationDatabase>,
  options: EnsureTableQueryObservationSchemaOptions = {}
): Promise<void> => {
  const lockTimeoutMs = options.lockTimeoutMs ?? 250;
  const statementTimeoutMs = options.statementTimeoutMs ?? 2_000;
  await db.transaction().execute(async (trx) => {
    await sql`
      SELECT
        set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true),
        set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)
    `.execute(trx);
    await ensureTableQueryObservationSchemaStatements(trx);
  });
};

const ensureTableQueryObservationSchemaStatements = async (
  db: Kysely<TableQueryObservationDatabase>
): Promise<void> => {
  await db.schema
    .createTable('table_query_observation_shard')
    .ifNotExists()
    .addColumn('space_id', 'text')
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('query_kind', 'text', (col) => col.notNull())
    .addColumn('shape_hash', 'text', (col) => col.notNull())
    .addColumn('window_start', 'timestamptz', (col) => col.notNull())
    .addColumn('writer_id', 'text', (col) => col.notNull())
    .addColumn('window_size_seconds', 'integer', (col) => col.notNull())
    .addColumn('request_count', 'integer', (col) => col.notNull())
    .addColumn('slow_count', 'integer', (col) => col.notNull())
    .addColumn('timeout_count', 'integer', (col) => col.notNull())
    .addColumn('db_error_count', 'integer', (col) => col.notNull())
    .addColumn('total_duration_ms', doublePrecision, (col) => col.notNull())
    .addColumn('max_duration_ms', doublePrecision, (col) => col.notNull())
    .addColumn('total_db_duration_ms', doublePrecision)
    .addColumn('max_db_duration_ms', doublePrecision)
    .addColumn('shape', 'jsonb', (col) => col.notNull())
    .addColumn('sql_diagnostics', 'jsonb')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .addPrimaryKeyConstraint('table_query_observation_shard_pkey', [
      'table_id',
      'query_kind',
      'shape_hash',
      'window_start',
      'writer_id',
    ])
    .execute();

  await sql`DROP INDEX IF EXISTS table_query_observation_shard_unique_idx`.execute(db);
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'table_query_observation_shard'
          AND column_name = 'id'
      ) THEN
        ALTER TABLE table_query_observation_shard
          DROP CONSTRAINT IF EXISTS table_query_observation_shard_pkey;
        ALTER TABLE table_query_observation_shard DROP COLUMN id;
        ALTER TABLE table_query_observation_shard
          ADD CONSTRAINT table_query_observation_shard_pkey
          PRIMARY KEY (table_id, query_kind, shape_hash, window_start, writer_id);
      END IF;
    END $$
  `.execute(db);
  await sql`
    DO $$
    BEGIN
      IF to_regclass(format('%I.%I', current_schema(), 'table_query_observation_window'))
        IS NOT NULL THEN
        INSERT INTO table_query_observation_shard (
          space_id,
          base_id,
          table_id,
          query_kind,
          shape_hash,
          window_start,
          writer_id,
          window_size_seconds,
          request_count,
          slow_count,
          timeout_count,
          db_error_count,
          total_duration_ms,
          max_duration_ms,
          total_db_duration_ms,
          max_db_duration_ms,
          shape,
          sql_diagnostics,
          created_time,
          last_modified_time
        )
        SELECT
          space_id,
          base_id,
          table_id,
          query_kind,
          shape_hash,
          window_start,
          'legacy',
          window_size_seconds,
          request_count,
          slow_count,
          timeout_count,
          db_error_count,
          total_duration_ms,
          max_duration_ms,
          total_db_duration_ms,
          max_db_duration_ms,
          shape,
          sql_diagnostics,
          created_time,
          last_modified_time
        FROM table_query_observation_window
        ON CONFLICT (table_id, query_kind, shape_hash, window_start, writer_id) DO NOTHING;

        DROP TABLE table_query_observation_window;
      END IF;
    END $$
  `.execute(db);

  await db.schema
    .createIndex('table_query_observation_shard_window_start_idx')
    .ifNotExists()
    .on('table_query_observation_shard')
    .column('window_start')
    .execute();

  await db.schema
    .createIndex('table_query_observation_shard_table_start_idx')
    .ifNotExists()
    .on('table_query_observation_shard')
    .columns(['table_id', 'window_start'])
    .execute();
  await db.schema
    .createIndex('table_query_observation_shard_search_activity_idx')
    .ifNotExists()
    .on('table_query_observation_shard')
    .columns(['query_kind', 'table_id', 'window_start'])
    .execute();
  await db.schema
    .createIndex('table_query_observation_shard_base_start_idx')
    .ifNotExists()
    .on('table_query_observation_shard')
    .columns(['base_id', 'window_start'])
    .execute();
};

export const ensureTableQueryOpsSchema = async (
  db: Kysely<TableQueryOpsDatabase>
): Promise<void> => {
  await db.schema
    .createTable('table_query_recommendation')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('space_id', 'text')
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('shape_hash', 'text', (col) => col.notNull())
    .addColumn('policy_version', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('risk_level', 'text', (col) => col.notNull())
    .addColumn('risk_score', 'integer', (col) => col.notNull())
    .addColumn('reason_codes', 'jsonb', (col) => col.notNull())
    .addColumn('remediation_candidates', 'jsonb', (col) => col.notNull())
    .addColumn('snapshot', 'jsonb', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .execute();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS table_query_recommendation_open_unique_idx
    ON table_query_recommendation (table_id, shape_hash, policy_version)
    WHERE status = 'open'
  `.execute(db);

  await db.schema
    .createTable('table_query_remediation_task')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('recommendation_id', 'text')
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('result', 'jsonb')
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(3))
    .addColumn('locked_at', 'timestamptz')
    .addColumn('locked_by', 'text')
    .addColumn('last_error', 'text')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('table_query_remediation_task_status_idx')
    .ifNotExists()
    .on('table_query_remediation_task')
    .columns(['status', 'kind', 'created_time'])
    .execute();

  await db.schema
    .createTable('table_query_ops_lease')
    .ifNotExists()
    .addColumn('lease_key', 'text', (col) => col.primaryKey())
    .addColumn('owner_id', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('updated_time', 'timestamptz', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('table_query_decision_log')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('scope_key', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('actor', 'text', (col) => col.notNull())
    .addColumn('outcome', 'text', (col) => col.notNull())
    .addColumn('reason_codes', 'jsonb', (col) => col.notNull())
    .addColumn('recommendation_id', 'text')
    .addColumn('would_auto_accept', 'boolean', (col) => col.notNull())
    .addColumn('cooldown_until', 'timestamptz')
    .addColumn('decided_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('table_query_decision_log_scope_idx')
    .ifNotExists()
    .on('table_query_decision_log')
    .columns(['table_id', 'scope_key', 'decided_at'])
    .execute();

  await db.schema
    .createIndex('table_query_decision_log_recommendation_idx')
    .ifNotExists()
    .on('table_query_decision_log')
    .columns(['recommendation_id', 'decided_at'])
    .execute();

  await db.schema
    .createTable('table_query_search_vector_config')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('space_id', 'text')
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('candidate_key', 'text', (col) => col.notNull())
    .addColumn('semantics', 'text', (col) => col.notNull().defaultTo('lexical'))
    .addColumn('access_path', 'text', (col) => col.notNull().defaultTo('generated_tsvector'))
    .addColumn('provider', 'text', (col) => col.notNull().defaultTo('tsvector'))
    .addColumn('operator_class', 'text')
    .addColumn('language_config', 'text')
    .addColumn('generated_column_name', 'text', (col) => col.notNull())
    .addColumn('index_name', 'text', (col) => col.notNull())
    .addColumn('field_ids', 'jsonb', (col) => col.notNull())
    .addColumn('field_db_names', 'jsonb', (col) => col.notNull())
    .addColumn('search_scope', 'text', (col) => col.notNull().defaultTo('all_fields'))
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('last_inspection', 'jsonb')
    .addColumn('reclaim_idx_scan_baseline', 'bigint')
    .addColumn('reclaim_sampled_at', 'timestamptz')
    .addColumn('reclaim_disabled_at', 'timestamptz')
    .addColumn('reclaim_drop_after', 'timestamptz')
    .addColumn('reclaim_drop_queued_at', 'timestamptz')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .execute();

  await sql`
    ALTER TABLE table_query_search_vector_config
    ADD COLUMN IF NOT EXISTS search_scope text NOT NULL DEFAULT 'all_fields'
  `.execute(db);
  await sql`
    ALTER TABLE table_query_search_vector_config
      ADD COLUMN IF NOT EXISTS reclaim_idx_scan_baseline bigint,
      ADD COLUMN IF NOT EXISTS reclaim_sampled_at timestamptz,
      ADD COLUMN IF NOT EXISTS reclaim_disabled_at timestamptz,
      ADD COLUMN IF NOT EXISTS reclaim_drop_after timestamptz,
      ADD COLUMN IF NOT EXISTS reclaim_drop_queued_at timestamptz
  `.execute(db);
  await sql`
    ALTER TABLE table_query_search_vector_config
      ADD COLUMN IF NOT EXISTS semantics text NOT NULL DEFAULT 'lexical',
      ADD COLUMN IF NOT EXISTS access_path text NOT NULL DEFAULT 'generated_tsvector',
      ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'tsvector',
      ADD COLUMN IF NOT EXISTS operator_class text
  `.execute(db);

  await db.schema
    .createIndex('table_query_search_vector_config_unique_idx')
    .ifNotExists()
    .on('table_query_search_vector_config')
    .columns(['table_id', 'candidate_key'])
    .unique()
    .execute();
};
