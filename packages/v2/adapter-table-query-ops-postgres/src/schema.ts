import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const doublePrecision = 'double precision';

export type TableQueryOpsDatabase = {
  table_query_observation_window: {
    id: string;
    space_id: string | null;
    base_id: string;
    table_id: string;
    query_kind: string;
    shape_hash: string;
    window_start: Date;
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
};

export const ensureTableQueryOpsSchema = async (
  db: Kysely<TableQueryOpsDatabase>
): Promise<void> => {
  await db.schema
    .createTable('table_query_observation_window')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('space_id', 'text')
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('query_kind', 'text', (col) => col.notNull())
    .addColumn('shape_hash', 'text', (col) => col.notNull())
    .addColumn('window_start', 'timestamptz', (col) => col.notNull())
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
    .execute();

  await sql`
    ALTER TABLE table_query_observation_window
    ADD COLUMN IF NOT EXISTS sql_diagnostics jsonb
  `.execute(db);

  await db.schema
    .createIndex('table_query_observation_window_unique_idx')
    .ifNotExists()
    .on('table_query_observation_window')
    .columns(['table_id', 'query_kind', 'shape_hash', 'window_start'])
    .unique()
    .execute();
  await db.schema
    .createIndex('table_query_observation_window_table_start_idx')
    .ifNotExists()
    .on('table_query_observation_window')
    .columns(['table_id', 'window_start'])
    .execute();
  await db.schema
    .createIndex('table_query_observation_window_base_start_idx')
    .ifNotExists()
    .on('table_query_observation_window')
    .columns(['base_id', 'window_start'])
    .execute();

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
};
