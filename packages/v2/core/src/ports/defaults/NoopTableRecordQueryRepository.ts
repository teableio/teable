import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type { ITableRecordQueryRepository } from '../TableRecordQueryRepository';

export class NoopTableRecordQueryRepository implements ITableRecordQueryRepository {
  async find(_: IExecutionContext, __: Table): Promise<Result<ReadonlyArray<TableRecord>, string>> {
    return ok([]);
  }
}
