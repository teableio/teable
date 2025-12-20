import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type { ITableRepository } from '../TableRepository';

export class NoopTableRepository implements ITableRepository {
  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, string>> {
    return ok(table);
  }

  async findOne(_: IExecutionContext, __: ISpecification<Table>): Promise<Result<Table, string>> {
    return err('Not found');
  }
}
