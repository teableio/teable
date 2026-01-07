import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IExecutionContext } from './ExecutionContext';
import type { IFindOptions } from './RepositoryQuery';

export interface ITableRepository {
  insert(context: IExecutionContext, table: Table): Promise<Result<Table, DomainError>>;
  insertMany(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>>;
  findOne(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>>;
  find(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>>;
  // table identifies the row, mutateSpec drives update values via visitors.
  updateOne(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>>;
  delete(context: IExecutionContext, table: Table): Promise<Result<void, DomainError>>;
}
