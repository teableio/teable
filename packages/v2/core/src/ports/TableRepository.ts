import type { Result } from 'neverthrow';

import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IExecutionContext } from './ExecutionContext';
import type { IFindOptions } from './RepositoryQuery';

export interface ITableRepository {
  insert(context: IExecutionContext, table: Table): Promise<Result<Table, string>>;
  findOne(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, string>>;
  find(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, string>>;
  // table identifies the row, mutateSpec drives update values via visitors.
  updateOne(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, string>>;
  delete(context: IExecutionContext, table: Table): Promise<Result<void, string>>;
}
