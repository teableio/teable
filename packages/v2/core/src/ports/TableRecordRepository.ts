import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordInsertOrder } from '../domain/table/records/RecordInsertOrder';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

export interface RecordStoredSnapshot {
  /** Stringified record id from storage. */
  recordId: string;
  /** Stored field payload keyed by field id. */
  fields: Readonly<Record<string, unknown>>;
  /** Stored version captured from __version when available. */
  version?: number;
  /** Preserve per-view row-order snapshot when available. */
  orders?: Readonly<Record<string, number>>;
  autoNumber?: number;
  createdTime?: string;
  createdBy?: string;
  lastModifiedTime?: string;
  lastModifiedBy?: string;
}

export interface RecordUpdateSnapshot {
  /** Stored row image captured before the update statement. */
  previous: RecordStoredSnapshot;
  /** Stored row image captured after the update mutation finishes. */
  current: RecordStoredSnapshot;
  oldVersion: number;
  newVersion: number;
}

/**
 * Result of single record mutation operations (insert/update).
 * Contains computed field values that were updated as part of the operation.
 */
export interface RecordMutationResult {
  /**
   * Whether the repository actually persisted a storage mutation.
   *
   * `false` is distinct from a missing snapshot: it means the requested mutation
   * was skipped because storage already matched the desired state.
   */
  mutationApplied?: boolean;

  /**
   * Final stored values for fields changed by this operation.
   * Map of fieldId -> persisted newValue.
   */
  changedFields?: ReadonlyMap<string, unknown>;

  /**
   * Computed field values that were updated during this operation.
   * Map of fieldId -> newValue.
   * Undefined if no computed fields were updated or if computed updates
   * are processed asynchronously.
   */
  computedChanges?: ReadonlyMap<string, unknown>;

  /**
   * Stored snapshot for insert/restore-style mutations after persistence completes.
   */
  recordSnapshot?: RecordStoredSnapshot;

  /**
   * Stored snapshot captured before an update statement is applied.
   */
  updateSnapshot?: RecordUpdateSnapshot;
}

/**
 * Result of batch record mutation operations (insertMany).
 * Contains computed field values for each record that was updated.
 */
export interface BatchRecordMutationResult {
  /**
   * Map of recordId -> changed field values persisted for that record.
   * Each entry contains fieldId -> newValue mappings for fields changed by the operation.
   */
  changedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>;

  /**
   * Map of recordId -> computed field changes.
   * Each entry contains fieldId -> newValue mappings for that record.
   * Records without computed changes may be omitted.
   */
  computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>;

  /**
   * Map of recordId -> view order values.
   * Each entry contains viewId -> order mappings for that record.
   * Used for undo/redo operations to restore record positions.
   */
  recordOrders?: ReadonlyMap<string, Record<string, number>>;

  /**
   * Stored snapshots for records after persistence completes.
   */
  recordSnapshots?: ReadonlyArray<RecordStoredSnapshot>;
}

/**
 * Progress information for streaming insert operations.
 */
export interface InsertManyStreamProgress {
  /** Current batch index (0-based) */
  batchIndex: number;
  /** Number of records inserted in this batch */
  insertedCount: number;
  /** Total number of records inserted so far */
  totalInserted: number;
  /** Record orders from this batch (recordId -> viewId -> order) */
  recordOrders?: ReadonlyMap<string, Record<string, number>>;
}

/**
 * Options for streaming insert operations.
 */
export interface InsertManyStreamOptions {
  /**
   * Callback invoked after the corresponding yielded batch is persisted.
   * `batchIndex` follows the source iterable emission order so callers can
   * safely align per-batch metadata with callback invocations.
   */
  onBatchInserted?: (progress: InsertManyStreamProgress) => void;
  /**
   * When true, computed field updates are deferred to a background worker
   * instead of being processed inline after each batch.
   * This significantly improves performance for bulk imports by:
   * 1. Avoiding N computed update cycles (one per batch)
   * 2. Allowing computed updates to run after the HTTP response is sent
   *
   * Default: false (computed updates run inline after each batch)
   */
  deferComputedUpdates?: boolean;

