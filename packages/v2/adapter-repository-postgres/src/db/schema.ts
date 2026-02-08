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
    .addColumn('deleted_time', 'timestamptz')
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('last_modified_by', 'text')
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
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('order', 'double precision', (col) => col.notNull())
    .addColumn('created_time', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_modified_time', 'timestamptz')
    .addColumn('deleted_time', 'timestamptz')
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('last_modified_by', 'text')
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
    .addColumn('failed_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull())
    .execute();

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
