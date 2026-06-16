import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';
import type { TableDeleteOptions } from './TableRepository';

export type TableSchemaInsertManyOptions = {
  knownTables?: ReadonlyArray<Table>;
  /**
   * The caller is creating brand-new empty physical tables and will load records afterwards.
   * Adapters may skip data repair/backfill SQL that is only needed for existing rows.
   */
  optimizeForEmptyTables?: boolean;
  /**
   * The caller will perform system/restore writes that do not need undo snapshots while loading.
   * Adapters may defer undo-capture trigger setup until the first normal record mutation.
   */
  skipUndoCaptureSetup?: boolean;
};

export interface ITableSchemaRepository {
  insert(context: IExecutionContext, table: Table): Promise<Result<void, DomainError>>;
  ensureInserted?(context: IExecutionContext, table: Table): Promise<Result<void, DomainError>>;
  insertMany(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    options?: TableSchemaInsertManyOptions
  ): Promise<Result<void, DomainError>>;
  ensureInsertedMany?(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>>;
  update(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>>;
  delete(
    context: IExecutionContext,
    table: Table,
    options?: TableDeleteOptions
  ): Promise<Result<void, DomainError>>;
}
