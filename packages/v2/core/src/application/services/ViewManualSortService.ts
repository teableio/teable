import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { mergeOrderBy, resolveOrderBy } from '../../commands/shared/orderBy';
import type { DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { RecordUpdateResult } from '../../domain/table/records/RecordUpdateResult';
import { RecordId } from '../../domain/table/records/RecordId';
import { SetRowOrderValueSpec } from '../../domain/table/records/specs/values/SetRowOrderValueSpec';
import { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { ViewId } from '../../domain/table/views/ViewId';
import type { ViewSortItem } from '../../domain/table/views/ViewSort';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../../ports/TableRecordRepository';
import * as TableSchemaRepositoryPort from '../../ports/TableSchemaRepository';
import { v2CoreTokens } from '../../ports/tokens';
import type * as UnitOfWorkPort from '../../ports/UnitOfWork';

export type ViewManualSortMaterializeResult = {
  readonly updatedCount: number;
};

@injectable()
export class ViewManualSortService {
  private static readonly UPDATE_BATCH_SIZE = 500;

  constructor(
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository
  ) {}

  async prepareStorage(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    storageSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return this.unitOfWork.withTransaction(
      context,
      async (transactionContext) =>
        (await this.tableSchemaRepository.update(transactionContext, table, storageSpec)).map(
          () => undefined
        ),
      { scope: 'data' }
    );
  }

  async materialize(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    viewId: ViewId,
    sort: ReadonlyArray<ViewSortItem>
  ): Promise<Result<ViewManualSortMaterializeResult, DomainError>> {
    const resolvedSort = resolveOrderBy(sort);
    if (resolvedSort.isErr()) return err(resolvedSort.error);
    const orderBy = mergeOrderBy(undefined, resolvedSort.value, undefined);
    const batches = this.buildUpdateBatches(context, table, viewId, orderBy);
    const updateResult = await this.tableRecordRepository.updateManyStream(context, table, batches);
    return updateResult.map((result) => ({ updatedCount: result.totalUpdated }));
  }

  private async *buildUpdateBatches(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    viewId: ViewId,
    orderBy: ReadonlyArray<TableRecordQueryRepositoryPort.TableRecordOrderBy> | undefined
  ): AsyncGenerator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> {
    const viewIdText = viewId.toString();
    const records = this.tableRecordQueryRepository.findStream(context, table, undefined, {
      mode: 'stored',
      orderBy,
      includeOrders: true,
      projectionFieldIds: [],
      batchSize: ViewManualSortService.UPDATE_BATCH_SIZE,
    });
    let nextOrder = 1;
    let batch: RecordUpdateResult[] = [];

    for await (const recordResult of records) {
      if (recordResult.isErr()) {
        yield err(recordResult.error);
        return;
      }

      const record = recordResult.value;
      const previousOrder = record.orders?.[viewIdText];
      if (previousOrder !== nextOrder) {
        const recordIdResult = RecordId.create(record.id);
        if (recordIdResult.isErr()) {
          yield err(recordIdResult.error);
          return;
        }
        const tableRecordResult = TableRecord.create({
          id: recordIdResult.value,
          tableId: table.id(),
          fieldValues: [],
        });
        if (tableRecordResult.isErr()) {
          yield err(tableRecordResult.error);
          return;
        }
        batch.push(
          RecordUpdateResult.create(
            tableRecordResult.value,
            new SetRowOrderValueSpec(viewId, nextOrder)
          )
        );
      }
      nextOrder += 1;

      if (batch.length >= ViewManualSortService.UPDATE_BATCH_SIZE) {
        yield ok(batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      yield ok(batch);
    }
  }
}
