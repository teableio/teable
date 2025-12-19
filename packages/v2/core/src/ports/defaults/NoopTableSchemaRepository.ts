/* eslint-disable @typescript-eslint/naming-convention */
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type { ITableSchemaRepository } from '../TableSchemaRepository';

export class NoopTableSchemaRepository implements ITableSchemaRepository {
  async save(_: IExecutionContext, __: Table): Promise<Result<void, string>> {
    return ok(undefined);
  }
}
