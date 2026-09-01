import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { ViewCollaboratorField } from '../domain/table/methods/createViewCollaboratorsQueryPlan';
import type { RecordId } from '../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type {
  TableRecordAggregation,
  TableRecordAggregationFunction,
} from '../domain/table/records/TableRecordAggregation';
import type { TableRecordCalendarDailyCollection } from '../domain/table/records/TableRecordCalendarDailyCollection';
import type { Table } from '../domain/table/Table';
import type { RecordQuerySearch } from '../queries/RecordSearch';
import type { IExecutionContext } from './ExecutionContext';
import type { RecordQueryFieldMask } from './RecordQueryPlugin';
import type { TableRecordReadModel } from './TableRecordReadModel';
import type {
  ITableRecordStreamPagination,
  ITableRecordStreamPaginationStrategy,
} from './TableRecordStreamPaginationStrategy';

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

export interface IRecordReadQuerySource {
  readonly tableName: string;
  readonly cteName: string;
  readonly cteSql: string;
  readonly enabledFieldIds?: ReadonlyArray<string>;
}

export type IRecordSearchAccessPath =
  | { readonly kind: 'default' }
  | {
      /**
       * A same-table normalized text document used only to narrow substring candidates.
       * Repositories must recheck the original field predicates to preserve visible-row semantics.
       */
      readonly kind: 'generated_text';
      readonly generatedColumnName: string;
      readonly provider: 'pg_trgm' | 'pg_bigm';
      readonly searchScope: 'all_fields' | 'selected_fields';
      readonly coveredFieldIds: ReadonlyArray<FieldId>;
    }
  | {
      /** Explicit lexical search. This is not substring-compatible. */
      readonly kind: 'generated_tsvector';
      readonly generatedColumnName: string;
      readonly languageConfig: string;
      readonly searchScope: 'all_fields' | 'selected_fields';
      readonly coveredFieldIds: ReadonlyArray<FieldId>;
    };

export type RecordSearchAccessPathKind = 'default' | 'generated_text' | 'generated_tsvector';

export type RecordSearchAccessPathFallbackReason =
  | 'generated_text_unavailable'
  | 'generated_text_probe_too_short'
  | 'generated_tsvector_unavailable';

export interface IRecordSearchAccessPathResolution {
  readonly requested: RecordSearchAccessPathKind;
  readonly used: RecordSearchAccessPathKind;
  readonly fallbackReason?: RecordSearchAccessPathFallbackReason;
}
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
   * Optional explicit record-id order.
   * When provided, repository should preserve this order in SQL before pagination.
   */
  readonly recordIdsOrder?: ReadonlyArray<RecordId>;

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

  /**
   * Optional field projection for user fields.
   * When provided, repository should only read these field columns
   * (system columns needed by the read model may still be included).
   */
  readonly projectionFieldIds?: ReadonlyArray<FieldId>;

  /**
   * Optional v1-compatible search query used for visible-row semantics.
   * Repository applies the real search matching rules instead of approximating them
   * through record-filter operators.
   */
  readonly search?: RecordQuerySearch;

  /**
   * Optional search used only to compute per-field match metadata.
   * Unlike `search`, this never filters the returned rows.
   */
  readonly searchFieldMatchesSearch?: RecordQuerySearch;

  /**
   * Optional explicit search access path used by internal/admin validation flows.
   * Omitted or `default` keeps the existing v1-compatible ILIKE behavior.
   */
  readonly searchAccessPath?: IRecordSearchAccessPath;

  /**
   * Optional explicit read source used by permission-scoped record reads.
   */
  readonly recordReadQuerySource?: IRecordReadQuerySource;

  /**
   * Return the exact fields matching `searchFieldMatchesSearch ?? search` for
   * search-index projections.
   * View identity and visible fields must already have been resolved from the
   * Table aggregate by the application handler.
   */
  readonly includeSearchFieldMatches?: boolean;

  /**
   * `matched` numbers matching rows; `view` numbers the complete filtered/sorted View.
   */
  readonly searchIndexMode?: 'matched' | 'view';

  /**
   * Optional grouped count metadata computed from the same filter/search scope.
   * Field order is significant and defines the group hierarchy.
   */
  readonly groupBy?: ReadonlyArray<FieldOrderBy>;
  /**
   * Conditional field visibility masks (T6997). When present, the repository
   * evaluates ORDER BY, GROUP BY, and search over the masked value domain —
   * `CASE WHEN <visibleWhen> THEN <value> ELSE NULL END` — instead of the raw
   * column, so restricted cells behave as NULL without rejecting the query.
   * The cell payload itself is still masked post-read by the core handler.
   */
  readonly fieldMasks?: ReadonlyArray<RecordQueryFieldMask>;

  /** Maximum number of leaf group buckets returned by the repository. */
  readonly groupLimit?: number;

  /**
   * Return record ids only: the repository selects just the record id column
   * (filter/search/order/pagination semantics unchanged) and skips field
   * column reads and read-model cell mapping. Rows carry empty fields and no
   * versions. For id-resolution flows — selection materialization, delete
   * chunk loading — where per-row read models are pure overhead.
   */
  readonly idsOnly?: boolean;

  /**
   * Snapshot-style field-value reads: select `__id` plus the projected field
   * columns and skip system columns / default `__auto_number` sort. Undo/redo
   * field snapshots only need `{recordId, value}` pairs.
   */
  readonly valuesOnly?: boolean;
}

/**
 * Order by a user-defined field.
 */
