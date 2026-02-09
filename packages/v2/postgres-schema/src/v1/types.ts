/* eslint-disable @typescript-eslint/naming-convention */
import type { ColumnType } from 'kysely';

export interface V1UserTable {
  id: string;
  name: string;
  email: string | null;
  // password: string;
  // created_time: ColumnType<Date, Date | undefined, never>;
  // last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
}

export interface V1SpaceTable {
  id: string;
  name: string;
  credit: number | null;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_time: ColumnType<Date, Date | undefined, never>;
  created_by: string;
  last_modified_by: string | null;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  is_template: boolean | null;
}

export interface V1BaseTable {
  id: string;
  space_id: string;
  name: string;
  order: number;
  icon: string | null;
  schema_pass: string | null;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_time: ColumnType<Date, Date | undefined, never>;
  created_by: string;
  last_modified_by: string | null;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
}

export interface V1TableMetaTable {
  id: string;
  base_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  db_table_name: string;
  db_view_name: string | null;
  version: number;
  order: number;
  created_time: ColumnType<Date, Date | undefined, never>;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_by: string;
  last_modified_by: string | null;
}

export interface V1FieldTable {
  id: string;
  name: string;
  description: string | null;
  options: string | null;
  meta: string | null;
  ai_config: string | null;
  type: string;
  cell_value_type: string;
  is_multiple_cell_value: boolean | null;
  db_field_type: string;
  db_field_name: string;
  not_null: boolean | null;
  unique: boolean | null;
  is_primary: boolean | null;
  is_computed: boolean | null;
  is_lookup: boolean | null;
  is_conditional_lookup: boolean | null;
  is_pending: boolean | null;
  has_error: boolean | null;
  lookup_linked_field_id: string | null;
  lookup_options: string | null;
  table_id: string;
  order: number;
  version: number;
  created_time: ColumnType<Date, Date | undefined, never>;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_by: string;
  last_modified_by: string | null;
}

export interface V1ViewTable {
  id: string;
  name: string;
  description: string | null;
  table_id: string;
  type: string;
  sort: string | null;
  filter: string | null;
  group: string | null;
  options: string | null;
  order: number;
  version: number;
  column_meta: string;
  is_locked: boolean | null;
  enable_share: boolean | null;
  share_id: string | null;
  share_meta: string | null;
  created_time: ColumnType<Date, Date | undefined, never>;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_by: string;
  last_modified_by: string | null;
}

export interface V1ReferenceTable {
  id: string;
  from_field_id: string;
  to_field_id: string;
  created_time: ColumnType<Date, Date | undefined, never>;
}

export interface V1ComputedUpdateOutboxTable {
  id: string;
  base_id: string;
  seed_table_id: string;
  seed_record_ids: unknown | null;
  change_type: string;
  steps: unknown;
  edges: unknown;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_at: ColumnType<Date, Date | undefined, Date | undefined>;
  locked_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  locked_by: string | null;
  last_error: string | null;
  estimated_complexity: number;
  plan_hash: string;
  dirty_stats: unknown | null;
  run_id: string;
  origin_run_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  run_total_steps: number;
  run_completed_steps_before: number;
  affected_table_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  affected_field_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  sync_max_level: number | null;
  created_at: ColumnType<Date, Date | undefined, Date | undefined>;
  updated_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

export interface V1ComputedUpdateOutboxSeedTable {
  id: string;
  task_id: string;
  table_id: string;
  record_id: string;
}

export interface V1ComputedUpdateDeadLetterTable {
  id: string;
  base_id: string;
  seed_table_id: string;
  seed_record_ids: unknown | null;
  change_type: string;
  steps: unknown;
  edges: unknown;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_at: ColumnType<Date, Date | undefined, Date | undefined>;
  locked_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  locked_by: string | null;
  last_error: string | null;
  estimated_complexity: number;
  plan_hash: string;
  dirty_stats: unknown | null;
  run_id: string;
  origin_run_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  run_total_steps: number;
  run_completed_steps_before: number;
  affected_table_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  affected_field_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  sync_max_level: number | null;
  trace_data: unknown | null;
  failed_at: ColumnType<Date, Date | undefined, Date | undefined>;
  created_at: ColumnType<Date, Date | undefined, Date | undefined>;
  updated_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

export interface V1TeableDatabase {
  users: V1UserTable;
  space: V1SpaceTable;
  base: V1BaseTable;
  table_meta: V1TableMetaTable;
  field: V1FieldTable;
  view: V1ViewTable;
  reference: V1ReferenceTable;
  computed_update_outbox: V1ComputedUpdateOutboxTable;
  computed_update_outbox_seed: V1ComputedUpdateOutboxSeedTable;
  computed_update_dead_letter: V1ComputedUpdateDeadLetterTable;
}
