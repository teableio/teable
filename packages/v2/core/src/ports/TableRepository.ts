import type { Result } from 'neverthrow';

import type { IExecutionContext } from './ExecutionContext';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Table } from '../domain/table/Table';

export interface ITableRepository {
  save(context: IExecutionContext, table: Table): Promise<Result<void, string>>;
  findOne(context: IExecutionContext, spec: ISpecification<Table>): Promise<Result<Table, string>>;
}