export type FieldOrderBy = {
  readonly fieldId: FieldId;
  readonly direction: 'asc' | 'desc';
  /**
   * Collate this field the way its group buckets collate (set on entries
   * derived from a view's groupBy). Grouped lists and offset-addressed range
   * commands map group row blocks onto record pages positionally, so their
   * record order must match the bucket order exactly — for user fields that
   * is the {id, title} group identity, not the raw cell. Plain sorts omit
   * this and keep the v1 collation (ties follow view row order).
   */
  readonly groupIdentityCollation?: boolean;
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
   * Supports offset- or cursor-based pagination.
   */
  readonly pagination?: ITableRecordStreamPagination;

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

  /**
   * Optional field projection for user fields in stream mode.
   * Useful for snapshot/read-heavy paths that only need a subset of fields.
   */
  readonly projectionFieldIds?: ReadonlyArray<FieldId>;

  /**
   * Include per-view row-order values in streamed records.
   * Used by bulk row-order materialization to skip unchanged rows.
   */
  readonly includeOrders?: boolean;

  /**
   * Optional stream pagination strategy.
   * When omitted, repository uses its default strategy.
   */
  readonly paginationStrategy?: ITableRecordStreamPaginationStrategy;

  /**
   * Optional v1-compatible search query used for visible-row semantics.
   */
  readonly search?: RecordQuerySearch;

  /**
   * Optional explicit search access path used by internal/admin validation flows.
   */
  readonly searchAccessPath?: IRecordSearchAccessPath;

  /**
   * Optional explicit read source used by permission-scoped record reads.
   */
  readonly recordReadQuerySource?: IRecordReadQuerySource;
}

/** Result type for paginated record queries */
export interface ITableRecordQueryResult {
  /** The records for the current page */
  readonly records: ReadonlyArray<TableRecordReadModel>;
  /** Total count of records matching the query (for pagination) */
  readonly total: number;
  /** Actual search access path selected by the repository after SQL planning. */
  readonly searchAccessPath?: IRecordSearchAccessPathResolution;
  /** Exact per-field search hits, present only when explicitly requested. */
  readonly searchMatches?: ReadonlyArray<ITableRecordSearchMatch>;
  /** Ordered leaf group buckets for compatibility presentation layers. */
  readonly groups?: ReadonlyArray<ITableRecordGroup>;
}

export interface ITableRecordGroup {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly count: number;
}

export interface ITableRecordSearchMatch {
  readonly index: number;
  readonly fieldId: FieldId;
  readonly recordId: RecordId;
}

export type TableRecordAggregationValue = {
  readonly fieldId: FieldId;
  readonly statisticFunc: TableRecordAggregationFunction;
  readonly value: number | string | null;
  /**
   * Present for grouped values. The array contains the raw group values in the
   * same order as the aggregation's groupBy prefix.
   */
  readonly groupValues?: ReadonlyArray<unknown>;
};

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
    options?: Pick<ITableRecordQueryOptions, 'mode' | 'includeOrders' | 'recordReadQuerySource'>
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

export type ITableRecordCountOptions = Pick<
  ITableRecordQueryOptions,
  'mode' | 'search' | 'searchAccessPath' | 'recordReadQuerySource' | 'fieldMasks'
>;

/**
 * Count capability of the existing Table Record query repository.
 *
 * This shares the same repository implementation and DI token as record reads.
 * Count runs `count(*)` for the filtered/search scope and does not fetch rows.
 */
export interface ITableRecordCountQueryRepository extends ITableRecordQueryRepository {
  count(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordCountOptions
  ): Promise<Result<number, DomainError>>;
}

/**
 * Aggregate capability of the existing Table Record query repository.
 *
 * This deliberately shares the same repository implementation and DI token as
 * record reads. It is not a View repository or a second aggregate boundary.
 */
export interface ITableRecordAggregationQueryRepository extends ITableRecordQueryRepository {
  aggregate(
    context: IExecutionContext,
    table: Table,
    aggregation: TableRecordAggregation,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: {
      readonly maxGroupPoints?: number;
      readonly search?: RecordQuerySearch;
    }
  ): Promise<Result<ReadonlyArray<TableRecordAggregationValue>, DomainError>>;
}

export type TableRecordCalendarDailyCollectionEntry = {
  readonly date: string;
  readonly count: number;
  readonly recordIds: ReadonlyArray<RecordId>;
};

/**
 * Calendar read capability of the existing Table Record query repository.
 *
 * Calendar is a projection over records owned by a Table aggregate. It does not
 * introduce a View or Calendar repository boundary.
 */
export interface ITableRecordCalendarQueryRepository extends ITableRecordQueryRepository {
  calendarDailyCollection(
    context: IExecutionContext,
    table: Table,
    calendar: TableRecordCalendarDailyCollection,
    range: {
      readonly startDate: string;
      readonly endDate: string;
    },
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: {
      readonly search?: RecordQuerySearch;
    }
  ): Promise<Result<ReadonlyArray<TableRecordCalendarDailyCollectionEntry>, DomainError>>;
}

/**
 * Collaborator lookup capability of the existing Table Record query repository.
 *
 * User-related values remain record data owned by Table. This is intentionally not a
 * View, Field, or collaborator repository.
 */
export interface ITableRecordCollaboratorQueryRepository extends ITableRecordQueryRepository {
  findDistinctUserIds(
    context: IExecutionContext,
    table: Table,
    field: ViewCollaboratorField,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<ReadonlyArray<string>, DomainError>>;
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