  /**
   * When true with `deferComputedUpdates`, deferred computed work is enqueued
   * into the computed outbox in the same transaction instead of being started
   * as a legacy async compute call.
   */
  enqueueDeferredComputedUpdates?: boolean;

  /**
   * When true, computed field updates are skipped entirely for this stream.
   * Callers that restore raw data can run a separate full backfill after all
   * related tables and junction rows are present.
   */
  skipComputedUpdates?: boolean;
}

/**
 * Result of streaming insert operations.
 */
export interface InsertManyStreamResult {
  /** Total number of records inserted */
  totalInserted: number;
}

export interface InsertManyStreamBatch {
  /** Optional table snapshot for this batch when field metadata changed mid-stream. */
  table?: Table;
  /** Records to insert for this batch. */
  records: ReadonlyArray<TableRecord>;
  /** Optional system/raw column restore values for records in this batch. */
  restoreRecordsById?: ReadonlyMap<string, RecordRestoreSystemValues>;
}

export type InsertManyStreamBatchInput = ReadonlyArray<TableRecord> | InsertManyStreamBatch;

export const isInsertManyStreamBatch = (
  batch: InsertManyStreamBatchInput
): batch is InsertManyStreamBatch =>
  typeof batch === 'object' && batch != null && 'records' in batch;

/**
 * Result of bulk update operations driven by a filter specification.
 */
export interface UpdateManyResult {
  /** Total number of records updated */
  totalUpdated: number;
  /** IDs of records updated by the statement */
  updatedRecordIds: ReadonlyArray<RecordId>;
  /** Per-record snapshot captured directly by the bulk update statement. */
  updatedRecords: ReadonlyArray<{
    recordId: RecordId;
    oldVersion: number;
    newVersion: number;
    oldFieldValues: Readonly<Record<string, unknown>>;
  }>;
}

/**
 * Progress information for streaming update operations.
 */
export interface UpdateManyStreamProgress {
  /** Current batch index (0-based) */
  batchIndex: number;
  /** Number of records updated in this batch */
  updatedCount: number;
  /** Total number of records updated so far */
  totalUpdated: number;
}

/**
 * Options for streaming update operations.
 */
export interface UpdateManyStreamOptions {
  /** Callback invoked after each batch is updated */
  onBatchUpdated?: (progress: UpdateManyStreamProgress) => void;

  /**
   * When true, computed field updates are deferred to a background worker
   * instead of being processed inline after the streamed update batches.
   */
  deferComputedUpdates?: boolean;

  /**
   * When true with `deferComputedUpdates`, deferred computed work is enqueued
   * into the computed outbox in the same transaction.
   */
  enqueueDeferredComputedUpdates?: boolean;

  /**
   * When true, computed field updates are skipped entirely for this stream.
   */
  skipComputedUpdates?: boolean;

  /**
   * When true, generate SQL to fill missing link titles by JOINing
   * the foreign table's primary field.
   */
  fillLinkTitles?: boolean;

  /**
   * Foreign tables referenced by missing-title link payloads.
   */
  fillLinkTitleForeignTables?: ReadonlyMap<string, Table>;
}

/**
 * Result of streaming update operations.
 */
export interface UpdateManyStreamResult {
  /** Total number of records updated */
  totalUpdated: number;
  /** Main statement before/after snapshots captured for each row actually updated by SQL. */
  updatedRecords: ReadonlyArray<{
    recordId: RecordId;
    oldVersion: number;
    newVersion: number;
    oldFieldValues: Readonly<Record<string, unknown>>;
  }>;
}

export interface DeleteManyStreamProgress {
  /** Current batch index (0-based) */
  batchIndex: number;
  /** Number of records deleted in this batch */
  deletedCount: number;
  /** Total number of records deleted so far */
  totalDeleted: number;
}

