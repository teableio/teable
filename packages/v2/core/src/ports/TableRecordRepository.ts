import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { RecordId } from '../domain/table/records/RecordId';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

export interface ITableRecordRepository {
  insert(
    context: IExecutionContext,
    table: Table,
    record: TableRecord
  ): Promise<Result<void, DomainError>>;
  update(
    context: IExecutionContext,
    table: Table,
    record: TableRecord
  ): Promise<Result<void, DomainError>>;
  delete(
    context: IExecutionContext,
    table: Table,
    recordId: RecordId
  ): Promise<Result<void, DomainError>>;
}
