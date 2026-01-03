import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';
import type { TableRecordReadModel } from './TableRecordReadModel';

/** Query mode determines how computed fields are resolved */
export type TableRecordQueryMode = 'computed' | 'stored';

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
}