export interface DeleteManyStreamOptions {
  /** Callback invoked after each batch is deleted */
  onBatchDeleted?: (progress: DeleteManyStreamProgress) => void;
}

export interface DeleteManyStreamResult {
  /** Total number of records deleted */
  totalDeleted: number;
}

export interface DeleteManyResult {
  /** Stored snapshots captured before deletion. */
  deletedRecords?: ReadonlyArray<RecordStoredSnapshot>;
}

export const hasDeletedRecordSnapshots = (
  result: DeleteManyResult
): result is DeleteManyResult & { deletedRecords: ReadonlyArray<RecordStoredSnapshot> } =>
  typeof result === 'object' &&
  result != null &&
  Array.isArray((result as { deletedRecords?: unknown }).deletedRecords);

export interface UpdateManyStreamBatch {
  /** Optional table snapshot for this batch when field metadata changed mid-stream. */
  table?: Table;
  /** Resolved record updates to persist for this batch. */
  updates: ReadonlyArray<RecordUpdateResult>;
}

export type UpdateManyStreamBatchInput = ReadonlyArray<RecordUpdateResult> | UpdateManyStreamBatch;

export const isUpdateManyStreamBatch = (
  batch: UpdateManyStreamBatchInput
): batch is UpdateManyStreamBatch =>
  typeof batch === 'object' && batch != null && 'updates' in batch;

export interface RecordRestoreSystemValues {
  /** Preserve legacy record identity fields during undo/redo restore. */
  version?: number;
  autoNumber?: number;
  createdTime?: string;
  createdBy?: string;
  lastModifiedTime?: string;
  lastModifiedBy?: string;
  /** Preserve per-view row-order snapshot during undo/redo restore. */
  orders?: Readonly<Record<string, number>>;
  /**
   * Preserve raw storage columns during bulk restore/import.
   * Used by `.tea` imports for db-field columns and relation/order helper columns
   * that are not represented as editable domain field values.
   */
  extraColumnValues?: Readonly<Record<string, unknown>>;
}

/**
 * Options for insert operations.
 */
export interface InsertOptions {
  /**
   * Optional ordering specification for the inserted record(s).
   * When provided, records will be positioned relative to an anchor record
   * in the specified view, rather than appending to the end.
   */
  order?: RecordInsertOrder;

  /**
   * Optional system column overrides used by undo/redo restore.
   * Keys are stringified record ids.
   */
  restoreRecordsById?: ReadonlyMap<string, RecordRestoreSystemValues>;

  /**
   * Optional record ids whose table trash metadata should be removed within
   * the same transaction after the records are restored.
   */
  cleanupTrashRecordIds?: ReadonlyArray<string>;

  /**
   * When true, generate SQL to fill missing link titles by JOINing
   * the foreign table's primary field. Used in typecast mode when
   * API clients provide link IDs without titles.
   */
  fillLinkTitles?: boolean;

  /**
   * Foreign tables referenced by missing-title link payloads.
   * Repository adapters use the real foreign db_table_name/db_field_name
   * instead of assuming physical names match table ids.
   */
  fillLinkTitleForeignTables?: ReadonlyMap<string, Table>;
}

export interface UpdateOptions {
  /**
   * When true, computed field updates are deferred to a background worker
   * instead of being processed inline after the update statement.
   */
  deferComputedUpdates?: boolean;

  /**
   * When true with `deferComputedUpdates`, deferred computed work is enqueued
   * into the computed outbox in the same transaction.
   */
  enqueueDeferredComputedUpdates?: boolean;

  /**
   * When true, computed field updates are skipped entirely for this update.
   */
  skipComputedUpdates?: boolean;

  /**
   * When true, generate SQL to fill missing link titles by JOINing
   * the foreign table's primary field.
   */
  fillLinkTitles?: boolean;

  /**
   * Foreign tables referenced by missing-title link payloads.
   */
  fillLinkTitleForeignTables?: ReadonlyMap<string, Table>;
}

