import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { RecordId } from '../../domain/table/records/RecordId';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type {
  ITableRecordRepository,
  InsertManyStreamOptions,
  InsertManyStreamResult,
} from '../TableRecordRepository';

export class NoopTableRecordRepository implements ITableRecordRepository {
  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    __: Table,
    ___: ReadonlyArray<TableRecord>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertManyStream(
    _context: IExecutionContext,
    _table: Table,
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    options?: InsertManyStreamOptions
  ): Promise<Result<InsertManyStreamResult, DomainError>> {
    let totalInserted = 0;
    let batchIndex = 0;

    // Handle both sync and async iterables
    if (Symbol.asyncIterator in batches) {
      for await (const batch of batches as AsyncIterable<ReadonlyArray<TableRecord>>) {
        totalInserted += batch.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
        batchIndex++;
      }
    } else {
      for (const batch of batches as Iterable<ReadonlyArray<TableRecord>>) {
        totalInserted += batch.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
        batchIndex++;
      }
    }

    return ok({ totalInserted });
  }

  async update(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table, ___: RecordId): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}
