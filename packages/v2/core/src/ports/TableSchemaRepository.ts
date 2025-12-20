import type { Result } from 'neverthrow';

import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

export interface ITableSchemaRepository {
  save(context: IExecutionContext, table: Table): Promise<Result<void, string>>;
}
