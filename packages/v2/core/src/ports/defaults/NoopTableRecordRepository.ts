import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { RecordId } from '../../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  InsertManyStreamOptions,
  InsertManyStreamResult,
  RecordMutationResult,
  UpdateManyStreamOptions,
  UpdateManyStreamResult,
} from '../TableRecordRepository';

export class NoopTableRecordRepository implements ITableRecordRepository {
  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _: IExecutionContext,
    __: Table,
    ___: ReadonlyArray<TableRecord>
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({});
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

  async updateOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _mutateSpec: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateManyStream(
    _context: IExecutionContext,
    _table: Table,
    batches: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>,
    options?: UpdateManyStreamOptions
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    let totalUpdated = 0;
    let batchIndex = 0;

    for (const batchResult of batches) {
      if (batchResult.isErr()) {
        // In noop, we still count but ignore errors
        continue;
      }
      const batch = batchResult.value;
      totalUpdated += batch.length;
      options?.onBatchUpdated?.({ batchIndex, updatedCount: batch.length, totalUpdated });
      batchIndex++;
    }

    return ok({ totalUpdated });
  }

  async deleteMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}
