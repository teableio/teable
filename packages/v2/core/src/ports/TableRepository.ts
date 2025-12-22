import type { Result } from 'neverthrow';

import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Table } from '../domain/table/Table';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IExecutionContext } from './ExecutionContext';
import type { IFindOptions } from './RepositoryQuery';

export interface ITableRepository {
  insert(context: IExecutionContext, table: Table): Promise<Result<Table, string>>;
  findOne(context: IExecutionContext, spec: ISpecification<Table>): Promise<Result<Table, string>>;
  find(
    context: IExecutionContext,
    spec: ISpecification<Table>,
    options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, string>>;
}
