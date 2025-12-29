import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { RecordId } from '../../domain/table/records/RecordId';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type { ITableRecordRepository } from '../TableRecordRepository';

export class NoopTableRecordRepository implements ITableRecordRepository {
  async insert(_: IExecutionContext, __: Table, ___: TableRecord): Promise<Result<void, string>> {
    return ok(undefined);
  }

  async update(_: IExecutionContext, __: Table, ___: TableRecord): Promise<Result<void, string>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table, ___: RecordId): Promise<Result<void, string>> {
    return ok(undefined);
  }
}
