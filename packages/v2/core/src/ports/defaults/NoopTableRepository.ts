import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import type { IExecutionContext } from '../ExecutionContext';
import type { IFindOptions } from '../RepositoryQuery';
import type { ITableRepository } from '../TableRepository';

export class NoopTableRepository implements ITableRepository {
  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, string>> {
    return ok(table);
  }

  async findOne(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, string>> {
    return err('Not found');
  }

  async find(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, string>> {
    return ok([]);
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, string>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, string>> {
    return ok(undefined);
  }
}
