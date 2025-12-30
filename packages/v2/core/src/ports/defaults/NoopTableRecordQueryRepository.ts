import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type { ITableRecordQueryRepository } from '../TableRecordQueryRepository';
import type { TableRecordReadModel } from '../TableRecordReadModel';

export class NoopTableRecordQueryRepository implements ITableRecordQueryRepository {
  async find(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, string>> {
    return ok([]);
  }
}
