import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
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
}

export interface ITableRecordQueryRepository {
  find(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>>;
}
