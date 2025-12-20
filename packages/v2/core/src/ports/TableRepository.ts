import type { Result } from 'neverthrow';

import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

export interface ITableRepository {
  insert(context: IExecutionContext, table: Table): Promise<Result<Table, string>>;
  findOne(context: IExecutionContext, spec: ISpecification<Table>): Promise<Result<Table, string>>;
}
