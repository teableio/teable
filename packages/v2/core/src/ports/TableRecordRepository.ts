import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { RecordId } from '../domain/table/records/RecordId';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

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
}

/**
 * Options for streaming insert operations.
 */
export interface InsertManyStreamOptions {
  /** Callback invoked after each batch is inserted */
  onBatchInserted?: (progress: InsertManyStreamProgress) => void;
}

/**
 * Result of streaming insert operations.
 */
export interface InsertManyStreamResult {
  /** Total number of records inserted */
  totalInserted: number;
}

export interface ITableRecordRepository {
  insert(
    context: IExecutionContext,
    table: Table,
    record: TableRecord
  ): Promise<Result<void, DomainError>>;
  insertMany(
    context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>
  ): Promise<Result<void, DomainError>>;

  /**
   * Insert records from a streaming/batched source.
   *
   * This method is memory-friendly for large record sets:
   * - Consumes batches from the iterable one at a time
   * - Only keeps one batch in memory during processing
   * - Reports progress via optional callback
   *
   * @param context - Execution context (may contain transaction)
   * @param table - Target table
   * @param batches - Iterable of record batches to insert
   * @param options - Optional configuration including progress callback
   * @returns Result with total inserted count or error
   */
  insertManyStream(
    context: IExecutionContext,
    table: Table,
    batches: Iterable<ReadonlyArray<TableRecord>>,
    options?: InsertManyStreamOptions
  ): Promise<Result<InsertManyStreamResult, DomainError>>;

  update(
    context: IExecutionContext,
    table: Table,
    record: TableRecord
  ): Promise<Result<void, DomainError>>;
  delete(
    context: IExecutionContext,
    table: Table,
    recordId: RecordId
  ): Promise<Result<void, DomainError>>;
}
