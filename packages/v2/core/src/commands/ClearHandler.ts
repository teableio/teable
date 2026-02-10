import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import { UndoRedoService } from '../application/services/UndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type {
  RecordFieldChangeDTO,
  RecordUpdateDTO,
} from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import type { UpdateRecordItem } from '../domain/table/methods/records';
import { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import type { UndoRedoCommandLeafData } from '../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { buildRecordConditionSpec } from '../queries/RecordFilterMapper';
import { ClearCommand } from './ClearCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { mergeOrderBy, resolveGroupByToOrderBy, resolveOrderBy } from './shared/orderBy';

export interface ClearResult {
  /** Number of records updated (cleared) */
  updatedCount: number;
}

@CommandHandler(ClearCommand)
@injectable()
export class ClearHandler implements ICommandHandler<ClearCommand, ClearResult> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ClearCommand
  ): Promise<Result<ClearResult, DomainError>> {
    const handler = this;

    return safeTry<ClearResult, DomainError>(async function* () {
      // 1. Get table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // 2. Get ordered visible field IDs from view's columnMeta
      const orderedFieldIds = yield* table.getOrderedVisibleFieldIds(command.viewId.toString(), {
        projection: command.projection,
      });
      const totalCols = orderedFieldIds.length;

      const view = yield* table.getView(command.viewId);
      const viewDefaults = yield* view.queryDefaults();
      const mergedDefaults = viewDefaults.merge({
        filter: command.filter,
        sort: command.sort,
        group: command.groupBy,
      });
      const effectiveFilter = mergedDefaults.filter();
      const effectiveSort = mergedDefaults.sort();

      // 3. Build filter spec from effective view filter (if provided)
      let filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined;
      if (effectiveFilter) {
        filterSpec = yield* buildRecordConditionSpec(table, effectiveFilter);
      }

      // 4. Get total row count for columns/rows type normalization
      let totalRows = 0;
      if (command.rangeType === 'columns' || command.rangeType === 'rows') {
        const limitResult = PageLimit.create(1);
        if (limitResult.isOk()) {
          const pagination = OffsetPagination.create(limitResult.value, PageOffset.zero());
          const countResult = yield* await handler.tableRecordQueryRepository.find(
            context,
            table,
            filterSpec,
            { mode: 'stored', pagination }
          );
          totalRows = countResult.total;
        }
      }

      // 5. Normalize ranges
      const normalizedRanges = command.normalizeRanges(totalRows, totalCols);
      const [[startCol, startRow], [endCol, endRow]] = normalizedRanges;
      const targetRowCount = endRow - startRow + 1;
      const targetColCount = endCol - startCol + 1;

      // Early return if nothing to clear
      if (targetRowCount <= 0 || targetColCount <= 0) {
        return ok({ updatedCount: 0 });
      }

      // 6. Get target fields
      const targetFieldIds = orderedFieldIds.slice(startCol, startCol + targetColCount);

      // 7. Filter out computed fields only - notNull validation is handled at database level
      const editableFieldIds = targetFieldIds.filter((fieldId) => {
        const fieldResult = table.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isErr()) {
          return false;
        }
        const field = fieldResult.value;
        return !field.computed().toBoolean();
      });

      if (editableFieldIds.length === 0) {
        return ok({ updatedCount: 0 });
      }

      // 8. Build orderBy from group + sort for correct row mapping
      // If none provided, fall back to view row order column (__row_{viewId})
      const effectiveGroup = mergedDefaults.group();
      const groupByOrderBy = yield* resolveGroupByToOrderBy(effectiveGroup);
      const sortOrderBy = yield* resolveOrderBy(effectiveSort);
      const orderBy = mergeOrderBy(groupByOrderBy, sortOrderBy, command.viewId.toString());

      // 9. Query existing records in the range
      const existingRecordsStream = handler.tableRecordQueryRepository.findStream(
        context,
        table,
        filterSpec,
        {
          mode: 'stored',
          pagination: { offset: startRow, limit: targetRowCount },
          orderBy,
        }
      );

      // 10. Collect records and build update operations
      const eventData: RecordUpdateDTO[] = [];
      const updateItems: UpdateRecordItem[] = [];

      for await (const recordResult of existingRecordsStream) {
        if (recordResult.isErr()) {
          return err(recordResult.error);
        }

        const record = recordResult.value;
        const recordId = yield* RecordId.create(record.id);
        const fieldValues = new Map<string, unknown>();
        const changes: RecordFieldChangeDTO[] = [];

        let hasNonNullValue = false;
        for (const fieldId of editableFieldIds) {
          const fieldIdStr = fieldId.toString();
          const oldValue = record.fields[fieldIdStr];
          if (oldValue !== null && oldValue !== undefined) {
            hasNonNullValue = true;
          }
          fieldValues.set(fieldIdStr, null);
          changes.push({ fieldId: fieldIdStr, oldValue, newValue: null });
        }

        // Skip records where all target fields are already null
        if (!hasNonNullValue) continue;

        updateItems.push({ recordId, fieldValues });
        eventData.push({
          recordId: record.id,
          oldVersion: record.version,
          newVersion: record.version + 1,
          changes,
        });
      }

      if (updateItems.length === 0) {
        return ok({ updatedCount: 0 });
      }

      // 11. Execute updates within transaction
      yield* await handler.unitOfWork.withTransaction(context, async (txContext) => {
        return handler.executeUpdates(txContext, table, updateItems);
      });

      // 12. Publish events after transaction commits
      if (eventData.length > 0) {
        const event = RecordsBatchUpdated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          updates: eventData,
          source: 'user',
        });
        yield* await handler.eventBus.publishMany(context, [event]);
      }

      if (eventData.length > 0) {
        const buildUpdateCommand = (recordId: string, fields: Record<string, unknown>) => ({
          type: 'UpdateRecord' as const,
          version: 1,
          payload: {
            tableId: table.id().toString(),
            recordId,
            fields,
            fieldKeyType: 'id' as const,
            typecast: false,
          },
        });

        const undoCommands: UndoRedoCommandLeafData[] = eventData.map((update) => {
          const fields: Record<string, unknown> = {};
          for (const change of update.changes) {
            fields[change.fieldId] = change.oldValue;
          }
          return buildUpdateCommand(update.recordId, fields);
        });

        const redoCommands: UndoRedoCommandLeafData[] = eventData.map((update) => {
          const fields: Record<string, unknown> = {};
          for (const change of update.changes) {
            fields[change.fieldId] = change.newValue;
          }
          return buildUpdateCommand(update.recordId, fields);
        });

        yield* await handler.undoRedoService.recordEntry(context, table.id(), {
          undoCommand: {
            type: 'Batch',
            version: 1,
            payload: undoCommands,
          },
          redoCommand: {
            type: 'Batch',
            version: 1,
            payload: redoCommands,
          },
        });
      }

      return ok({ updatedCount: eventData.length });
    });
  }

  private async executeUpdates(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    updateItems: ReadonlyArray<UpdateRecordItem>
  ): Promise<Result<void, DomainError>> {
    const handler = this;

    return safeTry<void, DomainError>(async function* () {
      // Generate update batches - typecast is false since we're setting null values
      const updateBatches = table.updateRecordsStream(updateItems, { typecast: false });

      const batchResults: Array<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> = [];
      for (const batch of updateBatches) {
        batchResults.push(batch);
      }

      function* syncBatchesGenerator(): Generator<
        Result<ReadonlyArray<RecordUpdateResult>, DomainError>
      > {
        for (const batch of batchResults) {
          yield batch;
        }
      }

      yield* await handler.tableRecordRepository.updateManyStream(
        context,
        table,
        syncBatchesGenerator()
      );

      return ok(undefined);
    });
  }
}
