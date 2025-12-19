import type { Result } from 'neverthrow';

import type { IExecutionContext } from './ExecutionContext';
import type { Table } from '../domain/table/Table';

export interface ITableSchemaRepository {
  save(context: IExecutionContext, table: Table): Promise<Result<void, string>>;
}
