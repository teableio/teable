import type { Result } from 'neverthrow';

import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

export interface ITableRecordQueryRepository {
  find(
    context: IExecutionContext,
    table: Table
  ): Promise<Result<ReadonlyArray<TableRecord>, string>>;
}
