import { computedReliabilitySchemaSql } from '@teable/v2-postgres-schema';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export const ensureV1MetaSchema = async (db: Kysely<V1TeableDatabase>): Promise<void> => {
  await db.schema
    .createTable('space')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('credit', 'integer')
    .addColumn('deleted_time', 'timestamptz')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('last_modified_by', 'text')
    .addColumn('last_modified_time', 'timestamptz')
    .addColumn('is_template', 'boolean')
    .execute();

  await db.schema
    .createTable('base')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('space_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('order', 'double precision', (col) => col.notNull())
    .addColumn('icon', 'text')
    .addColumn('schema_pass', 'text')
    .addColumn('provision_state', 'text', (col) => col.notNull().defaultTo('ready'))
    .addColumn('deleted_time', 'timestamptz')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('last_modified_by', 'text')
    .addColumn('last_modified_time', 'timestamptz')
    .execute();

  await db.schema
    .createTable('space_data_db_binding')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('space_id', 'text', (col) => col.notNull().unique())
    .addColumn('data_db_connection_id', 'text')
    .addColumn('mode', 'text', (col) => col.notNull().defaultTo('default'))
    .addColumn('state', 'text', (col) => col.notNull().defaultTo('ready'))
    .addColumn('created_by', 'text', (col) => col.notNull().defaultTo('system'))
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .execute();

  await db.schema
    .createTable('table_meta')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('icon', 'text')
    .addColumn('db_table_name', 'text', (col) => col.notNull())
    .addColumn('db_view_name', 'text')
    .addColumn('provision_state', 'text', (col) => col.notNull().defaultTo('ready'))
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('order', 'double precision', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .addColumn('deleted_time', 'timestamptz')
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('last_modified_by', 'text')
    .execute();

  await db.schema
    .createTable('schema_operation')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('phase', 'text', (col) => col.notNull())
    .addColumn('resource_type', 'text', (col) => col.notNull())
    .addColumn('resource_id', 'text', (col) => col.notNull())
    .addColumn('base_id', 'text')
    .addColumn('table_id', 'text')
    .addColumn('idempotency_key', 'text', (col) => col.notNull().unique())
    .addColumn('payload', 'jsonb')
    .addColumn('result', 'jsonb')
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('next_run_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('locked_at', 'timestamptz')
    .addColumn('locked_by', 'text')
    .addColumn('last_error', 'text')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('last_modified_time', 'timestamptz')
    .addColumn('last_modified_by', 'text')
    .execute();

  await db.schema
    .createIndex('schema_operation_status_next_run_at_idx')
    .ifNotExists()
    .on('schema_operation')
    .columns(['status', 'next_run_at'])
    .execute();

  await db.schema
    .createIndex('schema_operation_resource_status_idx')
    .ifNotExists()
    .on('schema_operation')
    .columns(['resource_type', 'resource_id', 'status'])
    .execute();

  await db.schema
    .createIndex('schema_operation_base_status_idx')
    .ifNotExists()
    .on('schema_operation')
    .columns(['base_id', 'status'])
    .execute();

  await db.schema
    .createIndex('schema_operation_table_status_idx')
    .ifNotExists()
    .on('schema_operation')
    .columns(['table_id', 'status'])
    .execute();

  await db.schema
    .createTable('field')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('options', 'text')
    .addColumn('meta', 'text')
    .addColumn('ai_config', 'text')
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('cell_value_type', 'text', (col) => col.notNull())
    .addColumn('is_multiple_cell_value', 'boolean')
    .addColumn('db_field_type', 'text', (col) => col.notNull())
    .addColumn('db_field_name', 'text', (col) => col.notNull())
    .addColumn('provision_state', 'text', (col) => col.notNull().defaultTo('ready'))
    .addColumn('not_null', 'boolean')
    .addColumn('unique', 'boolean')
    .addColumn('is_primary', 'boolean')
    .addColumn('is_computed', 'boolean')
    .addColumn('is_lookup', 'boolean')
    .addColumn('is_conditional_lookup', 'boolean')
    .addColumn('is_pending', 'boolean')
    .addColumn('has_error', 'boolean')
    .addColumn('lookup_linked_field_id', 'text')
    .addColumn('lookup_options', 'text')
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('order', 'double precision', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .addColumn('deleted_time', 'timestamptz')
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('last_modified_by', 'text')
    .execute();

  await db.schema
    .createTable('reference')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('from_field_id', 'text', (col) => col.notNull())
    .addColumn('to_field_id', 'text', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('reference_from_field_id_idx')
    .ifNotExists()
    .on('reference')
    .column('from_field_id')
    .execute();

  await db.schema
    .createIndex('reference_to_field_id_idx')
    .ifNotExists()
    .on('reference')
    .column('to_field_id')
    .execute();

  await db.schema
    .createIndex('reference_to_field_id_from_field_id_key')
    .ifNotExists()
    .on('reference')
    .columns(['to_field_id', 'from_field_id'])
    .unique()
    .execute();

  await db.schema
    .createTable('view')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('sort', 'text')
    .addColumn('filter', 'text')
    .addColumn('group', 'text')
    .addColumn('options', 'text')
    .addColumn('order', 'double precision', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('column_meta', 'text', (col) => col.notNull())
    .addColumn('is_locked', 'boolean')
    .addColumn('enable_share', 'boolean')
    .addColumn('share_id', 'text')
    .addColumn('share_meta', 'text')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .addColumn('deleted_time', 'timestamptz')
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('last_modified_by', 'text')
    .execute();

  await db.schema
    .createTable('trash')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('resource_type', 'text', (col) => col.notNull())
    .addColumn('resource_id', 'text', (col) => col.notNull())
    .addColumn('parent_id', 'text')
    .addColumn('deleted_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_by', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('trash_resource_type_resource_id_key')
    .ifNotExists()
    .on('trash')
    .columns(['resource_type', 'resource_id'])
    .unique()
    .execute();

  await db.schema
    .createTable('table_trash')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('resource_type', 'text', (col) => col.notNull())
    .addColumn('snapshot', 'text', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('table_trash_table_id_idx')
    .ifNotExists()
    .on('table_trash')
    .column('table_id')
    .execute();

  await db.schema
    .createTable('record_trash')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('record_id', 'text', (col) => col.notNull())
    .addColumn('snapshot', 'text', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull().defaultTo('deleted'))
    .addColumn('record_created_time', 'timestamptz')
    .addColumn('record_created_by', 'text')
    .addColumn('record_last_modified_time', 'timestamptz')
    .addColumn('record_last_modified_by', 'text')
    .addColumn('operation_id', 'text')
    .execute();

  await db.schema
    .createIndex('record_trash_table_id_record_id_idx')
    .ifNotExists()
    .on('record_trash')
    .columns(['table_id', 'record_id'])
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS "record_trash_archived_removed_idx"
      ON "record_trash"("table_id", "created_time" DESC, "id" DESC) WHERE "reason" = 'archived'
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS "record_trash_archived_created_idx"
      ON "record_trash"("table_id", "record_created_time") WHERE "reason" = 'archived'
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS "record_trash_archived_creator_idx"
      ON "record_trash"("table_id", "record_created_by") WHERE "reason" = 'archived'
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS "record_trash_archived_modified_idx"
      ON "record_trash"("table_id", "record_last_modified_time") WHERE "reason" = 'archived'
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS "record_trash_archived_modifier_idx"
      ON "record_trash"("table_id", "record_last_modified_by") WHERE "reason" = 'archived'
  `.execute(db);

  await db.schema
    .createTable('computed_update_outbox')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('seed_table_id', 'text', (col) => col.notNull())
    .addColumn('seed_record_ids', 'jsonb')
    .addColumn('change_type', 'text', (col) => col.notNull())
    .addColumn('steps', 'jsonb')
    .addColumn('edges', 'jsonb')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('next_run_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('locked_at', 'timestamptz')
    .addColumn('locked_by', 'text')
    .addColumn('last_error', 'text')
    .addColumn('estimated_complexity', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('plan_hash', 'text', (col) => col.notNull())
    .addColumn('dirty_stats', 'jsonb')
    .addColumn('run_id', 'text', (col) => col.notNull())
    .addColumn('origin_run_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('run_total_steps', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('run_completed_steps_before', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('affected_table_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('affected_field_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('sync_max_level', 'integer')
    .addColumn('source_changed_at', 'timestamptz')
    .addColumn('stage_depth', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('predecessor_task_id', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('computed_update_outbox_seed')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('task_id', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('record_id', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('computed_update_outbox_ledger_scope_idx')
    .ifNotExists()
    .on('computed_update_outbox')
    .expression(sql`(dirty_stats->>'ledgerScopeId')`)
    .execute();

  await db.schema
    .createTable('computed_update_change_frontier')
    .ifNotExists()
    .addColumn('scope_id', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('record_id', 'text', (col) => col.notNull())
    .addColumn('field_id', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('computed_update_change_frontier_pkey', [
      'scope_id',
      'kind',
      'table_id',
      'record_id',
      'field_id',
    ])
    .execute();

  await db.schema
    .createTable('computed_update_stage_ledger')
    .ifNotExists()
    .addColumn('scope_id', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('record_id', 'text', (col) => col.notNull())
    .addColumn('seq', 'bigint', (col) => col.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('computed_update_stage_ledger_pkey', [
      'scope_id',
      'kind',
      'table_id',
      'record_id',
    ])
    .execute();

  await db.schema
    .createTable('computed_update_pause_scope')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('scope_type', 'text', (col) => col.notNull())
    .addColumn('scope_id', 'text', (col) => col.notNull())
    .addColumn('paused_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('paused_by', 'text')
    .addColumn('resume_at', 'timestamptz')
    .addColumn('reason', 'text')
    .addColumn('write_policy', 'text', (col) => col.notNull().defaultTo('allow_bounded'))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by', 'text')
    .execute();

  await db.schema
    .createTable('computed_update_dead_letter')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('seed_table_id', 'text', (col) => col.notNull())
    .addColumn('seed_record_ids', 'jsonb')
    .addColumn('change_type', 'text', (col) => col.notNull())
    .addColumn('steps', 'jsonb')
    .addColumn('edges', 'jsonb')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('next_run_at', 'timestamptz', (col) => col.notNull())
    .addColumn('locked_at', 'timestamptz')
    .addColumn('locked_by', 'text')
    .addColumn('last_error', 'text')
    .addColumn('estimated_complexity', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('plan_hash', 'text', (col) => col.notNull())
    .addColumn('dirty_stats', 'jsonb')
    .addColumn('run_id', 'text', (col) => col.notNull())
    .addColumn('origin_run_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('run_total_steps', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('run_completed_steps_before', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('affected_table_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('affected_field_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('sync_max_level', 'integer')
    .addColumn('source_changed_at', 'timestamptz')
    .addColumn('stage_depth', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('predecessor_task_id', 'text')
    .addColumn('trace_data', 'jsonb')
    .addColumn('failed_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('computed_update_run_history')
    .ifNotExists()
    .addColumn('task_id', 'text', (col) => col.primaryKey())
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('seed_table_id', 'text', (col) => col.notNull())
    .addColumn('change_type', 'text', (col) => col.notNull())
    .addColumn('run_id', 'text', (col) => col.notNull())
    .addColumn('origin_run_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('steps', 'jsonb')
    .addColumn('edges', 'jsonb')
    .addColumn('affected_table_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('affected_field_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('source_field_ids', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`)
    )
    .addColumn('seed_record_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('stage_depth', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('predecessor_task_id', 'text')
    .addColumn('run_total_steps', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('run_completed_steps_before', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('sync_max_level', 'integer')
    .addColumn('estimated_complexity', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('outcome', 'text', (col) => col.notNull())
    .addColumn('source_changed_at', 'timestamptz')
    .addColumn('enqueued_at', 'timestamptz', (col) => col.notNull())
    .addColumn('started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz', (col) => col.notNull())
    .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex('computed_update_run_history_run_id_idx')
    .ifNotExists()
    .on('computed_update_run_history')
    .columns(['run_id'])
    .execute();
  await db.schema
    .createIndex('computed_update_run_history_base_id_completed_at_idx')
    .ifNotExists()
    .on('computed_update_run_history')
    .columns(['base_id', 'completed_at'])
    .execute();
  await db.schema
    .createIndex('computed_update_run_history_completed_at_idx')
    .ifNotExists()
    .on('computed_update_run_history')
    .columns(['completed_at'])
    .execute();
  await sql`
    CREATE INDEX IF NOT EXISTS "computed_update_run_history_origin_run_ids_gin"
    ON "computed_update_run_history" USING GIN ("origin_run_ids")
  `.execute(db);

  await db.schema
    .createIndex('computed_update_outbox_status_next_run_at_idx')
    .ifNotExists()
    .on('computed_update_outbox')
    .columns(['status', 'next_run_at'])
    .execute();

  await db.schema
    .createIndex('computed_update_outbox_base_id_seed_table_id_idx')
    .ifNotExists()
    .on('computed_update_outbox')
    .columns(['base_id', 'seed_table_id'])
    .execute();

  await db.schema
    .createIndex('computed_update_outbox_plan_hash_idx')
    .ifNotExists()
    .on('computed_update_outbox')
    .column('plan_hash')
    .execute();

  await db.schema
    .createIndex('computed_update_outbox_run_id_idx')
    .ifNotExists()
    .on('computed_update_outbox')
    .column('run_id')
    .execute();

  await db.schema
    .createIndex('computed_update_outbox_seed_task_id_idx')
    .ifNotExists()
    .on('computed_update_outbox_seed')
    .column('task_id')
    .execute();

  await db.schema
    .createIndex('computed_update_outbox_seed_task_id_table_id_record_id_key')
    .ifNotExists()
    .on('computed_update_outbox_seed')
    .columns(['task_id', 'table_id', 'record_id'])
    .unique()
    .execute();

  await db.schema
    .createIndex('computed_update_stage_ledger_scope_id_kind_seq_idx')
    .ifNotExists()
    .on('computed_update_stage_ledger')
    .columns(['scope_id', 'kind', 'seq'])
    .execute();

  await db.schema
    .createIndex('computed_update_pause_scope_scope_type_scope_id_key')
    .ifNotExists()
    .on('computed_update_pause_scope')
    .columns(['scope_type', 'scope_id'])
    .unique()
    .execute();

  await db.schema
    .createIndex('computed_update_pause_scope_resume_at_idx')
    .ifNotExists()
    .on('computed_update_pause_scope')
    .column('resume_at')
    .execute();

  await sql`
    ALTER TABLE computed_update_pause_scope
    ADD COLUMN IF NOT EXISTS write_policy text NOT NULL DEFAULT 'allow_bounded'
  `.execute(db);

  await db.schema
    .createIndex('computed_update_dead_letter_base_id_seed_table_id_idx')
    .ifNotExists()
    .on('computed_update_dead_letter')
    .columns(['base_id', 'seed_table_id'])
    .execute();

  await db.schema
    .createIndex('computed_update_dead_letter_plan_hash_idx')
    .ifNotExists()
    .on('computed_update_dead_letter')
    .column('plan_hash')
    .execute();

  await db.schema
    .createIndex('computed_update_dead_letter_run_id_idx')
    .ifNotExists()
    .on('computed_update_dead_letter')
    .column('run_id')
    .execute();

  // Computed field/table activity projection (Feishu-like "calculating" metadata)
  await db.schema
    .createTable('computed_field_activity')
    .ifNotExists()
    .addColumn('field_id', 'text', (col) => col.primaryKey())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('active_task_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('processing_task_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('generation', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('estimated_complexity', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('estimated_dirty_records', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('has_all_target_records', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('queued_at', 'timestamptz')
    .addColumn('started_at', 'timestamptz')
    .addColumn('last_completed_at', 'timestamptz')
    .addColumn('last_duration_ms', 'integer')
    .addColumn('last_error', 'jsonb')
    .addColumn('extensions', 'jsonb')
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('computed_field_activity_table_id_status_idx')
    .ifNotExists()
    .on('computed_field_activity')
    .columns(['table_id', 'status'])
    .execute();

  await db.schema
    .createIndex('computed_field_activity_base_id_status_idx')
    .ifNotExists()
    .on('computed_field_activity')
    .columns(['base_id', 'status'])
    .execute();

  await db.schema
    .createTable('computed_table_activity')
    .ifNotExists()
    .addColumn('table_id', 'text', (col) => col.primaryKey())
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('calculating_field_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('queued_field_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('estimated_complexity', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('recent_completions', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('generation', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('computed_table_activity_base_id_status_idx')
    .ifNotExists()
    .on('computed_table_activity')
    .columns(['base_id', 'status'])
    .execute();

  for (const statement of computedReliabilitySchemaSql.split(';').filter((part) => part.trim())) {
    await sql.raw(statement).execute(db);
  }

  await db.schema
    .createTable('computed_task_field_ref')
    .ifNotExists()
    .addColumn('task_id', 'text', (col) => col.notNull())
    .addColumn('field_id', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('base_id', 'text', (col) => col.notNull())
    .addColumn('was_processing', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('computed_task_field_ref_task_id_field_id_key')
    .ifNotExists()
    .on('computed_task_field_ref')
    .columns(['task_id', 'field_id'])
    .unique()
    .execute();

  await db.schema
    .createIndex('computed_task_field_ref_field_id_idx')
    .ifNotExists()
    .on('computed_task_field_ref')
    .column('field_id')
    .execute();

  await db.schema
    .createIndex('computed_task_field_ref_table_id_idx')
    .ifNotExists()
    .on('computed_task_field_ref')
    .column('table_id')
    .execute();

  // Attachments tables (for attachment field support)
  await db.schema
    .createTable('attachments')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('token', 'text', (col) => col.notNull().unique())
    .addColumn('path', 'text', (col) => col.notNull())
    .addColumn('size', 'bigint', (col) => col.notNull())
    .addColumn('mimetype', 'text', (col) => col.notNull())
    .addColumn('hash', 'text')
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('deleted_time', 'timestamptz')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('attachments_table')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('attachment_id', 'text', (col) => col.notNull())
    .addColumn('token', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('table_id', 'text', (col) => col.notNull())
    .addColumn('record_id', 'text', (col) => col.notNull())
    .addColumn('field_id', 'text', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('attachments_table_attachment_id_idx')
    .ifNotExists()
    .on('attachments_table')
    .column('attachment_id')
    .execute();

  await db.schema
    .createIndex('attachments_table_token_idx')
    .ifNotExists()
    .on('attachments_table')
    .column('token')
    .execute();
};
