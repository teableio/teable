import { ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import { FieldName } from '../../domain/table/fields/FieldName';
import { SetRowOrderValueSpec } from '../../domain/table/records/specs/values/SetRowOrderValueSpec';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { TableEnsureViewRowOrderSpec } from '../../domain/table/specs/TableEnsureViewRowOrderSpec';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type {
  ITableRecordRepository,
  UpdateManyStreamBatchInput,
} from '../../ports/TableRecordRepository';
import { isUpdateManyStreamBatch } from '../../ports/TableRecordRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork } from '../../ports/UnitOfWork';
import { ViewManualSortService } from './ViewManualSortService';

const context: IExecutionContext = { actorId: ActorId.create('actor')._unsafeUnwrap() };

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Manual sort records')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('ViewManualSortService', () => {
  it('prepares aggregate-declared row-order storage in an isolated data transaction', async () => {
    const table = buildTable();
    const storageSpec = TableEnsureViewRowOrderSpec.create(table.views()[0]!);
    const transactionContext = { ...context, transaction: {} } as IExecutionContext;
    const update = vi.fn(async () => ok(table));
    const withTransaction = vi.fn(
      async (
        _context: IExecutionContext,
        work: (context: IExecutionContext) => Promise<Result<void, DomainError>>
      ) => work(transactionContext)
    );
    const service = new ViewManualSortService(
      { update } as unknown as ITableSchemaRepository,
      { withTransaction } as unknown as IUnitOfWork,
      {} as ITableRecordQueryRepository,
      {} as ITableRecordRepository
    );

    const result = await service.prepareStorage(context, table, storageSpec);

    expect(result.isOk()).toBe(true);
    expect(withTransaction).toHaveBeenCalledWith(context, expect.any(Function), {
      scope: 'data',
    });
    expect(update).toHaveBeenCalledWith(transactionContext, table, storageSpec);
  });

  it('uses TableRecord query/write repositories and skips unchanged row orders', async () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const records: TableRecordReadModel[] = [
      {
        id: `rec${'a'.repeat(16)}`,
        fields: {},
        version: 1,
        autoNumber: 2,
        orders: { [viewId.toString()]: 2 },
      },
      {
        id: `rec${'b'.repeat(16)}`,
        fields: {},
        version: 1,
        autoNumber: 1,
        orders: { [viewId.toString()]: 1 },
      },
    ];
    const findStream = vi.fn(async function* (
      ..._args: Parameters<ITableRecordQueryRepository['findStream']>
    ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
      for (const record of records) yield ok(record);
    });
    const updates: Array<{ recordId: string; order: number }> = [];
    const updateManyStream = vi.fn(
      async (
        _context: IExecutionContext,
        _table: Table,
        batches:
          | Iterable<Result<UpdateManyStreamBatchInput, DomainError>>
          | AsyncIterable<Result<UpdateManyStreamBatchInput, DomainError>>
      ) => {
        for await (const batchResult of batches) {
          if (batchResult.isErr()) return batchResult;
          const batch = isUpdateManyStreamBatch(batchResult.value)
            ? batchResult.value.updates
            : batchResult.value;
          for (const update of batch) {
            const spec = update.mutateSpec as SetRowOrderValueSpec;
            updates.push({ recordId: update.record.id().toString(), order: spec.orderValue });
          }
        }
        return ok({ totalUpdated: updates.length, updatedRecords: [] });
      }
    );
    const service = new ViewManualSortService(
      {} as ITableSchemaRepository,
      {} as IUnitOfWork,
      { findStream } as unknown as ITableRecordQueryRepository,
      { updateManyStream } as unknown as ITableRecordRepository
    );

    const result = await service.materialize(context, table, viewId, [
      { fieldId: table.getFields()[0]!.id().toString(), order: 'desc' },
    ]);

    expect(result._unsafeUnwrap()).toEqual({ updatedCount: 2 });
    expect(updates).toEqual([
      { recordId: records[0]!.id, order: 1 },
      { recordId: records[1]!.id, order: 2 },
    ]);
    expect(findStream).toHaveBeenCalledWith(
      context,
      table,
      undefined,
      expect.objectContaining({
        mode: 'stored',
        includeOrders: true,
        projectionFieldIds: [],
        orderBy: [
          { fieldId: table.getFields()[0]!.id(), direction: 'desc' },
          { column: '__auto_number', direction: 'asc' },
        ],
      })
    );
  });
});
