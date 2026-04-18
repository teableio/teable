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
  DeleteManyResult,
  DeleteManyStreamOptions,
  DeleteManyStreamResult,
  ITableRecordRepository,
  InsertManyStreamBatchInput,
  InsertManyStreamOptions,
  InsertManyStreamResult,
  InsertOptions,
  RecordMutationResult,
  UpdateManyResult,
  UpdateManyStreamBatchInput,
  UpdateManyStreamOptions,
  UpdateManyStreamResult,
} from '../TableRecordRepository';
import { isInsertManyStreamBatch, isUpdateManyStreamBatch } from '../TableRecordRepository';

export class NoopTableRecordRepository implements ITableRecordRepository {
  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord,
    ____?: InsertOptions
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _: IExecutionContext,
    __: Table,
    ___: ReadonlyArray<TableRecord>,
    ____?: InsertOptions
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertManyStream(
    _context: IExecutionContext,
    _table: Table,
    batches: Iterable<InsertManyStreamBatchInput> | AsyncIterable<InsertManyStreamBatchInput>,
    options?: InsertManyStreamOptions
  ): Promise<Result<InsertManyStreamResult, DomainError>> {
    let totalInserted = 0;
    let batchIndex = 0;
    const normalizeBatch = (batch: InsertManyStreamBatchInput): ReadonlyArray<TableRecord> =>
      isInsertManyStreamBatch(batch) ? batch.records : batch;

    // Handle both sync and async iterables
    if (Symbol.asyncIterator in batches) {
      for await (const batch of batches as AsyncIterable<InsertManyStreamBatchInput>) {
        const records = normalizeBatch(batch);
        totalInserted += records.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: records.length, totalInserted });
        batchIndex++;
      }
    } else {
      for (const batch of batches as Iterable<InsertManyStreamBatchInput>) {
        const records = normalizeBatch(batch);
        totalInserted += records.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: records.length, totalInserted });
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

  async updateMany(
    _context: IExecutionContext,
    _table: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _mutateSpec: ICellValueSpec
  ): Promise<Result<UpdateManyResult, DomainError>> {
    return ok({ totalUpdated: 0, updatedRecordIds: [], updatedRecords: [] });
  }

  async updateManyStream(
    _context: IExecutionContext,
    _table: Table,
    batches:
      | Iterable<Result<UpdateManyStreamBatchInput, DomainError>>
      | AsyncIterable<Result<UpdateManyStreamBatchInput, DomainError>>,
    options?: UpdateManyStreamOptions
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    let totalUpdated = 0;
    let batchIndex = 0;
    const normalizeBatch = (
      batch: UpdateManyStreamBatchInput
    ): ReadonlyArray<RecordUpdateResult> =>
      isUpdateManyStreamBatch(batch) ? batch.updates : batch;

    if (Symbol.asyncIterator in batches) {
      for await (const batchResult of batches as AsyncIterable<
        Result<UpdateManyStreamBatchInput, DomainError>
      >) {
        if (batchResult.isErr()) {
          continue;
        }
        const batch = normalizeBatch(batchResult.value);
        totalUpdated += batch.length;
        options?.onBatchUpdated?.({ batchIndex, updatedCount: batch.length, totalUpdated });
        batchIndex++;
      }
    } else {
      for (const batchResult of batches as Iterable<
        Result<UpdateManyStreamBatchInput, DomainError>
      >) {
        if (batchResult.isErr()) {
          continue;
        }
        const batch = normalizeBatch(batchResult.value);
        totalUpdated += batch.length;
        options?.onBatchUpdated?.({ batchIndex, updatedCount: batch.length, totalUpdated });
        batchIndex++;
      }
    }

    return ok({ totalUpdated, updatedRecords: [] });
  }

  async deleteMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<DeleteManyResult, DomainError>> {
    return ok({});
  }

  async deleteManyStream(
    _context: IExecutionContext,
    _table: Table,
    recordIdBatches: Iterable<ReadonlyArray<RecordId>> | AsyncIterable<ReadonlyArray<RecordId>>,
    options?: DeleteManyStreamOptions
  ): Promise<Result<DeleteManyStreamResult, DomainError>> {
    let totalDeleted = 0;
    let batchIndex = 0;

    if (Symbol.asyncIterator in recordIdBatches) {
      for await (const recordIds of recordIdBatches as AsyncIterable<ReadonlyArray<RecordId>>) {
        totalDeleted += recordIds.length;
        options?.onBatchDeleted?.({ batchIndex, deletedCount: recordIds.length, totalDeleted });
        batchIndex += 1;
      }
    } else {
      for (const recordIds of recordIdBatches as Iterable<ReadonlyArray<RecordId>>) {
        totalDeleted += recordIds.length;
        options?.onBatchDeleted?.({ batchIndex, deletedCount: recordIds.length, totalDeleted });
        batchIndex += 1;
      }
    }

    return ok({ totalDeleted });
  }
}
