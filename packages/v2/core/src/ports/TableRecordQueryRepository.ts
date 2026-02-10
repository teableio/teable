import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { RecordId } from '../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';
import type { TableRecordReadModel } from './TableRecordReadModel';

/** Query mode determines how computed fields are resolved */
export type TableRecordQueryMode = 'computed' | 'stored';

/**
 * System columns that can be used for ordering.
 * Includes built-in columns and view-specific row order columns.
 */
export type SystemOrderColumn =
  | '__auto_number'
  | '__created_time'
  | '__last_modified_time'
  | `__row_${string}`;

export interface ITableRecordQueryOptions {
  /**
   * Query mode:
   * - 'computed': Dynamically compute link/lookup/rollup via LATERAL joins (default)
   * - 'stored': Read pre-stored values directly from columns
   */
  readonly mode?: TableRecordQueryMode;

  /**
   * Pagination options (offset-based).
   */
  readonly pagination?: OffsetPagination;

  /**
   * Sort records by fields or system columns. Supports multiple sort criteria.
   * Can use either `fieldId` for user-defined fields or `column` for system columns.
   */
  readonly orderBy?: ReadonlyArray<TableRecordOrderBy>;

  /**
   * Include view order values in the result.
   * When true, the `orders` field in TableRecordReadModel will be populated
   * with the order values for each view (viewId -> order number).
   * Used for undo/redo support to restore record positions after deletion.
   */
  readonly includeOrders?: boolean;

  /**
   * Whether to compute total count (`count(*)`) for the full filtered dataset.
   * Defaults to true.
   * When false, repository may skip the count query and return `records.length` as `total`.
   * Useful for streaming/chunked read paths that don't need total rows.
   */
  readonly includeTotal?: boolean;
}

/**
 * Order by a user-defined field.
 */
export type FieldOrderBy = {
  readonly fieldId: FieldId;
  readonly direction: 'asc' | 'desc';
};

/**
 * Order by a system column (e.g., __auto_number, __created_time, __row_{viewId}).
 */
export type SystemColumnOrderBy = {
  readonly column: SystemOrderColumn;
  readonly direction: 'asc' | 'desc';
};

/**
 * Union type for ordering by either a field or a system column.
 */
export type TableRecordOrderBy = FieldOrderBy | SystemColumnOrderBy;

/** Options for streaming record queries */
export interface ITableRecordQueryStreamOptions {
  /**
   * Query mode:
   * - 'computed': Dynamically compute link/lookup/rollup via LATERAL joins (default)
   * - 'stored': Read pre-stored values directly from columns
   */
  readonly mode?: TableRecordQueryMode;

  /**
   * Pagination range for streaming.
   * - offset: Starting row index
   * - limit: Maximum number of records to stream
   */
  readonly pagination?: {
    readonly offset: number;
    readonly limit: number;
  };

  /**
   * Sort records by fields or system columns.
   * This is critical for operations like paste that need to match view row order.
   */
  readonly orderBy?: ReadonlyArray<TableRecordOrderBy>;

  /**
   * Internal batch size for chunked queries.
   * Records are fetched in batches of this size to optimize memory usage.
   * @default 500
   */
  readonly batchSize?: number;
}

/** Result type for paginated record queries */
export interface ITableRecordQueryResult {
  /** The records for the current page */
  readonly records: ReadonlyArray<TableRecordReadModel>;
  /** Total count of records matching the query (for pagination) */
  readonly total: number;
}

export interface ITableRecordQueryRepository {
  /**
   * Find records matching the specification with pagination support.
   *
   * @param context - Execution context
   * @param table - The table to query
   * @param spec - Optional filter specification
   * @param options - Query options including mode and pagination
   * @returns Paginated result with records and total count
   */
  find(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>>;

  /**
   * Find a single record by its ID.
   *
   * @param context - Execution context
   * @param table - The table to query
   * @param recordId - The record ID to find
   * @param options - Query options including mode
   * @returns The record if found, or a not_found error
   */
  findOne(
    context: IExecutionContext,
    table: Table,
    recordId: RecordId,
    options?: Pick<ITableRecordQueryOptions, 'mode'>
  ): Promise<Result<TableRecordReadModel, DomainError>>;

  /**
   * Stream records matching the specification.
   *
   * This method is memory-efficient for large result sets:
   * - Fetches records in batches internally
   * - Yields records one at a time via AsyncIterable
   * - Maintains consistent ordering across batches
   *
   * @param context - Execution context
   * @param table - The table to query
   * @param spec - Optional filter specification
   * @param options - Query options including mode, pagination range, and batch size
   * @returns AsyncIterable yielding records one by one
   */
  findStream(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>>;
}

/**
 * Type guard to check if an orderBy is a field-based order.
 */
export const isFieldOrderBy = (orderBy: TableRecordOrderBy): orderBy is FieldOrderBy => {
  return 'fieldId' in orderBy;
};

/**
 * Type guard to check if an orderBy is a system column order.
 */
export const isSystemColumnOrderBy = (
  orderBy: TableRecordOrderBy
): orderBy is SystemColumnOrderBy => {
  return 'column' in orderBy;
};
