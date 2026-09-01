/* eslint-disable @typescript-eslint/naming-convention */
import type { ColumnType } from 'kysely';

export type V1ProvisionState = 'pending' | 'ready' | 'error' | 'deleting';
export type V1ProvisionStateColumn = ColumnType<
  V1ProvisionState,
  V1ProvisionState | undefined,
  V1ProvisionState
>;

export interface V1UserTable {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  is_system: boolean | null;
  phone: string | null;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
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
  provision_state: V1ProvisionStateColumn;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_time: ColumnType<Date, Date | undefined, never>;
  created_by: string;
  last_modified_by: string | null;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
}

export interface V1CollaboratorTable {
  id: string;
  resource_type: string;
  resource_id: string;
  principal_id: string;
  principal_type: string;
  created_time: ColumnType<Date, Date | undefined, never>;
}

export interface V1TableMetaTable {
  id: string;
  base_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  db_table_name: string;
  db_view_name: string | null;
  provision_state: V1ProvisionStateColumn;
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
  provision_state: V1ProvisionStateColumn;
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

export interface V1PluginTable {
  id: string;
  name: string;
  logo: string;
  url: string | null;
  status: string;
  positions: string;
  created_by: string;
}

export interface V1PluginInstallTable {
  id: string;
  plugin_id: string;
  base_id: string;
  name: string;
  position_id: string;
  position: string;
  storage: string | null;
  created_time: ColumnType<Date, Date | undefined, never>;
  created_by: string;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  last_modified_by: string | null;
}

export interface V1ReferenceTable {
  id: string;
  from_field_id: string;
  to_field_id: string;
  created_time: ColumnType<Date, Date | undefined, never>;
}

export interface V1SchemaOperationTable {
  id: string;
  type: string;
  status: string;
  phase: string;
  resource_type: string;
  resource_id: string;
  base_id: string | null;
  table_id: string | null;
  idempotency_key: string;
  payload: unknown | null;
  result: unknown | null;
  attempts: number;
  max_attempts: number;
  next_run_at: ColumnType<Date, Date | undefined, Date | undefined>;
  locked_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  locked_by: string | null;
  last_error: string | null;
  created_time: ColumnType<Date, Date | undefined, never>;
  created_by: string;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  last_modified_by: string | null;
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
  source_changed_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  stage_depth: ColumnType<number, number | undefined, number | undefined>;
  predecessor_task_id: string | null;
  created_at: ColumnType<Date, Date | undefined, Date | undefined>;
  updated_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

export interface V1ComputedUpdateOutboxSeedTable {
  id: string;
  task_id: string;
  table_id: string;
  record_id: string;
}

/**
 * Durable per-stage state for budget-staged computed updates, keyed by the
 * continuation chain's root task id (its scope): the processed-target exclusion
 * ledger (kind 'excluded'), the seq-ordered frontier queue (kind 'frontier'),
 * and retired frontier sources preserved for deferred edge chunks (kind
 * 'consumed'). Rows are written once and shared by every continuation of the
 * chain instead of being copied between task payloads.
 */
export interface V1ComputedUpdateStageLedgerTable {
  scope_id: string;
  /** 'excluded' | 'frontier' | 'consumed' */
  kind: string;
  table_id: string;
  record_id: string;
  seq: bigint | number | string;
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
  source_changed_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  stage_depth: ColumnType<number, number | undefined, number | undefined>;
  predecessor_task_id: string | null;
  trace_data: unknown | null;
  failed_at: ColumnType<Date, Date | undefined, Date | undefined>;
  created_at: ColumnType<Date, Date | undefined, Date | undefined>;
  updated_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

/**
 * Completion ledger for computed-update outbox tasks (lineage / latency
 * tracing). Successful tasks are hard-deleted from the outbox on markDone;
 * this table keeps a retention-bounded trail per completed task so admins can
 * reconstruct a run's stage chain and its source-change → converged latency.
 * Observability only — the worker never reads it.
 */
export interface V1ComputedUpdateRunHistoryTable {
  task_id: string;
  base_id: string;
  seed_table_id: string;
  change_type: string;
  run_id: string;
  origin_run_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  steps: unknown | null;
  edges: unknown | null;
  affected_table_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  affected_field_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  source_field_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  seed_record_count: ColumnType<number, number | undefined, number | undefined>;
  stage_depth: ColumnType<number, number | undefined, number | undefined>;
  predecessor_task_id: string | null;
  run_total_steps: ColumnType<number, number | undefined, number | undefined>;
  run_completed_steps_before: ColumnType<number, number | undefined, number | undefined>;
  sync_max_level: number | null;
  estimated_complexity: ColumnType<number, number | undefined, number | undefined>;
  attempts: ColumnType<number, number | undefined, number | undefined>;
  outcome: string;
  source_changed_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  enqueued_at: ColumnType<Date, Date, Date | undefined>;
  started_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  completed_at: ColumnType<Date, Date, Date | undefined>;
  duration_ms: ColumnType<number, number | undefined, number | undefined>;
}

export interface V1TaskTable {
  id: string;
  type: string;
  status: string;
  snapshot: string | null;
  created_time: ColumnType<Date, Date | undefined, never>;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_by: string;
  last_modified_by: string | null;
}

export interface V1TaskRunTable {
  id: string;
  task_id: string;
  base_id: string;
  status: string;
  snapshot: string;
  depends_on_run_ids: ColumnType<string[], string[] | undefined, string[] | undefined>;
  spent: number | null;
  log: string | null;
  error_msg: string | null;
  started_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_time: ColumnType<Date, Date | string | undefined, never>;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
}

export interface V1TaskReferenceTable {
  id: string;
  from_field_id: string;
  to_field_id: string;
  created_time: ColumnType<Date, Date | undefined, never>;
}

export interface V1ComputedFieldActivityTable {
  field_id: string;
  table_id: string;
  base_id: string;
  status: string;
  active_task_count: number;
  processing_task_count: number;
  generation: ColumnType<
    string | number | bigint,
    string | number | bigint,
    string | number | bigint
  >;
  estimated_complexity: ColumnType<
    string | number | bigint,
    string | number | bigint,
    string | number | bigint
  >;
  estimated_dirty_records: ColumnType<
    string | number | bigint,
    string | number | bigint,
    string | number | bigint
  >;
  has_all_target_records: boolean;
  queued_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  started_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  last_completed_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  last_duration_ms: number | null;
  last_error: unknown | null;
  extensions: unknown | null;
  updated_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

export interface V1ComputedTableActivityTable {
  table_id: string;
  base_id: string;
  status: string;
  calculating_field_count: number;
  queued_field_count: number;
  estimated_complexity: ColumnType<
    string | number | bigint,
    string | number | bigint,
    string | number | bigint
  >;
  recent_completions: unknown;
  generation: ColumnType<
    string | number | bigint,
    string | number | bigint,
    string | number | bigint
  >;
  updated_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

export interface V1ComputedTaskFieldRefTable {
  task_id: string;
  field_id: string;
  table_id: string;
  base_id: string;
  was_processing: boolean;
  created_at: ColumnType<Date, Date | undefined, Date | undefined>;
}

export interface V1SpaceDataDbBindingTable {
  id: string;
  space_id: string;
  data_db_connection_id: string | null;
  mode: string;
  state: string;
}

export interface V1TeableDatabase {
  users: V1UserTable;
  space: V1SpaceTable;
  base: V1BaseTable;
  space_data_db_binding: V1SpaceDataDbBindingTable;
  collaborator: V1CollaboratorTable;
  table_meta: V1TableMetaTable;
  field: V1FieldTable;
  view: V1ViewTable;
  plugin: V1PluginTable;
  plugin_install: V1PluginInstallTable;
  reference: V1ReferenceTable;
  schema_operation: V1SchemaOperationTable;
  computed_update_outbox: V1ComputedUpdateOutboxTable;
  computed_update_outbox_seed: V1ComputedUpdateOutboxSeedTable;
  computed_update_stage_ledger: V1ComputedUpdateStageLedgerTable;
  computed_update_dead_letter: V1ComputedUpdateDeadLetterTable;
  computed_update_run_history: V1ComputedUpdateRunHistoryTable;
  computed_field_activity: V1ComputedFieldActivityTable;
  computed_table_activity: V1ComputedTableActivityTable;
  computed_task_field_ref: V1ComputedTaskFieldRefTable;
  task: V1TaskTable;
  task_run: V1TaskRunTable;
  task_reference: V1TaskReferenceTable;
}
