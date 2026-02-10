import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
  ITableRecordQueryStreamOptions,
} from '../TableRecordQueryRepository';
import type { TableRecordReadModel } from '../TableRecordReadModel';

export class NoopTableRecordQueryRepository implements ITableRecordQueryRepository {
  async find(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    return ok({ records: [], total: 0 });
  }

  async findOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _options?: Pick<ITableRecordQueryOptions, 'mode'>
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    return err(domainError.notFound({ code: 'record.not_found', message: 'Record not found' }));
  }

  async *findStream(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    // Noop implementation: yields nothing
  }
}
