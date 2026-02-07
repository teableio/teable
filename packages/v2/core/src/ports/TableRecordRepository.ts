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

/**
 * Result of single record mutation operations (insert/update).
 * Contains computed field values that were updated as part of the operation.
 */
export interface RecordMutationResult {
  /**
   * Computed field values that were updated during this operation.
   * Map of fieldId -> newValue.
   * Undefined if no computed fields were updated or if computed updates
   * are processed asynchronously.
   */
  computedChanges?: ReadonlyMap<string, unknown>;
}

/**
 * Result of batch record mutation operations (insertMany).
 * Contains computed field values for each record that was updated.
 */
export interface BatchRecordMutationResult {
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
  /** Callback invoked after each batch is inserted */
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
}

/**
 * Result of streaming insert operations.
 */
export interface InsertManyStreamResult {
  /** Total number of records inserted */
  totalInserted: number;
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
}

/**
 * Result of streaming update operations.
 */
export interface UpdateManyStreamResult {
  /** Total number of records updated */
  totalUpdated: number;
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
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
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
    mutateSpec: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>>;

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
    batches: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>,
    options?: UpdateManyStreamOptions
  ): Promise<Result<UpdateManyStreamResult, DomainError>>;

  deleteMany(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>>;
}