export interface ITableRecordRepository {
  insert(
    context: IExecutionContext,
    table: Table,
    record: TableRecord,
    options?: InsertOptions
  ): Promise<Result<RecordMutationResult, DomainError>>;
  insertMany(
    context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>,
    options?: InsertOptions
  ): Promise<Result<BatchRecordMutationResult, DomainError>>;

  /**
   * Insert records from a streaming/batched source.
   *
   * This method is memory-friendly for large record sets:
   * - Consumes batches from the iterable one at a time
   * - Only keeps one batch in memory during processing
   * - Reports progress via optional callback
   * - Supports both sync and async iterables (for URL/stream sources)
   *
   * @param context - Execution context (may contain transaction)
   * @param table - Target table
   * @param batches - Iterable or AsyncIterable of record batches to insert
   * @param options - Optional configuration including progress callback
   * @returns Result with total inserted count or error
   */
  insertManyStream(
    context: IExecutionContext,
    table: Table,
    batches: Iterable<InsertManyStreamBatchInput> | AsyncIterable<InsertManyStreamBatchInput>,
    options?: InsertManyStreamOptions
  ): Promise<Result<InsertManyStreamResult, DomainError>>;

  /**
   * Update a single record using a mutation specification.
   *
   * The mutation spec describes what changes to apply to the record.
   * Repository adapters convert the spec into optimized SQL statements
   * (e.g., atomic increments, junction table updates for links).
   *
   * @param context - Execution context (may contain transaction)
   * @param table - Target table
   * @param recordId - ID of the record to update
   * @param mutateSpec - Specification describing the mutations to apply
   * @returns Result with computed changes or error
   */
  updateOne(
    context: IExecutionContext,
    table: Table,
    recordId: RecordId,
    mutateSpec: ICellValueSpec,
    options?: UpdateOptions
  ): Promise<Result<RecordMutationResult, DomainError>>;

  /**
   * Update multiple records matching a filter specification using a single mutate spec.
   *
   * Repository adapters are expected to translate this into an efficient
   * `UPDATE ... SET ... WHERE ... RETURNING __id` statement when possible.
   *
   * @param context - Execution context (may contain transaction)
   * @param table - Target table
   * @param spec - Filter specification describing which records to update
   * @param mutateSpec - Specification describing the mutations to apply
   * @returns Result with updated count and updated record ids or error
   */
  updateMany(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    mutateSpec: ICellValueSpec,
    options?: UpdateOptions
  ): Promise<Result<UpdateManyResult, DomainError>>;

  /**
   * Update multiple records from a streaming/batched source.
   *
   * This method is memory-friendly for bulk updates:
   * - Consumes batches of RecordUpdateResult from the generator
   * - Uses batch SQL (UPDATE ... FROM VALUES) for efficiency
   * - Only keeps one batch in memory during processing
   * - Reports progress via optional callback
   * - Triggers computed field updates after all batches complete
   *
   * @param context - Execution context (may contain transaction)
   * @param table - Target table
   * @param batches - Generator yielding batches of RecordUpdateResult (from Table.updateRecordsStream)
   * @param options - Optional configuration including progress callback
   * @returns Result with total updated count or error
   */
  updateManyStream(
    context: IExecutionContext,
    table: Table,
    batches:
      | Iterable<Result<UpdateManyStreamBatchInput, DomainError>>
      | AsyncIterable<Result<UpdateManyStreamBatchInput, DomainError>>,
    options?: UpdateManyStreamOptions
  ): Promise<Result<UpdateManyStreamResult, DomainError>>;

  deleteMany(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<DeleteManyResult, DomainError>>;

  deleteManyStream(
    context: IExecutionContext,
    table: Table,
    recordIdBatches: Iterable<ReadonlyArray<RecordId>> | AsyncIterable<ReadonlyArray<RecordId>>,
    options?: DeleteManyStreamOptions
  ): Promise<Result<DeleteManyStreamResult, DomainError>>;
}
