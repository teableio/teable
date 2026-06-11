/* eslint-disable no-inner-declarations */
import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import {
  type IPasteLinkAutoResolveResult,
  PasteLinkAutoResolveService,
  type ResolvedLinkValueLookupMap,
  type ResolvedLinkValueMap,
} from '../application/services/PasteLinkAutoResolveService';
import { areRecordFieldValuesEqual } from '../application/services/RecordFieldValueEquality';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import {
  type RecordWritePluginExecution,
  RecordWritePluginRunner,
} from '../application/services/RecordWritePluginRunner';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import {
  TableUpdateFlow,
  type TableUpdateFlowResult,
} from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { generateUuid } from '../domain/shared/IdGenerator';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type {
  RecordFieldChangeDTO,
  RecordUpdateDTO,
  RecordValuesDTO,
} from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import { FieldType } from '../domain/table/fields/FieldType';
import { DateTimeFormatting } from '../domain/table/fields/types/DateTimeFormatting';
import type { LinkField } from '../domain/table/fields/types/LinkField';
import { NumberFormatting } from '../domain/table/fields/types/NumberFormatting';
import type { RecordWriteSideEffect } from '../domain/table/fields/visitors/RecordWriteSideEffectVisitor';
import type { UpdateRecordItem } from '../domain/table/methods/records';
import { calculateBatchSize } from '../domain/table/methods/records/calculateBatchSize';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import { type TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import type { ViewId } from '../domain/table/views/ViewId';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { AsyncIterableQueue } from '../ports/memory/AsyncIterableQueue';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand,
  type UndoRedoCommandLeafData,
} from '../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import type { RecordFilter } from '../queries/RecordFilterDto';
import {
  buildRecordConditionSpec,
  buildSanitizedRecordConditionSpec,
} from '../queries/RecordFilterMapper';
import type { RecordSearch } from '../queries/RecordSearch';
import { resolveVisibleRowSearch } from '../queries/RecordSearch';
import {
  dateFormattingSchema,
  numberFormattingSchema,
  numberShowAsSchema,
  singleLineTextShowAsSchema,
} from '../schemas/field';
import type { ITableFieldInput } from '../schemas/field';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { PasteCommand } from './PasteCommand';
import type { PasteGroup, PasteSort, SourceFieldMeta } from './PasteCommand';
import type { NormalizedRanges, RangeType } from './RangeUtils';
import {
  buildOperationBatchMutation,
  withBatchMutation,
} from './shared/batchMutationOrchestration';
import {
  mergeOrderByWithViewRowTieBreaker,
  resolveGroupByToOrderBy,
  resolveOrderBy,
} from './shared/orderBy';
import { resolveSelectionStreamBatchSize } from './shared/streamBatchSize';
import { toTableRecord } from './shared/toTableRecord';
import type { ICreateTableFieldSpec } from './TableFieldSpecs';
import {
  collectForeignTableReferences,
  parseTableFieldSpec,
  resolveTableFieldInputs,
} from './TableFieldSpecs';

export interface PasteResult {
  /** Number of records updated */
  updatedCount: number;
  /** Number of records created */
  createdCount: number;
  /** IDs of created records (in order of creation) */
  createdRecordIds: ReadonlyArray<string>;
}

interface CollectedEventData {
  tableEvents: IDomainEvent[];
  updates: RecordUpdateDTO[];
  createdRecords: RecordValuesDTO[];
  updatedCount: number;
  schemaUndoCommands: UndoRedoCommandLeafData[];
  schemaRedoCommands: UndoRedoCommandLeafData[];
  afterCommitHandlers: Array<() => Promise<void>>;
}

interface CollectedPasteOperations {
  updateOperations: UpdateOperation[];
  createOperations: CreateOperation[];
}

interface PlannedColumnExpansion {
  table: Table;
  newFieldIds: ReadonlyArray<FieldId>;
  apply: (
    context: ExecutionContextPort.IExecutionContext
  ) => Promise<Result<TableUpdateFlowResult, DomainError>>;
}

/** Represents an update operation for an existing record */
interface UpdateOperation {
  type: 'update';
  existingRecord: TableRecordReadModel;
  rowData: ReadonlyArray<unknown>;
  /**
   * Per-record editable columns after plugin scoping. `undefined` means this
   * operation still uses the shared update column set for the paste request.
   */
  editableColumns?: ReadonlyArray<EditableColumn>;
}

/** Represents a create operation for a new record */
interface CreateOperation {
  type: 'create';
  rowData: ReadonlyArray<unknown>;
}

type PasteOperation = UpdateOperation | CreateOperation;

type EditableColumn = {
  fieldId: FieldId;
  columnIndex: number;
};

type LinkTitleMap = Map<string, Map<string, string>>;

type PendingUpdateEvent = {
  recordId: string;
  oldVersion: number;
  oldValues: Map<string, unknown>;
};

type PendingCreatedRecord = {
  recordId: string;
  fields: Array<{ fieldId: string; value: unknown }>;
};

type PasteOperationStreamState = {
  iterator: AsyncIterator<Result<PasteOperation, DomainError>>;
  pendingUpdateOperation?: UpdateOperation;
  pendingCreateOperation?: CreateOperation;
  tableForMutations: Table;
  accumulatedSideEffects: RecordWriteSideEffect[];
  resolvedLinkValues: ResolvedLinkValueLookupMap;
};

type PasteStreamCommandLike = {
  readonly tableId: TableId;
  readonly viewId: ViewId;
  readonly rawRanges: ReadonlyArray<readonly [number, number]>;
  readonly rangeType: RangeType;
  readonly content: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly filter: RecordFilter | undefined;
  readonly updateFilter: RecordFilter | undefined;
  readonly search: RecordSearch | undefined;
  readonly sourceFields: ReadonlyArray<SourceFieldMeta> | undefined;
  readonly typecast: boolean;
  readonly projection: ReadonlyArray<string> | undefined;
  readonly sort: ReadonlyArray<PasteSort> | undefined;
  readonly groupBy: ReadonlyArray<PasteGroup> | undefined;
  readonly ignoreViewQuery: boolean;
  readonly batchSize?: number;
  normalizeRanges(totalRows: number, totalCols: number): NormalizedRanges;
};

type PreparedPasteStreamPlan = {
  readonly persistedTable: Table;
  readonly tableForPaste: Table;
  readonly editableColumns: ReadonlyArray<EditableColumn>;
  readonly plannedColumnExpansion?: PlannedColumnExpansion;
  readonly typecast: boolean;
  readonly operationsStream: AsyncIterable<Result<PasteOperation, DomainError>>;
  readonly totalCount: number;
  readonly totalChunkCount: number;
  readonly batchSize: number;
};

type PasteChunkPersistResult = {
  readonly table: Table;
  readonly eventData: CollectedEventData;
  readonly updatedCount: number;
  readonly createdCount: number;
  readonly createdRecordIds: ReadonlyArray<string>;
};

export interface PasteStreamProgressEvent {
  id: 'progress';
  phase: 'preparing' | 'pasting';
  batchIndex: number;
  totalCount: number;
  processedCount: number;
  updatedCount: number;
  createdCount: number;
  batchProcessedCount: number;
}

export interface PasteStreamDoneEvent {
  id: 'done';
  totalCount: number;
  processedCount: number;
  updatedCount: number;
  createdCount: number;
  data: {
    updatedCount: number;
    createdCount: number;
    createdRecordIds: string[];
  };
}

export interface PasteStreamErrorEvent {
  id: 'error';
  phase: 'preparing' | 'guarding' | 'pasting' | 'publishing' | 'finalizing';
  batchIndex: number;
  totalCount: number;
  processedCount: number;
  updatedCount: number;
  createdCount: number;
  recordIds: string[];
  message: string;
  code?: string;
}

export type PasteStreamEvent =
  | PasteStreamProgressEvent
  | PasteStreamDoneEvent
  | PasteStreamErrorEvent;

const MAX_PASTE_STREAM_BUFFERED_EVENTS = 64;

type LooseFieldInput = {
  type: string;
  name?: string;
  options?: Record<string, unknown>;
};

@CommandHandler(PasteCommand)
@injectable()
export class PasteHandler implements ICommandHandler<PasteCommand, PasteResult> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    protected readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableUpdateFlow)
    protected readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    protected readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    protected readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableRecordRepository)
    protected readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    protected readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    protected readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.pasteLinkAutoResolveService)
    protected readonly pasteLinkAutoResolveService: PasteLinkAutoResolveService,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    protected readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.recordWriteUndoRedoPlanService)
    protected readonly recordWriteUndoRedoPlanService: RecordWriteUndoRedoPlanService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    protected readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.eventBus)
    protected readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    protected readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    protected readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: PasteCommand
  ): Promise<Result<PasteResult, DomainError>> {
    const handler = this;

    return safeTry<PasteResult, DomainError>(async function* () {
      // 1. Get table
      const persistedTable = yield* await handler.tableQueryService.getById(
        context,
        command.tableId
      );
      let tableForPaste = persistedTable;

      // 2. Get ordered visible field IDs from view's columnMeta or projection
      let orderedFieldIds = yield* persistedTable.getOrderedVisibleFieldIds(
        command.viewId.toString(),
        {
          projection: command.projection,
        }
      );
      const totalCols = orderedFieldIds.length;

      const view = yield* persistedTable.getView(command.viewId);
      const viewDefaults = yield* view.queryDefaults();
      const mergedDefaults = viewDefaults.merge({
        filter: command.filter,
        sort: command.sort,
        group: command.groupBy,
      });
      const effectiveFilter = command.ignoreViewQuery
        ? command.filter ?? undefined
        : mergedDefaults.filter();
      const effectiveSort = command.ignoreViewQuery
        ? command.sort ?? undefined
        : mergedDefaults.sort();

      // 3. Build filter spec from effective view filter. Search-aware visible rows are handled
      // by the query repository so field-type-specific search semantics stay centralized.
      const filterSpec = yield* buildSanitizedRecordConditionSpec(persistedTable, effectiveFilter);
      const visibleRowSearch = resolveVisibleRowSearch(command.search, orderedFieldIds);

      // 4. Get total row count for columns/rows type normalization
      // This uses a limit:1 query to get total count efficiently
      let totalRows = 0;
      if (command.rangeType === 'columns' || command.rangeType === 'rows') {
        const limitResult = PageLimit.create(1);
        if (limitResult.isOk()) {
          const pagination = OffsetPagination.create(limitResult.value, PageOffset.zero());
          const countResult = yield* await handler.tableRecordQueryRepository.find(
            context,
            persistedTable,
            filterSpec,
            { mode: 'stored', pagination, search: visibleRowSearch }
          );
          totalRows = countResult.total;
        }
      }

      // 5. Normalize ranges based on type (columns/rows/cell)
      const normalizedRanges = command.normalizeRanges(totalRows, totalCols);
      const [[startCol, startRow], [endCol, endRow]] = normalizedRanges;
      const targetRangeCols = endCol - startCol + 1;
      const targetRangeRows = endRow - startRow + 1;

      // 6. Expand paste content if selection is a multiple of content size
      const expandedContent = expandPasteContent(command.content, targetRangeRows, targetRangeCols);

      // Early return if nothing to paste
      if (expandedContent.length === 0 || expandedContent[0]?.length === 0) {
        return ok({ updatedCount: 0, createdCount: 0, createdRecordIds: [] });
      }

      // 7. Plan column expansion if paste exceeds current field count.
      // Persist the table schema only in the final execution phase so DDL
      // does not happen during the planning/stream-shaping stage.
      const expandedColCount = expandedContent[0]!.length;
      const numColsToExpand = Math.max(0, startCol + expandedColCount - totalCols);
      let plannedColumnExpansion: PlannedColumnExpansion | undefined;
      if (numColsToExpand > 0) {
        const expandResult = yield* await handler.planColumnExpansion(context, persistedTable, {
          numColsToExpand,
          sourceFields: command.sourceFields,
        });
        plannedColumnExpansion = expandResult;
        tableForPaste = expandResult.table;
        if (plannedColumnExpansion.newFieldIds.length > 0) {
          orderedFieldIds = [...orderedFieldIds, ...plannedColumnExpansion.newFieldIds];
        }
      }

      // 8. Calculate target fields based on expanded content
      const targetFieldIds = orderedFieldIds.slice(startCol, startCol + expandedColCount);

      // 9. Filter out computed fields while preserving column indices
      const editableColumns: EditableColumn[] = [];
      targetFieldIds.forEach((fieldId, columnIndex) => {
        const fieldResult = tableForPaste.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isOk() && !fieldResult.value.computed().toBoolean()) {
          editableColumns.push({ fieldId, columnIndex });
        }
      });

      if (editableColumns.length === 0) {
        return ok({ updatedCount: 0, createdCount: 0, createdRecordIds: [] });
      }

      // 10. Build orderBy from group + sort for correct row mapping
      // If none provided, fall back to view row order column (__row_{viewId})
      const effectiveGroup = command.ignoreViewQuery
        ? command.groupBy ?? undefined
        : mergedDefaults.group();
      const groupByOrderBy = yield* resolveGroupByToOrderBy(effectiveGroup);
      const sortOrderBy = yield* resolveOrderBy(effectiveSort);
      const orderBy = mergeOrderByWithViewRowTieBreaker(
        groupByOrderBy,
        sortOrderBy,
        command.viewId.toString()
      );

      // 11. Create streaming query for existing records with filter and sort
      const existingRecordsStream = handler.tableRecordQueryRepository.findStream(
        context,
        persistedTable,
        filterSpec,
        {
          mode: 'stored',
          pagination: {
            offset: startRow,
            limit: expandedContent.length,
          },
          orderBy,
          search: visibleRowSearch,
        }
      );

      // 10.5. Build updateFilterSpec if updateFilter is provided
      // This spec will be used to evaluate each record in-memory during streaming
      let updateFilterSpec:
        | ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
        | undefined = undefined;
      if (command.updateFilter) {
        updateFilterSpec = yield* buildRecordConditionSpec(persistedTable, command.updateFilter);
      }

      // 11. Generate paste operations by streaming through existing records
      const operationsStream = handler.generatePasteOperations(
        existingRecordsStream,
        expandedContent,
        persistedTable,
        updateFilterSpec
      );
      const collectedOperations = yield* await handler.collectPasteOperations(operationsStream);
      const initialPluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.paste,
        executionContext: context,
        table: persistedTable,
        payload: yield* handler.buildPastePluginPayload(
          command.typecast,
          editableColumns,
          editableColumns,
          collectedOperations.updateOperations,
          collectedOperations.createOperations
        ),
        isTransactionBound: false,
      });
      const pluginScope = yield* initialPluginExecution.getScope();
      const expandedFieldIds = new Set(
        plannedColumnExpansion?.newFieldIds.map((fieldId) => fieldId.toString()) ?? []
      );
      const scopedUpdateOperations = yield* handler.scopeUpdateOperations(
        persistedTable,
        collectedOperations.updateOperations,
        editableColumns,
        pluginScope?.recordSpec,
        initialPluginExecution,
        expandedFieldIds
      );
      const scopedCreateColumns = handler.filterCreateColumns(
        editableColumns,
        pluginScope?.createFieldIds,
        expandedFieldIds
      );
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.paste,
        executionContext: context,
        table: persistedTable,
        payload: yield* handler.buildPastePluginPayload(
          command.typecast,
          editableColumns,
          scopedCreateColumns,
          scopedUpdateOperations,
          collectedOperations.createOperations
        ),
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();
      const executableUpdateOperations = scopedUpdateOperations;
      const executableCreateOperations =
        scopedCreateColumns.length > 0 ? collectedOperations.createOperations : [];
      if (executableUpdateOperations.length === 0 && executableCreateOperations.length === 0) {
        return ok({ updatedCount: 0, createdCount: 0, createdRecordIds: [] });
      }
      const batchMutation = buildOperationBatchMutation(
        context,
        executableUpdateOperations.length + executableCreateOperations.length
      );

      // 12. Execute paste within transaction
      const eventData: CollectedEventData = {
        tableEvents: [],
        updates: [],
        createdRecords: [],
        updatedCount: 0,
        schemaUndoCommands: [],
        schemaRedoCommands: [],
        afterCommitHandlers: [],
      };

      yield* await handler.unitOfWork.withTransaction(context, async (txContext) => {
        const txContextWithBatchMutation = withBatchMutation(txContext, batchMutation);
        return handler.executePasteStream(
          txContextWithBatchMutation,
          tableForPaste,
          executableUpdateOperations,
          executableCreateOperations,
          pluginExecution,
          command.typecast,
          editableColumns,
          scopedCreateColumns,
          eventData,
          plannedColumnExpansion
        );
      });

      // 13. Publish events AFTER transaction commits
      const events: IDomainEvent[] = [...eventData.tableEvents];

      if (eventData.updates.length > 0) {
        events.push(
          RecordsBatchUpdated.create({
            tableId: persistedTable.id(),
            baseId: persistedTable.baseId(),
            updates: eventData.updates,
            source: 'user',
            orchestration: batchMutation,
          })
        );
      }

      if (eventData.createdRecords.length > 0) {
        events.push(
          RecordsBatchCreated.create({
            tableId: persistedTable.id(),
            baseId: persistedTable.baseId(),
            records: eventData.createdRecords,
            orchestration: batchMutation,
          })
        );
      }

      if (events.length > 0) {
        yield* await handler.eventBus.publishMany(context, events);
      }

      const buildUpdateCommand = (recordId: string, fields: Record<string, unknown>) =>
        createUndoRedoCommand('UpdateRecord', {
          tableId: persistedTable.id().toString(),
          recordId,
          fields,
          fieldKeyType: 'id',
          typecast: false,
        });

      const undoCommands: UndoRedoCommandLeafData[] = [];
      const redoCommands: UndoRedoCommandLeafData[] = [];

      if (eventData.createdRecords.length > 0) {
        undoCommands.push(
          createUndoRedoCommand('DeleteRecords', {
            tableId: persistedTable.id().toString(),
            recordIds: eventData.createdRecords.map((record) => record.recordId),
          })
        );
      }

      if (eventData.updates.length > 0) {
        for (const update of eventData.updates) {
          const fields: Record<string, unknown> = {};
          for (const change of update.changes) {
            fields[change.fieldId] = change.oldValue;
          }
          undoCommands.push(buildUpdateCommand(update.recordId, fields));
        }
      }

      if (eventData.updates.length > 0) {
        for (const update of eventData.updates) {
          const fields: Record<string, unknown> = {};
          for (const change of update.changes) {
            fields[change.fieldId] = change.newValue;
          }
          redoCommands.push(buildUpdateCommand(update.recordId, fields));
        }
      }

      if (eventData.createdRecords.length > 0) {
        const restoreRecords = eventData.createdRecords.map((record) => {
          const fields: Record<string, unknown> = {};
          for (const field of record.fields) {
            fields[field.fieldId] = field.value;
          }
          return {
            recordId: record.recordId,
            fields,
            orders: record.orders,
          };
        });

        redoCommands.push(
          createUndoRedoCommand('RestoreRecords', {
            tableId: persistedTable.id().toString(),
            records: restoreRecords,
          })
        );
      }

      if (undoCommands.length > 0 || redoCommands.length > 0) {
        yield* await handler.undoRedoStackService.appendEntry(
          toUndoRedoStackAppendContext(context),
          persistedTable.id(),
          {
            undoCommand: composeUndoRedoCommands([
              ...undoCommands,
              ...eventData.schemaUndoCommands,
            ]),
            redoCommand: composeUndoRedoCommands([
              ...eventData.schemaRedoCommands,
              ...redoCommands,
            ]),
          }
        );
      }
      await pluginExecution.afterCommit();
      for (const afterCommitHandler of eventData.afterCommitHandlers) {
        await afterCommitHandler();
      }

      return ok({
        updatedCount: eventData.updatedCount,
        createdCount: eventData.createdRecords.length,
        createdRecordIds: eventData.createdRecords.map((r) => r.recordId),
      });
    });
  }

  protected async planColumnExpansion(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    params: {
      numColsToExpand: number;
      sourceFields?: ReadonlyArray<SourceFieldMeta>;
    }
  ): Promise<Result<PlannedColumnExpansion, DomainError>> {
    const { numColsToExpand, sourceFields } = params;
    if (numColsToExpand <= 0) {
      return ok({
        table,
        newFieldIds: [],
        apply: async () => ok({ table, events: [], postPersistEvents: [] }),
      });
    }

    const headerFields = sourceFields ?? [];
    const startIndex = Math.max(0, headerFields.length - numColsToExpand);
    const fieldInputs: ITableFieldInput[] = Array.from({ length: numColsToExpand }, (_, index) =>
      this.sourceFieldToInput(headerFields[startIndex + index])
    );

    const handler = this;
    return safeTry<PlannedColumnExpansion, DomainError>(async function* () {
      const existingNames = table.getFields().map((field) => field.name().toString());
      const resolvedInputs = yield* resolveTableFieldInputs(fieldInputs, existingNames, {
        t: context.$t,
        hostTable: table,
      });
      const specs: ICreateTableFieldSpec[] = [];

      for (const input of resolvedInputs) {
        const spec = yield* parseTableFieldSpec(input, { isPrimary: false });
        specs.push(spec);
      }

      const foreignReferences = yield* collectForeignTableReferences(specs);
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: table.baseId(),
        references: foreignReferences,
      });

      const createdFields: Field[] = [];
      for (const spec of specs) {
        const field = yield* spec.createField({
          baseId: table.baseId(),
          tableId: table.id(),
        });
        createdFields.push(field);
      }

      const applyFields = (current: Table) =>
        current.update((mutator) => {
          let next = mutator;
          for (const field of createdFields) {
            next = next.addField(field, { foreignTables });
          }
          return next;
        });
      const plannedUpdate = yield* applyFields(table);

      return ok({
        table: plannedUpdate.table,
        newFieldIds: createdFields.map((field) => field.id()),
        apply: async (transactionContext: ExecutionContextPort.IExecutionContext) =>
          handler.tableUpdateFlow.execute(transactionContext, { table }, applyFields, {
            publishEvents: false,
            hooks: {
              afterPersist: async (currentContext, updatedTable) =>
                safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                  if (createdFields.length === 0) return ok([]);
                  const sideEffectResult =
                    yield* await handler.fieldCreationSideEffectService.execute(currentContext, {
                      table: updatedTable,
                      fields: createdFields,
                      foreignTables,
                    });
                  return ok(sideEffectResult.events);
                }),
            },
          }),
      });
    });
  }

  protected sourceFieldToInput(field?: SourceFieldMeta): ITableFieldInput {
    if (!field?.type) {
      return { type: 'singleLineText' } as ITableFieldInput;
    }

    const baseField: LooseFieldInput = {
      name: field.name,
      type: field.type,
      options: field.options,
    };

    if (field.isComputed && !field.isLookup) {
      if (field.type === 'createdBy' || field.type === 'lastModifiedBy') {
        return {
          ...baseField,
          type: 'user',
          options: {
            isMultiple: false,
            shouldNotify: true,
          },
        } as ITableFieldInput;
      }

      const mapped = this.optionsRoToVoByCvType(field.cellValueType, field.options);
      return {
        ...baseField,
        type: mapped.type,
        options: mapped.options,
      } as ITableFieldInput;
    }

    if (field.isLookup) {
      const mapped = this.lookupOptionsRoToVo(field);
      return {
        ...baseField,
        type: mapped.type,
        options: mapped.options,
      } as ITableFieldInput;
    }

    return baseField as ITableFieldInput;
  }

  protected optionsRoToVoByCvType(
    cellValueType?: string,
    options?: Record<string, unknown>
  ): LooseFieldInput {
    const safeOptions = options ?? {};
    switch (cellValueType) {
      case 'number': {
        const formattingRes = numberFormattingSchema.safeParse(safeOptions.formatting);
        const showAsRes = numberShowAsSchema.safeParse(safeOptions.showAs);
        return {
          type: 'number',
          options: {
            formatting: formattingRes.success
              ? formattingRes.data
              : NumberFormatting.default().toDto(),
            ...(showAsRes.success ? { showAs: showAsRes.data } : {}),
          },
        };
      }
      case 'dateTime': {
        const formattingRes = dateFormattingSchema.safeParse(safeOptions.formatting);
        return {
          type: 'date',
          options: {
            formatting: formattingRes.success
              ? formattingRes.data
              : DateTimeFormatting.default().toDto(),
          },
        };
      }
      case 'boolean': {
        return {
          type: 'checkbox',
          options: {},
        };
      }
      case 'string':
      default: {
        const showAsRes = singleLineTextShowAsSchema.safeParse(safeOptions.showAs);
        return {
          type: 'singleLineText',
          options: {
            ...(showAsRes.success ? { showAs: showAsRes.data } : {}),
          },
        };
      }
    }
  }

  protected lookupOptionsRoToVo(field?: SourceFieldMeta): LooseFieldInput {
    if (!field?.type) {
      return { type: 'singleLineText' };
    }

    if (field.type === 'singleSelect' && field.isMultipleCellValue) {
      return {
        type: 'multipleSelect',
        options: field.options,
      };
    }

    if (field.type === 'user' && field.isMultipleCellValue) {
      return {
        type: 'user',
        options: {
          ...(field.options ?? {}),
          isMultiple: true,
        },
      };
    }

    return {
      type: field.type,
      options: field.options,
    };
  }

  /**
   * Generate paste operations by streaming through existing records.
   * Yields update operations for existing records and create operations for new rows.
   * If updateFilterSpec is provided, records are checked in-memory using spec.isSatisfiedBy();
   * only records that satisfy the spec will be updated.
   */
  protected async *generatePasteOperations(
    existingRecordsStream: AsyncIterable<Result<TableRecordReadModel, DomainError>>,
    content: ReadonlyArray<ReadonlyArray<unknown>>,
    table: Table,
    updateFilterSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): AsyncIterable<Result<PasteOperation, DomainError>> {
    let rowIndex = 0;

    // Stream through existing records - generate update operations
    for await (const recordResult of existingRecordsStream) {
      if (rowIndex >= content.length) break;

      if (recordResult.isErr()) {
        yield err(recordResult.error);
        return;
      }

      const readModel = recordResult.value;

      // Check if this record is allowed to be updated using in-memory spec evaluation
      let canUpdate = true;
      if (updateFilterSpec) {
        const tableRecordResult = toTableRecord(table, readModel);
        if (tableRecordResult.isErr()) {
          yield err(tableRecordResult.error);
          return;
        }
        canUpdate = updateFilterSpec.isSatisfiedBy(tableRecordResult.value);
      }

      if (canUpdate) {
        yield ok({
          type: 'update' as const,
          existingRecord: readModel,
          rowData: content[rowIndex]!,
          editableColumns: undefined,
        });
      }
      // Always increment rowIndex to consume the content row (even if skipping update)
      rowIndex++;
    }

    // Generate create operations for remaining rows
    for (; rowIndex < content.length; rowIndex++) {
      yield ok({
        type: 'create' as const,
        rowData: content[rowIndex]!,
      });
    }
  }

  protected async collectPasteOperations(
    operationsStream: AsyncIterable<Result<PasteOperation, DomainError>>
  ): Promise<Result<CollectedPasteOperations, DomainError>> {
    const updateOperations: UpdateOperation[] = [];
    const createOperations: CreateOperation[] = [];

    for await (const opResult of operationsStream) {
      if (opResult.isErr()) {
        return err(opResult.error);
      }

      if (opResult.value.type === 'update') {
        updateOperations.push(opResult.value);
      } else {
        createOperations.push(opResult.value);
      }
    }

    return ok({ updateOperations, createOperations });
  }

  private filterUpdateColumns(
    editableColumns: ReadonlyArray<EditableColumn>,
    allowedFieldIds: ReadonlySet<string> | undefined,
    extraAllowedFieldIds: ReadonlySet<string>
  ): ReadonlyArray<EditableColumn> {
    if (!allowedFieldIds) {
      return editableColumns;
    }

    return editableColumns.filter((column) => {
      const fieldId = column.fieldId.toString();
      return allowedFieldIds.has(fieldId) || extraAllowedFieldIds.has(fieldId);
    });
  }

  private filterCreateColumns(
    editableColumns: ReadonlyArray<EditableColumn>,
    allowedFieldIds: ReadonlySet<string> | undefined,
    extraAllowedFieldIds: ReadonlySet<string>
  ): ReadonlyArray<EditableColumn> {
    if (!allowedFieldIds) {
      return editableColumns;
    }

    if (allowedFieldIds.size === 0) {
      return [];
    }

    return editableColumns.filter((column) => {
      const fieldId = column.fieldId.toString();
      return allowedFieldIds.has(fieldId) || extraAllowedFieldIds.has(fieldId);
    });
  }

  private scopeUpdateOperations(
    table: Table,
    updateOperations: ReadonlyArray<UpdateOperation>,
    editableColumns: ReadonlyArray<EditableColumn>,
    recordSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    pluginExecution: RecordWritePluginExecution,
    extraAllowedFieldIds: ReadonlySet<string>
  ): Result<ReadonlyArray<UpdateOperation>, DomainError> {
    const authorizedOperations: UpdateOperation[] = [];
    for (const operation of updateOperations) {
      const tableRecord = toTableRecord(table, operation.existingRecord);
      if (tableRecord.isErr()) {
        return err(tableRecord.error);
      }
      if (recordSpec && !recordSpec.isSatisfiedBy(tableRecord.value)) {
        continue;
      }

      const allowedFieldIdsResult = pluginExecution.getUpdateFieldIdsForRecord(tableRecord.value);
      if (allowedFieldIdsResult.isErr()) {
        return err(allowedFieldIdsResult.error);
      }

      const operationEditableColumns = this.filterUpdateColumns(
        editableColumns,
        allowedFieldIdsResult.value,
        extraAllowedFieldIds
      );
      if (!operationEditableColumns.length) {
        continue;
      }

      authorizedOperations.push({
        ...operation,
        editableColumns: operationEditableColumns,
      });
    }

    return ok(authorizedOperations);
  }

  protected buildPastePluginPayload(
    typecast: boolean,
    // Columns shared by the entire update side of the paste request before per-record scoping.
    updateColumns: ReadonlyArray<EditableColumn>,
    // Columns that remain createable after plugin scoping and field expansion allowances.
    createColumns: ReadonlyArray<EditableColumn>,
    updateOperations: ReadonlyArray<UpdateOperation>,
    createOperations: ReadonlyArray<CreateOperation>
  ): Result<
    {
      readonly editableFieldIds: ReadonlyArray<FieldId>;
      readonly updateRecordIds: ReadonlyArray<RecordId>;
      readonly updateRecordsFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>;
      readonly createRecordsFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>;
      readonly typecast: boolean;
      readonly updateRecordCount: number;
      readonly createRecordCount: number;
      readonly recordCount: number;
    },
    DomainError
  > {
    const updateRecordIds: RecordId[] = [];
    const updateRecordsFieldValues: ReadonlyMap<string, unknown>[] = [];

    for (const operation of updateOperations) {
      const recordIdResult = RecordId.create(operation.existingRecord.id);
      if (recordIdResult.isErr()) {
        return err(recordIdResult.error);
      }
      updateRecordIds.push(recordIdResult.value);
      const operationEditableColumns = operation.editableColumns ?? updateColumns;
      updateRecordsFieldValues.push(
        this.rowDataToFieldValues(operation.rowData, operationEditableColumns)
      );
    }

    const editableFieldIds = new Map<string, FieldId>();
    for (const operation of updateOperations) {
      for (const column of operation.editableColumns ?? updateColumns) {
        editableFieldIds.set(column.fieldId.toString(), column.fieldId);
      }
    }
    for (const column of createColumns) {
      editableFieldIds.set(column.fieldId.toString(), column.fieldId);
    }

    return ok({
      editableFieldIds: [...editableFieldIds.values()],
      updateRecordIds,
      updateRecordsFieldValues,
      createRecordsFieldValues: createOperations.map((operation) =>
        this.rowDataToFieldValues(operation.rowData, createColumns)
      ),
      typecast,
      updateRecordCount: updateOperations.length,
      createRecordCount: createOperations.length,
      recordCount: updateOperations.length + createOperations.length,
    });
  }

  protected rowDataToFieldValues(
    rowData: ReadonlyArray<unknown>,
    editableColumns: ReadonlyArray<EditableColumn>
  ): ReadonlyMap<string, unknown> {
    const fieldValues = new Map<string, unknown>();
    for (const column of editableColumns) {
      fieldValues.set(column.fieldId.toString(), rowData[column.columnIndex] ?? null);
    }
    return fieldValues;
  }

  protected reconcilePersistedUpdateEvents(
    eventData: CollectedEventData,
    updateResult: TableRecordRepositoryPort.UpdateManyStreamResult
  ): void {
    const persistedRecords = new Map(
      updateResult.updatedRecords.map((record) => [record.recordId.toString(), record])
    );

    const reconciledUpdates: RecordUpdateDTO[] = [];
    for (const update of eventData.updates) {
      const persistedRecord = persistedRecords.get(update.recordId);
      if (!persistedRecord) {
        continue;
      }

      const changes: RecordFieldChangeDTO[] = [];
      for (const change of update.changes) {
        const oldValue = Object.prototype.hasOwnProperty.call(
          persistedRecord.oldFieldValues,
          change.fieldId
        )
          ? persistedRecord.oldFieldValues[change.fieldId]
          : change.oldValue;
        if (areRecordFieldValuesEqual(oldValue, change.newValue)) {
          continue;
        }
        changes.push({ ...change, oldValue });
      }

      if (changes.length === 0) {
        continue;
      }
      reconciledUpdates.push({
        ...update,
        oldVersion: persistedRecord.oldVersion,
        newVersion: persistedRecord.newVersion,
        changes,
      });
    }
    eventData.updates = reconciledUpdates;
  }

  /**
   * Execute paste operations using streaming.
   * Consumes update/create operations lazily and only keeps the current batch in memory.
   */
  protected async executePasteStream(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    updateOperations: ReadonlyArray<UpdateOperation>,
    createOperations: ReadonlyArray<CreateOperation>,
    pluginExecution: RecordWritePluginExecution,
    typecast: boolean,
    updateColumns: ReadonlyArray<EditableColumn>,
    createColumns: ReadonlyArray<EditableColumn>,
    eventData: CollectedEventData,
    plannedColumnExpansion?: PlannedColumnExpansion
  ): Promise<Result<void, DomainError>> {
    const handler = this;
    const tracer = context.tracer;
    const executeSpan = tracer?.startSpan('teable.PasteHandler.executePasteStream');

    try {
      const batchSize = calculateBatchSize(table.getFields().length);
      const operationsStream = (async function* (): AsyncGenerator<
        Result<PasteOperation, DomainError>
      > {
        for (const operation of updateOperations) {
          yield ok(operation);
        }

        for (const operation of createOperations) {
          yield ok(operation);
        }
      })();
      const streamState: PasteOperationStreamState = {
        iterator: operationsStream[Symbol.asyncIterator](),
        tableForMutations: table,
        accumulatedSideEffects: [],
        resolvedLinkValues: new Map(),
      };
      let persistedTable = table;

      const beforePersistResult = await pluginExecution.beforePersist(context);
      if (beforePersistResult.isErr()) {
        return err(beforePersistResult.error);
      }

      if (plannedColumnExpansion) {
        const columnExpansionResult = await plannedColumnExpansion.apply(context);
        if (columnExpansionResult.isErr()) {
          return err(columnExpansionResult.error);
        }
        persistedTable = columnExpansionResult.value.table;
        streamState.tableForMutations = persistedTable;
        eventData.tableEvents.push(
          ...columnExpansionResult.value.events,
          ...columnExpansionResult.value.postPersistEvents
        );
        const fieldExpansionUndoRedoPlan =
          await handler.recordWriteUndoRedoPlanService.captureCreatedFields(
            context,
            persistedTable,
            plannedColumnExpansion.newFieldIds
          );
        if (fieldExpansionUndoRedoPlan.isErr()) {
          return err(fieldExpansionUndoRedoPlan.error);
        }
        eventData.schemaUndoCommands.push(...fieldExpansionUndoRedoPlan.value.undoCommands);
        eventData.schemaRedoCommands.push(...fieldExpansionUndoRedoPlan.value.redoCommands);
      }

      if (updateOperations.length > 0) {
        const updateSpan = tracer?.startSpan('teable.PasteHandler.processUpdates');
        try {
          const updateResult = await handler.tableRecordRepository.updateManyStream(
            context,
            persistedTable,
            handler.createResolvedUpdateBatchStream(
              context,
              streamState,
              typecast,
              updateColumns,
              batchSize,
              eventData
            )
          );
          if (updateResult.isErr()) {
            return err(updateResult.error);
          }
          eventData.updatedCount = updateResult.value.totalUpdated;
          handler.reconcilePersistedUpdateEvents(eventData, updateResult.value);
        } finally {
          updateSpan?.end();
        }
      }

      if (createOperations.length > 0) {
        // `insertManyStream` invokes `onBatchInserted` after persisting the yielded batch and
        // keeps `batchIndex` aligned with iterable emission order, so we can safely join
        // per-batch created-record metadata back onto record-order snapshots here.
        const createdRecordBatches: PendingCreatedRecord[][] = [];
        const createSpan = tracer?.startSpan('teable.PasteHandler.processCreates');
        try {
          const createResult = await handler.tableRecordRepository.insertManyStream(
            context,
            persistedTable,
            handler.createRecordBatchStream(
              context,
              streamState,
              typecast,
              createColumns,
              batchSize,
              createdRecordBatches,
              eventData
            ),
            {
              onBatchInserted: (progress) => {
                const records = createdRecordBatches[progress.batchIndex] ?? [];
                for (const record of records) {
                  eventData.createdRecords.push({
                    recordId: record.recordId,
                    fields: record.fields,
                    orders: progress.recordOrders?.get(record.recordId),
                  });
                }
              },
            }
          );
          if (createResult.isErr()) {
            return err(createResult.error);
          }
        } finally {
          createSpan?.end();
        }
      }

      if (streamState.accumulatedSideEffects.length > 0) {
        // Capture one before/after field snapshot for the entire paste command so undo/redo
        // reverts select-option schema changes atomically even when multiple batches touched
        // the same field.
        const sideEffectUndoRedoPlan =
          await handler.recordWriteUndoRedoPlanService.captureSelectOptionSideEffects(
            context,
            persistedTable,
            streamState.tableForMutations,
            streamState.accumulatedSideEffects
          );
        if (sideEffectUndoRedoPlan.isErr()) {
          return err(sideEffectUndoRedoPlan.error);
        }
        eventData.schemaUndoCommands.push(...sideEffectUndoRedoPlan.value.undoCommands);
        eventData.schemaRedoCommands.push(...sideEffectUndoRedoPlan.value.redoCommands);
      }

      return ok(undefined);
    } finally {
      executeSpan?.end();
    }
  }

  protected async *createResolvedUpdateBatchStream(
    context: ExecutionContextPort.IExecutionContext,
    streamState: PasteOperationStreamState,
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    batchSize: number,
    eventData: CollectedEventData
  ): AsyncGenerator<Result<TableRecordRepositoryPort.UpdateManyStreamBatchInput, DomainError>> {
    while (true) {
      const operationsResult = await this.readNextUpdateChunk(streamState, batchSize);
      if (operationsResult.isErr()) {
        yield err(operationsResult.error);
        return;
      }

      const updateOperations = operationsResult.value;
      if (!updateOperations) {
        return;
      }
      const batchEditableColumns = updateOperations[0]?.editableColumns ?? editableColumns;

      const sideEffectResult = await this.prepareMutationChunk(
        context,
        streamState,
        updateOperations,
        typecast,
        batchEditableColumns,
        eventData
      );
      if (sideEffectResult.isErr()) {
        yield err(sideEffectResult.error);
        return;
      }

      const batchTable = streamState.tableForMutations;
      const resolvedLinkValueMapResult = await this.resolvePasteLinkAutoCreate(
        context,
        typecast,
        batchTable,
        batchEditableColumns,
        updateOperations.map((operation) => operation.rowData),
        streamState.resolvedLinkValues
      );
      if (resolvedLinkValueMapResult.isErr()) {
        yield err(resolvedLinkValueMapResult.error);
        return;
      }
      this.mergeResolvedLinkValues(
        streamState.resolvedLinkValues,
        resolvedLinkValueMapResult.value.resolvedValues
      );
      eventData.tableEvents.push(...resolvedLinkValueMapResult.value.tableEvents);
      eventData.schemaUndoCommands.push(...resolvedLinkValueMapResult.value.undoCommands);
      eventData.schemaRedoCommands.push(...resolvedLinkValueMapResult.value.redoCommands);
      eventData.afterCommitHandlers.push(...resolvedLinkValueMapResult.value.afterCommitHandlers);

      const linkTitleMapResult = typecast
        ? await this.buildLinkTitleMap(context, batchTable, batchEditableColumns, updateOperations)
        : ok(new Map());
      if (linkTitleMapResult.isErr()) {
        yield err(linkTitleMapResult.error);
        return;
      }

      const linkTitleMap = linkTitleMapResult.value;
      const resolvedLinkValueMap = streamState.resolvedLinkValues;
      const updateItems: UpdateRecordItem[] = [];
      const pendingUpdateEvents: PendingUpdateEvent[] = [];

      for (const op of updateOperations) {
        const recordId = RecordId.create(op.existingRecord.id);
        if (recordId.isErr()) {
          yield err(recordId.error);
          return;
        }

        const oldValues = new Map<string, unknown>();
        const fieldValues = this.buildEditableFieldValues(
          op.rowData,
          batchEditableColumns,
          (fieldId, rawValue) => {
            oldValues.set(fieldId, op.existingRecord.fields[fieldId]);
            return this.hydrateLinkValue(
              rawValue,
              linkTitleMap.get(fieldId),
              resolvedLinkValueMap.get(fieldId)
            );
          }
        );

        updateItems.push({ recordId: recordId.value, fieldValues });
        pendingUpdateEvents.push({
          recordId: op.existingRecord.id,
          oldVersion: op.existingRecord.version,
          oldValues,
        });
      }

      let resolvedUpdateIndex = 0;
      for (const batchResult of batchTable.updateRecordsStream(updateItems, { typecast })) {
        if (batchResult.isErr()) {
          yield err(batchResult.error);
          return;
        }

        const resolvedBatchResult = await this.resolveUpdateBatch(
          context,
          batchResult.value,
          typecast
        );
        if (resolvedBatchResult.isErr()) {
          yield err(resolvedBatchResult.error);
          return;
        }

        const resolvedBatch = resolvedBatchResult.value;
        for (const updateResult of resolvedBatch) {
          const pending = pendingUpdateEvents[resolvedUpdateIndex];
          if (!pending) {
            yield err(
              domainError.unexpected({
                code: 'paste.update.event_mismatch',
                message: 'Failed to map paste update event to resolved record update result',
              })
            );
            return;
          }

          const changes: RecordFieldChangeDTO[] = [];
          for (const column of batchEditableColumns) {
            const fieldId = column.fieldId;
            const fieldIdStr = fieldId.toString();
            const newValue = updateResult.record.fields().get(fieldId)?.toValue() ?? null;
            const oldValue = pending.oldValues.get(fieldIdStr);
            if (areRecordFieldValuesEqual(oldValue, newValue)) {
              continue;
            }
            changes.push({ fieldId: fieldIdStr, oldValue, newValue });
          }

          if (changes.length > 0) {
            eventData.updates.push({
              recordId: pending.recordId,
              oldVersion: pending.oldVersion,
              newVersion: pending.oldVersion + 1,
              changes,
            });
          }
          resolvedUpdateIndex += 1;
        }

        yield ok({
          table: batchTable,
          updates: resolvedBatch,
        });
      }
    }
  }

  protected async *createRecordBatchStream(
    context: ExecutionContextPort.IExecutionContext,
    streamState: PasteOperationStreamState,
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    batchSize: number,
    createdRecordBatches: PendingCreatedRecord[][],
    eventData: CollectedEventData
  ): AsyncGenerator<TableRecordRepositoryPort.InsertManyStreamBatchInput> {
    // `insertManyStream` consumes raw batch inputs rather than `Result`-wrapped yields, so
    // create-path failures must throw to abort the stream. The update path can yield `err(...)`
    // because `updateManyStream` accepts `Result` batches directly.
    while (true) {
      const operationsResult = await this.readNextCreateChunk(streamState, batchSize);
      if (operationsResult.isErr()) {
        throw operationsResult.error;
      }

      const createOperations = operationsResult.value;
      if (!createOperations) {
        return;
      }

      const sideEffectResult = await this.prepareMutationChunk(
        context,
        streamState,
        createOperations,
        typecast,
        editableColumns,
        eventData
      );
      if (sideEffectResult.isErr()) {
        throw sideEffectResult.error;
      }

      const batchTable = streamState.tableForMutations;
      const resolvedLinkValueMapResult = await this.resolvePasteLinkAutoCreate(
        context,
        typecast,
        batchTable,
        editableColumns,
        createOperations.map((operation) => operation.rowData),
        streamState.resolvedLinkValues
      );
      if (resolvedLinkValueMapResult.isErr()) {
        throw resolvedLinkValueMapResult.error;
      }
      this.mergeResolvedLinkValues(
        streamState.resolvedLinkValues,
        resolvedLinkValueMapResult.value.resolvedValues
      );
      eventData.tableEvents.push(...resolvedLinkValueMapResult.value.tableEvents);
      eventData.schemaUndoCommands.push(...resolvedLinkValueMapResult.value.undoCommands);
      eventData.schemaRedoCommands.push(...resolvedLinkValueMapResult.value.redoCommands);
      eventData.afterCommitHandlers.push(...resolvedLinkValueMapResult.value.afterCommitHandlers);

      const linkTitleMapResult = typecast
        ? await this.buildLinkTitleMap(context, batchTable, editableColumns, createOperations)
        : ok(new Map());
      if (linkTitleMapResult.isErr()) {
        throw linkTitleMapResult.error;
      }

      const linkTitleMap = linkTitleMapResult.value;
      const resolvedLinkValueMap = streamState.resolvedLinkValues;
      const createFieldValues = createOperations.map((op) =>
        this.buildEditableFieldValues(op.rowData, editableColumns, (fieldId, rawValue) =>
          this.hydrateLinkValue(
            rawValue,
            linkTitleMap.get(fieldId),
            resolvedLinkValueMap.get(fieldId)
          )
        )
      );

      const createResult = batchTable.createRecords(createFieldValues, {
        typecast,
        emitRecordCreatedEvents: false,
      });
      if (createResult.isErr()) {
        throw createResult.error;
      }

      const resolvedRecordsResult = await this.resolveCreatedRecords(
        context,
        createResult.value.records,
        createResult.value.mutateSpecs,
        typecast
      );
      if (resolvedRecordsResult.isErr()) {
        throw resolvedRecordsResult.error;
      }

      const records = resolvedRecordsResult.value;
      createdRecordBatches.push(
        records.map((record) => ({
          recordId: record.id().toString(),
          fields: record
            .fields()
            .entries()
            .map((entry) => ({ fieldId: entry.fieldId.toString(), value: entry.value.toValue() })),
        }))
      );

      yield {
        table: batchTable,
        records,
      };
    }
  }

  protected async resolveUpdateBatch(
    context: ExecutionContextPort.IExecutionContext,
    batch: ReadonlyArray<RecordUpdateResult>,
    typecast: boolean
  ): Promise<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> {
    if (!typecast) {
      return ok(batch);
    }

    const resolveManyResult = await this.recordMutationSpecResolver.resolveAndReplaceMany(
      context,
      batch.map((updateResult) => updateResult.mutateSpec)
    );
    if (resolveManyResult.isErr()) {
      return err(resolveManyResult.error);
    }

    return ok(
      batch.map((updateResult, index) =>
        RecordUpdateResult.create(
          updateResult.record,
          resolveManyResult.value[index] ?? updateResult.mutateSpec,
          updateResult.fieldKeyMapping,
          updateResult.events
        )
      )
    );
  }

  protected async resolveCreatedRecords(
    context: ExecutionContextPort.IExecutionContext,
    records: ReadonlyArray<TableRecord>,
    mutateSpecs: ReadonlyArray<ICellValueSpec | null>,
    typecast: boolean
  ): Promise<Result<ReadonlyArray<TableRecord>, DomainError>> {
    if (!typecast) {
      return ok(records);
    }

    const resolveManyResult = await this.recordMutationSpecResolver.resolveAndReplaceMany(
      context,
      mutateSpecs
    );
    if (resolveManyResult.isErr()) {
      return err(resolveManyResult.error);
    }

    const resolvedRecords: TableRecord[] = [];
    for (let index = 0; index < records.length; index++) {
      let record = records[index]!;
      const mutateSpec = resolveManyResult.value[index] ?? null;
      if (mutateSpec) {
        const mutateResult = mutateSpec.mutate(record);
        if (mutateResult.isErr()) {
          return err(mutateResult.error);
        }
        record = mutateResult.value;
      }
      resolvedRecords.push(record);
    }

    return ok(resolvedRecords);
  }

  protected async readNextUpdateChunk(
    streamState: PasteOperationStreamState,
    batchSize: number
  ): Promise<Result<ReadonlyArray<UpdateOperation> | null, DomainError>> {
    if (streamState.pendingCreateOperation) {
      return ok(null);
    }

    const batch: UpdateOperation[] = [];
    let expectedSignature: string | undefined;

    if (streamState.pendingUpdateOperation) {
      batch.push(streamState.pendingUpdateOperation);
      expectedSignature = this.getEditableColumnSignature(
        streamState.pendingUpdateOperation.editableColumns
      );
      streamState.pendingUpdateOperation = undefined;
    }

    while (batch.length < batchSize) {
      const next = await streamState.iterator.next();
      if (next.done) {
        break;
      }

      if (next.value.isErr()) {
        return err(next.value.error);
      }

      const operation = next.value.value;
      if (operation.type === 'create') {
        streamState.pendingCreateOperation = operation;
        break;
      }

      const signature = this.getEditableColumnSignature(operation.editableColumns);
      if (expectedSignature && signature !== expectedSignature) {
        streamState.pendingUpdateOperation = operation;
        break;
      }

      expectedSignature = signature;
      batch.push(operation);
    }

    return ok(batch.length > 0 ? batch : null);
  }

  protected async readNextCreateChunk(
    streamState: PasteOperationStreamState,
    batchSize: number
  ): Promise<Result<ReadonlyArray<CreateOperation> | null, DomainError>> {
    if (streamState.pendingUpdateOperation) {
      return err(
        domainError.unexpected({
          code: 'paste.create_stream.pending_update',
          message: 'Create stream must not start while update operations are still pending',
        })
      );
    }

    const batch: CreateOperation[] = [];

    if (streamState.pendingCreateOperation) {
      batch.push(streamState.pendingCreateOperation);
      streamState.pendingCreateOperation = undefined;
    }

    while (batch.length < batchSize) {
      const next = await streamState.iterator.next();
      if (next.done) {
        break;
      }

      if (next.value.isErr()) {
        return err(next.value.error);
      }

      const operation = next.value.value;
      if (operation.type === 'update') {
        return err(
          domainError.unexpected({
            code: 'paste.create_stream.unexpected_update',
            message: 'Update operations must not appear after create operations in paste stream',
          })
        );
      }

      batch.push(operation);
    }

    return ok(batch.length > 0 ? batch : null);
  }

  /**
   * Group only contiguous update operations with the same scoped columns. In the worst case,
   * alternating per-record permissions can reduce batching to single-row updates.
   */
  private getEditableColumnSignature(
    editableColumns: ReadonlyArray<EditableColumn> | undefined
  ): string {
    return (editableColumns ?? [])
      .map((column) => `${column.fieldId.toString()}:${column.columnIndex}`)
      .join('|');
  }

  protected async prepareMutationChunk(
    context: ExecutionContextPort.IExecutionContext,
    streamState: PasteOperationStreamState,
    operations: ReadonlyArray<PasteOperation>,
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    eventData: CollectedEventData
  ): Promise<Result<void, DomainError>> {
    if (operations.length === 0) {
      return ok(undefined);
    }

    const currentTable = streamState.tableForMutations;
    const selectOptionFieldValues = operations.map((operation) =>
      this.buildEditableFieldValues(operation.rowData, editableColumns)
    );

    const sideEffectResult = this.recordWriteSideEffectService.execute(
      context,
      currentTable,
      selectOptionFieldValues,
      typecast
    );
    if (sideEffectResult.isErr()) {
      return err(sideEffectResult.error);
    }

    streamState.tableForMutations = sideEffectResult.value.table;
    if (sideEffectResult.value.effects.length > 0) {
      streamState.accumulatedSideEffects.push(...sideEffectResult.value.effects);
    }

    const tableUpdateSpec = sideEffectResult.value.updateResult;
    if (!tableUpdateSpec) {
      return ok(undefined);
    }

    const tableUpdateResult = await this.tableUpdateFlow.execute(
      context,
      { table: currentTable },
      () => ok(tableUpdateSpec),
      { publishEvents: false }
    );
    if (tableUpdateResult.isErr()) {
      return err(tableUpdateResult.error);
    }

    streamState.tableForMutations = tableUpdateResult.value.table;
    eventData.tableEvents.push(...tableUpdateResult.value.events);
    return ok(undefined);
  }

  protected buildEditableFieldValues(
    rowData: ReadonlyArray<unknown>,
    editableColumns: ReadonlyArray<EditableColumn>,
    transform?: (fieldId: string, rawValue: unknown) => unknown
  ): Map<string, unknown> {
    const fieldValues = new Map<string, unknown>();
    for (const column of editableColumns) {
      const fieldId = column.fieldId.toString();
      const rawValue = rowData[column.columnIndex] ?? null;
      fieldValues.set(fieldId, transform ? transform(fieldId, rawValue) : rawValue);
    }
    return fieldValues;
  }

  protected async resolvePasteLinkAutoCreate(
    context: ExecutionContextPort.IExecutionContext,
    typecast: boolean,
    table: Table,
    editableColumns: ReadonlyArray<EditableColumn>,
    rowDataList: ReadonlyArray<ReadonlyArray<unknown>>,
    existingResolvedValues: ResolvedLinkValueLookupMap
  ): Promise<Result<IPasteLinkAutoResolveResult, DomainError>> {
    if (!typecast) {
      return ok(this.createEmptyPasteLinkAutoResolveResult());
    }

    return this.pasteLinkAutoResolveService.resolve(context, {
      table,
      editableColumns,
      rowDataList,
      existingResolvedValues,
    });
  }

  protected createEmptyPasteLinkAutoResolveResult(): IPasteLinkAutoResolveResult {
    return {
      resolvedValues: new Map(),
      tableEvents: [],
      undoCommands: [],
      redoCommands: [],
      afterCommitHandlers: [],
    };
  }

  protected mergeResolvedLinkValues(
    target: ResolvedLinkValueLookupMap,
    source: ResolvedLinkValueLookupMap
  ): void {
    for (const [fieldId, valueMap] of source.entries()) {
      const existing = target.get(fieldId);
      if (existing) {
        valueMap.forEach((value, title) => existing.set(title, value));
      } else {
        target.set(fieldId, new Map(valueMap));
      }
    }
  }

  protected hydrateLinkValue(
    value: unknown,
    linkTitleMap: Map<string, string> | undefined,
    resolvedLinkValueMap?: ResolvedLinkValueMap
  ): unknown {
    if (value == null) {
      return value;
    }

    const hydrateItem = (item: unknown): unknown => {
      if (typeof item === 'string') {
        const normalized = item.trim();
        if (!normalized) {
          return item;
        }
        const resolvedLink = resolvedLinkValueMap?.get(normalized);
        if (resolvedLink) {
          return resolvedLink.title
            ? { id: resolvedLink.id, title: resolvedLink.title }
            : { id: resolvedLink.id };
        }
        if (!normalized.startsWith('rec')) return item;
        const title = linkTitleMap?.get(normalized);
        return title ? { id: normalized, title } : { id: normalized };
      }

      if (typeof item === 'object' && item !== null && 'id' in item) {
        const recordId = String((item as { id?: unknown }).id ?? '');
        const existingTitle = (item as { title?: unknown }).title;
        const title =
          typeof existingTitle === 'string'
            ? existingTitle
            : linkTitleMap?.get(recordId) ?? undefined;
        return title ? { ...(item as Record<string, unknown>), id: recordId, title } : item;
      }

      return item;
    };

    if (typeof value === 'string') {
      const tokens = value
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
      if (tokens.length === 0) {
        return value;
      }
      const hydratedTokens = tokens.map((token) => hydrateItem(token));
      const allResolved = hydratedTokens.every(
        (item) => typeof item === 'object' && item !== null && 'id' in item
      );
      if (!allResolved) {
        return value;
      }
      if (tokens.length === 1) {
        return hydratedTokens[0];
      }
      return hydratedTokens;
    }

    if (Array.isArray(value)) {
      const hydratedItems = value.map((item) => hydrateItem(item));
      const allResolved = hydratedItems.every(
        (item) => typeof item === 'object' && item !== null && 'id' in item
      );
      return allResolved ? hydratedItems : value;
    }

    return hydrateItem(value);
  }

  protected async buildLinkTitleMap(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    editableColumns: ReadonlyArray<EditableColumn>,
    operations: ReadonlyArray<PasteOperation>
  ): Promise<Result<LinkTitleMap, DomainError>> {
    const handler = this;
    const tracer = context.tracer;
    const span = tracer?.startSpan('teable.PasteHandler.buildLinkTitleMap.inner');
    try {
      return await safeTry<LinkTitleMap, DomainError>(async function* () {
        const linkFields = new Map<string, LinkField>();
        for (const column of editableColumns) {
          const fieldResult = table.getField((candidate) => candidate.id().equals(column.fieldId));
          if (fieldResult.isErr()) {
            return err(fieldResult.error);
          }
          const field = fieldResult.value;
          if (field.type().equals(FieldType.link())) {
            linkFields.set(column.fieldId.toString(), field as LinkField);
          }
        }

        if (linkFields.size === 0) {
          return ok(new Map());
        }

        const idsByField = new Map<string, Set<string>>();
        for (const op of operations) {
          for (const column of editableColumns) {
            const fieldIdStr = column.fieldId.toString();
            if (!linkFields.has(fieldIdStr)) continue;
            const ids = handler.extractLinkIds(op.rowData[column.columnIndex]);
            if (ids.length === 0) continue;
            const set = idsByField.get(fieldIdStr) ?? new Set<string>();
            ids.forEach((id) => set.add(id));
            idsByField.set(fieldIdStr, set);
          }
        }

        if (idsByField.size === 0) {
          return ok(new Map());
        }

        const result = new Map<string, Map<string, string>>();

        for (const [fieldId, ids] of idsByField) {
          const linkField = linkFields.get(fieldId);
          if (!linkField) continue;

          const loadForeignSpan = tracer?.startSpan('teable.PasteHandler.loadForeignTable');
          let foreignTable: Table;
          try {
            foreignTable = yield* await handler.tableQueryService.getById(
              context,
              linkField.foreignTableId()
            );
          } finally {
            loadForeignSpan?.end();
          }

          const primaryFieldId = foreignTable.primaryFieldId().toString();

          const validRecordIds: RecordId[] = [];
          for (const rawId of ids) {
            const recordIdResult = RecordId.create(rawId);
            if (recordIdResult.isOk()) {
              validRecordIds.push(recordIdResult.value);
            }
          }

          if (validRecordIds.length === 0) {
            continue;
          }

          const spec = RecordByIdsSpec.create(validRecordIds);

          const loadRecordsSpan = tracer?.startSpan('teable.PasteHandler.loadForeignRecords');
          let recordsResult: TableRecordQueryRepositoryPort.ITableRecordQueryResult;
          try {
            recordsResult = yield* await handler.tableRecordQueryRepository.find(
              context,
              foreignTable,
              spec,
              { mode: 'stored' }
            );
          } finally {
            loadRecordsSpan?.end();
          }

          const idToTitle = new Map<string, string>();
          for (const record of recordsResult.records) {
            if (!ids.has(record.id)) continue;
            const title = record.fields[primaryFieldId];
            if (title !== null && title !== undefined) {
              idToTitle.set(record.id, String(title));
            }
          }

          if (idToTitle.size > 0) {
            result.set(fieldId, idToTitle);
          }
        }

        return ok(result);
      });
    } finally {
      span?.end();
    }
  }

  protected extractLinkIds(value: unknown): string[] {
    if (value == null) return [];

    const values = Array.isArray(value) ? value : [value];
    const ids: string[] = [];

    for (const item of values) {
      if (typeof item === 'string') {
        const tokens = item
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean)
          .filter((token) => token.startsWith('rec'));
        ids.push(...tokens);
        continue;
      }

      if (typeof item === 'object' && item !== null && 'id' in item) {
        const recordId = (item as { id?: unknown }).id;
        if (recordId) {
          ids.push(String(recordId));
        }
      }
    }

    return ids;
  }
}

@injectable()
export class PasteStreamApplicationService extends PasteHandler {
  createStream(
    context: ExecutionContextPort.IExecutionContext,
    command: PasteStreamCommandLike
  ): AsyncIterable<PasteStreamEvent> {
    const queue = new AsyncIterableQueue<PasteStreamEvent>({
      maxBufferedItems: MAX_PASTE_STREAM_BUFFERED_EVENTS,
    });
    void this.runPasteStream(context, command, queue);
    return queue;
  }

  private async runPasteStream(
    context: ExecutionContextPort.IExecutionContext,
    command: PasteStreamCommandLike,
    queue: AsyncIterableQueue<PasteStreamEvent>
  ) {
    queue.push(this.createProgressEvent('preparing', 0, 0, 0, 0, -1, 0));

    try {
      const planResult = await this.preparePasteStreamPlan(context, command);
      if (planResult.isErr()) {
        queue.push(
          this.createErrorEvent(planResult.error, {
            phase: 'preparing',
            batchIndex: -1,
            totalCount: 0,
            processedCount: 0,
            updatedCount: 0,
            createdCount: 0,
            recordIds: [],
          })
        );
        return;
      }

      const plan = planResult.value;
      queue.push(this.createProgressEvent('preparing', plan.totalCount, 0, 0, 0, -1, 0));

      if (!plan.totalCount) {
        queue.push(
          this.createDoneEvent(
            {
              totalCount: 0,
              processedCount: 0,
              updatedCount: 0,
              createdCount: 0,
              createdRecordIds: [],
            },
            0
          )
        );
        return;
      }

      const operationId = context.requestId ?? generateUuid();
      const operationPluginExecutionResult = await this.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.paste,
        executionContext: context,
        table: plan.persistedTable,
        payload: this.buildOperationPastePluginPayload(
          plan.typecast,
          plan.editableColumns,
          plan.totalCount
        ),
        orchestration: {
          mode: 'stream',
          scope: 'operation',
          operationId,
          totalRecordCount: plan.totalCount,
          totalChunkCount: plan.totalChunkCount,
        },
        isTransactionBound: false,
      });
      if (operationPluginExecutionResult.isErr()) {
        queue.push(
          this.createErrorEvent(operationPluginExecutionResult.error, {
            phase: 'guarding',
            batchIndex: -1,
            totalCount: plan.totalCount,
            processedCount: 0,
            updatedCount: 0,
            createdCount: 0,
            recordIds: [],
          })
        );
        return;
      }
      const operationPluginExecution = operationPluginExecutionResult.value;
      const operationGuardResult = await operationPluginExecution.guard();
      if (operationGuardResult.isErr()) {
        queue.push(
          this.createErrorEvent(operationGuardResult.error, {
            phase: 'guarding',
            batchIndex: -1,
            totalCount: plan.totalCount,
            processedCount: 0,
            updatedCount: 0,
            createdCount: 0,
            recordIds: [],
          })
        );
        return;
      }

      let currentTable = plan.tableForPaste;
      let pendingColumnExpansion = plan.plannedColumnExpansion;
      let processedCount = 0;
      let updatedCount = 0;
      let createdCount = 0;
      const createdRecordIds: string[] = [];
      const iterator = plan.operationsStream[Symbol.asyncIterator]();
      let batchIndex = 0;
      let previousPluginExecution = operationPluginExecution;

      for (;;) {
        const chunkResult = await this.readNextOperationChunk(iterator, plan.batchSize);
        if (chunkResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkResult.error, {
              phase: 'pasting',
              batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              updatedCount,
              createdCount,
              recordIds: [],
            })
          );
          break;
        }

        const operations = chunkResult.value;
        if (!operations) {
          break;
        }

        const chunkPluginPayloadResult = this.buildPastePluginPayload(
          plan.typecast,
          plan.editableColumns,
          plan.editableColumns,
          operations.filter(
            (operation): operation is UpdateOperation => operation.type === 'update'
          ),
          operations.filter(
            (operation): operation is CreateOperation => operation.type === 'create'
          )
        );
        if (chunkPluginPayloadResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkPluginPayloadResult.error, {
              phase: 'guarding',
              batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              updatedCount,
              createdCount,
              recordIds: [],
            })
          );
          batchIndex += 1;
          continue;
        }

        const chunkPluginExecutionResult = await this.recordWritePluginRunner.prepare(
          {
            kind: RecordWriteOperationKind.paste,
            executionContext: context,
            table: currentTable,
            payload: chunkPluginPayloadResult.value,
            orchestration: {
              mode: 'stream',
              scope: 'chunk',
              operationId,
              totalRecordCount: plan.totalCount,
              totalChunkCount: plan.totalChunkCount,
              chunkIndex: batchIndex,
            },
            isTransactionBound: false,
          },
          { previousExecution: previousPluginExecution }
        );
        if (chunkPluginExecutionResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkPluginExecutionResult.error, {
              phase: 'guarding',
              batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              updatedCount,
              createdCount,
              recordIds: chunkPluginPayloadResult.value.updateRecordIds.map((recordId) =>
                recordId.toString()
              ),
            })
          );
          batchIndex += 1;
          continue;
        }

        const guardResult = await chunkPluginExecutionResult.value.guard();
        if (guardResult.isErr()) {
          queue.push(
            this.createErrorEvent(guardResult.error, {
              phase: 'guarding',
              batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              updatedCount,
              createdCount,
              recordIds: chunkPluginPayloadResult.value.updateRecordIds.map((recordId) =>
                recordId.toString()
              ),
            })
          );
          batchIndex += 1;
          continue;
        }
        previousPluginExecution = chunkPluginExecutionResult.value;

        const chunkPersistResult = await this.executePasteChunk(context, {
          table: currentTable,
          persistedTable: plan.persistedTable,
          editableColumns: plan.editableColumns,
          operations,
          typecast: plan.typecast,
          pluginExecution: chunkPluginExecutionResult.value,
          batchMutation: {
            operationId,
            groupId: operationId,
            totalRecordCount: plan.totalCount,
            totalChunkCount: plan.totalChunkCount,
            chunkIndex: batchIndex,
            scope: 'chunk',
          },
          plannedColumnExpansion: pendingColumnExpansion,
        });
        if (chunkPersistResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkPersistResult.error, {
              phase: 'pasting',
              batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              updatedCount,
              createdCount,
              recordIds: chunkPluginPayloadResult.value.updateRecordIds.map((recordId) =>
                recordId.toString()
              ),
            })
          );
          batchIndex += 1;
          continue;
        }

        pendingColumnExpansion = undefined;
        currentTable = chunkPersistResult.value.table;
        processedCount += operations.length;
        updatedCount += chunkPersistResult.value.updatedCount;
        createdCount += chunkPersistResult.value.createdCount;
        createdRecordIds.push(...chunkPersistResult.value.createdRecordIds);
        queue.push(
          this.createProgressEvent(
            'pasting',
            plan.totalCount,
            processedCount,
            updatedCount,
            createdCount,
            batchIndex,
            operations.length
          )
        );

        const publishResult = await this.publishPasteChunkEvents(
          context,
          plan.persistedTable,
          chunkPersistResult.value.eventData,
          {
            operationId,
            totalRecordCount: plan.totalCount,
            totalChunkCount: plan.totalChunkCount,
            chunkIndex: batchIndex,
          }
        );
        if (publishResult.isErr()) {
          queue.push(
            this.createErrorEvent(publishResult.error, {
              phase: 'publishing',
              batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              updatedCount,
              createdCount,
              recordIds: [],
            })
          );
        }

        const undoRedoResult = await this.recordPasteChunkUndoRedoEntry(
          context,
          plan.persistedTable,
          chunkPersistResult.value.eventData,
          operationId
        );
        if (undoRedoResult.isErr()) {
          queue.push(
            this.createErrorEvent(undoRedoResult.error, {
              phase: 'finalizing',
              batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              updatedCount,
              createdCount,
              recordIds: [],
            })
          );
        }

        await chunkPluginExecutionResult.value.afterCommit();
        for (const afterCommitHandler of chunkPersistResult.value.eventData.afterCommitHandlers) {
          await afterCommitHandler();
        }
        batchIndex += 1;
      }

      queue.push(
        this.createDoneEvent(
          {
            totalCount: plan.totalCount,
            processedCount,
            updatedCount,
            createdCount,
            createdRecordIds,
          },
          plan.totalCount
        )
      );
    } catch (error) {
      queue.push(
        this.createErrorEvent(
          domainError.fromUnknown(error, {
            code: 'paste_stream.failed',
          }),
          {
            phase: 'pasting',
            batchIndex: -1,
            totalCount: 0,
            processedCount: 0,
            updatedCount: 0,
            createdCount: 0,
            recordIds: [],
          }
        )
      );
    } finally {
      queue.close();
    }
  }

  private async preparePasteStreamPlan(
    context: ExecutionContextPort.IExecutionContext,
    command: PasteStreamCommandLike
  ): Promise<Result<PreparedPasteStreamPlan, DomainError>> {
    const persistedTableResult = await this.tableQueryService.getById(context, command.tableId);
    if (persistedTableResult.isErr()) {
      return err(persistedTableResult.error);
    }
    const persistedTable = persistedTableResult.value;
    let tableForPaste = persistedTable;

    let orderedFieldIds = await persistedTable.getOrderedVisibleFieldIds(
      command.viewId.toString(),
      {
        projection: command.projection,
      }
    );
    if (orderedFieldIds.isErr()) {
      return err(orderedFieldIds.error);
    }

    const viewResult = await persistedTable.getView(command.viewId);
    if (viewResult.isErr()) {
      return err(viewResult.error);
    }
    const viewDefaultsResult = await viewResult.value.queryDefaults();
    if (viewDefaultsResult.isErr()) {
      return err(viewDefaultsResult.error);
    }

    const mergedDefaults = viewDefaultsResult.value.merge({
      filter: command.filter,
      sort: command.sort,
      group: command.groupBy,
    });
    const effectiveFilter = command.ignoreViewQuery
      ? command.filter ?? undefined
      : mergedDefaults.filter();
    const effectiveSort = command.ignoreViewQuery
      ? command.sort ?? undefined
      : mergedDefaults.sort();

    const filterSpecResult = await buildSanitizedRecordConditionSpec(
      persistedTable,
      effectiveFilter
    );
    if (filterSpecResult.isErr()) {
      return err(filterSpecResult.error);
    }
    const filterSpec = filterSpecResult.value;

    const visibleRowSearch = resolveVisibleRowSearch(command.search, orderedFieldIds.value);

    let totalRows = 0;
    if (command.rangeType === 'columns' || command.rangeType === 'rows') {
      const limitResult = PageLimit.create(1);
      if (limitResult.isOk()) {
        const pagination = OffsetPagination.create(limitResult.value, PageOffset.zero());
        const countResult = await this.tableRecordQueryRepository.find(
          context,
          persistedTable,
          filterSpec,
          { mode: 'stored', pagination, search: visibleRowSearch }
        );
        if (countResult.isErr()) {
          return err(countResult.error);
        }
        totalRows = countResult.value.total;
      }
    }

    const normalizedRanges = command.normalizeRanges(totalRows, orderedFieldIds.value.length);
    const [[startCol, startRow], [endCol, endRow]] = normalizedRanges;
    const targetRangeCols = endCol - startCol + 1;
    const targetRangeRows = endRow - startRow + 1;
    const expandedContent = expandPasteContent(command.content, targetRangeRows, targetRangeCols);

    if (expandedContent.length === 0 || expandedContent[0]?.length === 0) {
      return ok({
        persistedTable,
        tableForPaste,
        editableColumns: [],
        typecast: command.typecast,
        operationsStream: createEmptyPasteOperationStream(),
        totalCount: 0,
        totalChunkCount: 0,
        batchSize: command.batchSize ?? 1,
      });
    }

    const expandedColCount = expandedContent[0]!.length;
    const numColsToExpand = Math.max(0, startCol + expandedColCount - orderedFieldIds.value.length);
    let plannedColumnExpansion: PlannedColumnExpansion | undefined;
    if (numColsToExpand > 0) {
      const expandResult = await this.planColumnExpansion(context, persistedTable, {
        numColsToExpand,
        sourceFields: command.sourceFields,
      });
      if (expandResult.isErr()) {
        return err(expandResult.error);
      }
      plannedColumnExpansion = expandResult.value;
      tableForPaste = expandResult.value.table;
      if (plannedColumnExpansion.newFieldIds.length > 0) {
        orderedFieldIds = ok([...orderedFieldIds.value, ...plannedColumnExpansion.newFieldIds]);
      }
    }

    const targetFieldIds = orderedFieldIds.value.slice(startCol, startCol + expandedColCount);
    const editableColumns: EditableColumn[] = [];
    targetFieldIds.forEach((fieldId, columnIndex) => {
      const fieldResult = tableForPaste.getField((f) => f.id().equals(fieldId));
      if (fieldResult.isOk() && !fieldResult.value.computed().toBoolean()) {
        editableColumns.push({ fieldId, columnIndex });
      }
    });

    const effectiveGroup = command.ignoreViewQuery
      ? command.groupBy ?? undefined
      : mergedDefaults.group();
    const groupByOrderByResult = await resolveGroupByToOrderBy(effectiveGroup);
    if (groupByOrderByResult.isErr()) {
      return err(groupByOrderByResult.error);
    }
    const sortOrderByResult = await resolveOrderBy(effectiveSort);
    if (sortOrderByResult.isErr()) {
      return err(sortOrderByResult.error);
    }
    const orderBy = mergeOrderByWithViewRowTieBreaker(
      groupByOrderByResult.value,
      sortOrderByResult.value,
      command.viewId.toString()
    );

    let updateFilterSpec:
      | ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
      | undefined = undefined;
    if (command.updateFilter) {
      const updateFilterSpecResult = await buildRecordConditionSpec(
        persistedTable,
        command.updateFilter
      );
      if (updateFilterSpecResult.isErr()) {
        return err(updateFilterSpecResult.error);
      }
      updateFilterSpec = updateFilterSpecResult.value;
    }

    const existingRecordsStream = this.tableRecordQueryRepository.findStream(
      context,
      persistedTable,
      filterSpec,
      {
        mode: 'stored',
        pagination: {
          offset: startRow,
          limit: expandedContent.length,
        },
        orderBy,
        search: visibleRowSearch,
      }
    );

    const operationsStream = this.generatePasteOperations(
      existingRecordsStream,
      expandedContent,
      persistedTable,
      updateFilterSpec
    );
    const collectedOperations = await this.collectPasteOperations(operationsStream);
    if (collectedOperations.isErr()) {
      return err(collectedOperations.error);
    }

    const batchSize = resolveSelectionStreamBatchSize(expandedContent.length, command.batchSize);

    return ok({
      persistedTable,
      tableForPaste,
      editableColumns,
      plannedColumnExpansion,
      typecast: command.typecast,
      operationsStream: createPasteOperationStream([
        ...collectedOperations.value.updateOperations,
        ...collectedOperations.value.createOperations,
      ]),
      totalCount: expandedContent.length,
      totalChunkCount: Math.max(1, Math.ceil(expandedContent.length / batchSize)),
      batchSize,
    });
  }

  private buildOperationPastePluginPayload(
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    totalCount: number
  ) {
    return {
      editableFieldIds: editableColumns.map((column) => column.fieldId),
      updateRecordIds: [] as RecordId[],
      updateRecordsFieldValues: [] as ReadonlyMap<string, unknown>[],
      createRecordsFieldValues: [] as ReadonlyMap<string, unknown>[],
      typecast,
      updateRecordCount: 0,
      createRecordCount: totalCount,
      recordCount: totalCount,
    };
  }

  private async readNextOperationChunk(
    iterator: AsyncIterator<Result<PasteOperation, DomainError>>,
    batchSize: number
  ): Promise<Result<ReadonlyArray<PasteOperation> | null, DomainError>> {
    const operations: PasteOperation[] = [];

    while (operations.length < batchSize) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }

      if (next.value.isErr()) {
        return err(next.value.error);
      }

      operations.push(next.value.value);
    }

    return ok(operations.length ? operations : null);
  }

  private async executePasteChunk(
    context: ExecutionContextPort.IExecutionContext,
    params: {
      table: Table;
      persistedTable: Table;
      editableColumns: ReadonlyArray<EditableColumn>;
      operations: ReadonlyArray<PasteOperation>;
      typecast: boolean;
      pluginExecution: RecordWritePluginExecution;
      batchMutation: ExecutionContextPort.IExecutionContextBatchMutation;
      plannedColumnExpansion?: PlannedColumnExpansion;
    }
  ): Promise<Result<PasteChunkPersistResult, DomainError>> {
    const chunkEventData: CollectedEventData = {
      tableEvents: [],
      updates: [],
      createdRecords: [],
      updatedCount: 0,
      schemaUndoCommands: [],
      schemaRedoCommands: [],
      afterCommitHandlers: [],
    };

    let nextTable = params.table;
    const persistResult = await this.unitOfWork.withTransaction(context, async (txContext) => {
      const txContextWithBatchMutation = withBatchMutation(txContext, params.batchMutation);
      const beforePersistResult = await params.pluginExecution.beforePersist(
        txContextWithBatchMutation
      );
      if (beforePersistResult.isErr()) {
        return err(beforePersistResult.error);
      }

      let tableForChunk = params.table;
      if (params.plannedColumnExpansion) {
        const columnExpansionResult = await params.plannedColumnExpansion.apply(
          txContextWithBatchMutation
        );
        if (columnExpansionResult.isErr()) {
          return err(columnExpansionResult.error);
        }
        tableForChunk = columnExpansionResult.value.table;
        chunkEventData.tableEvents.push(
          ...columnExpansionResult.value.events,
          ...columnExpansionResult.value.postPersistEvents
        );
        const fieldExpansionUndoRedoPlan =
          await this.recordWriteUndoRedoPlanService.captureCreatedFields(
            txContextWithBatchMutation,
            tableForChunk,
            params.plannedColumnExpansion.newFieldIds
          );
        if (fieldExpansionUndoRedoPlan.isErr()) {
          return err(fieldExpansionUndoRedoPlan.error);
        }
        chunkEventData.schemaUndoCommands.push(...fieldExpansionUndoRedoPlan.value.undoCommands);
        chunkEventData.schemaRedoCommands.push(...fieldExpansionUndoRedoPlan.value.redoCommands);
      }

      const streamState: PasteOperationStreamState = {
        iterator: (async function* () {
          for (const operation of params.operations) {
            yield ok(operation);
          }
        })()[Symbol.asyncIterator](),
        tableForMutations: tableForChunk,
        accumulatedSideEffects: [],
        resolvedLinkValues: new Map(),
      };

      const hasUpdates = params.operations.some((operation) => operation.type === 'update');
      const hasCreates = params.operations.some((operation) => operation.type === 'create');

      if (hasUpdates) {
        const updateResult = await this.tableRecordRepository.updateManyStream(
          txContextWithBatchMutation,
          streamState.tableForMutations,
          this.createResolvedUpdateBatchStream(
            txContextWithBatchMutation,
            streamState,
            params.typecast,
            params.editableColumns,
            params.operations.length,
            chunkEventData
          )
        );
        if (updateResult.isErr()) {
          return err(updateResult.error);
        }
        chunkEventData.updatedCount = updateResult.value.totalUpdated;
        this.reconcilePersistedUpdateEvents(chunkEventData, updateResult.value);
      }

      if (hasCreates) {
        const createdRecordBatches: PendingCreatedRecord[][] = [];
        const createResult = await this.tableRecordRepository.insertManyStream(
          txContextWithBatchMutation,
          streamState.tableForMutations,
          this.createRecordBatchStream(
            txContextWithBatchMutation,
            streamState,
            params.typecast,
            params.editableColumns,
            params.operations.length,
            createdRecordBatches,
            chunkEventData
          ),
          {
            onBatchInserted: (progress) => {
              const records = createdRecordBatches[progress.batchIndex] ?? [];
              for (const record of records) {
                chunkEventData.createdRecords.push({
                  recordId: record.recordId,
                  fields: record.fields,
                  orders: progress.recordOrders?.get(record.recordId),
                });
              }
            },
          }
        );
        if (createResult.isErr()) {
          return err(createResult.error);
        }
      }

      if (streamState.accumulatedSideEffects.length > 0) {
        const sideEffectUndoRedoPlan =
          await this.recordWriteUndoRedoPlanService.captureSelectOptionSideEffects(
            txContextWithBatchMutation,
            tableForChunk,
            streamState.tableForMutations,
            streamState.accumulatedSideEffects
          );
        if (sideEffectUndoRedoPlan.isErr()) {
          return err(sideEffectUndoRedoPlan.error);
        }
        chunkEventData.schemaUndoCommands.push(...sideEffectUndoRedoPlan.value.undoCommands);
        chunkEventData.schemaRedoCommands.push(...sideEffectUndoRedoPlan.value.redoCommands);
      }

      nextTable = streamState.tableForMutations;
      return ok(undefined);
    });
    if (persistResult.isErr()) {
      return err(persistResult.error);
    }

    return ok({
      table: nextTable,
      eventData: chunkEventData,
      updatedCount: chunkEventData.updatedCount,
      createdCount: chunkEventData.createdRecords.length,
      createdRecordIds: chunkEventData.createdRecords.map((record) => record.recordId),
    });
  }

  private async publishPasteChunkEvents(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    eventData: CollectedEventData,
    orchestration: {
      operationId: string;
      totalRecordCount: number;
      totalChunkCount: number;
      chunkIndex: number;
    }
  ): Promise<Result<void, DomainError>> {
    const events: IDomainEvent[] = [...eventData.tableEvents];

    if (eventData.updates.length > 0) {
      events.push(
        RecordsBatchUpdated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          updates: eventData.updates,
          source: 'user',
          orchestration: {
            operationId: orchestration.operationId,
            groupId: orchestration.operationId,
            totalRecordCount: orchestration.totalRecordCount,
            totalChunkCount: orchestration.totalChunkCount,
            chunkIndex: orchestration.chunkIndex,
            scope: 'chunk',
          },
        })
      );
    }

    if (eventData.createdRecords.length > 0) {
      events.push(
        RecordsBatchCreated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          records: eventData.createdRecords,
          orchestration: {
            operationId: orchestration.operationId,
            groupId: orchestration.operationId,
            totalRecordCount: orchestration.totalRecordCount,
            totalChunkCount: orchestration.totalChunkCount,
            chunkIndex: orchestration.chunkIndex,
            scope: 'chunk',
          },
        })
      );
    }

    if (!events.length) {
      return ok(undefined);
    }

    return this.eventBus.publishMany(context, events);
  }

  private async recordPasteChunkUndoRedoEntry(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    eventData: CollectedEventData,
    groupId: string
  ): Promise<Result<void, DomainError>> {
    const undoCommands: UndoRedoCommandLeafData[] = [];
    const redoCommands: UndoRedoCommandLeafData[] = [];

    if (eventData.createdRecords.length > 0) {
      undoCommands.push(
        createUndoRedoCommand('DeleteRecords', {
          tableId: table.id().toString(),
          recordIds: eventData.createdRecords.map((record) => record.recordId),
        })
      );

      redoCommands.push(
        createUndoRedoCommand('RestoreRecords', {
          tableId: table.id().toString(),
          records: eventData.createdRecords.map((record) => {
            const fields: Record<string, unknown> = {};
            for (const field of record.fields) {
              fields[field.fieldId] = field.value;
            }

            return {
              recordId: record.recordId,
              fields,
              orders: record.orders,
            };
          }),
        })
      );
    }

    for (const update of eventData.updates) {
      const oldFields: Record<string, unknown> = {};
      const newFields: Record<string, unknown> = {};
      for (const change of update.changes) {
        oldFields[change.fieldId] = change.oldValue;
        newFields[change.fieldId] = change.newValue;
      }

      undoCommands.push(
        createUndoRedoCommand('UpdateRecord', {
          tableId: table.id().toString(),
          recordId: update.recordId,
          fields: oldFields,
          fieldKeyType: 'id',
          typecast: false,
        })
      );
      redoCommands.push(
        createUndoRedoCommand('UpdateRecord', {
          tableId: table.id().toString(),
          recordId: update.recordId,
          fields: newFields,
          fieldKeyType: 'id',
          typecast: false,
        })
      );
    }

    if (
      !undoCommands.length &&
      !redoCommands.length &&
      !eventData.schemaUndoCommands.length &&
      !eventData.schemaRedoCommands.length
    ) {
      return ok(undefined);
    }

    return this.undoRedoStackService.appendEntry(
      toUndoRedoStackAppendContext(context),
      table.id(),
      {
        groupId,
        undoCommand: composeUndoRedoCommands([...undoCommands, ...eventData.schemaUndoCommands]),
        redoCommand: composeUndoRedoCommands([...eventData.schemaRedoCommands, ...redoCommands]),
      }
    );
  }

  private createProgressEvent(
    phase: PasteStreamProgressEvent['phase'],
    totalCount: number,
    processedCount: number,
    updatedCount: number,
    createdCount: number,
    batchIndex: number,
    batchProcessedCount: number
  ): PasteStreamProgressEvent {
    return {
      id: 'progress',
      phase,
      batchIndex,
      totalCount,
      processedCount,
      updatedCount,
      createdCount,
      batchProcessedCount,
    };
  }

  private createDoneEvent(
    summary: {
      totalCount: number;
      processedCount: number;
      updatedCount: number;
      createdCount: number;
      createdRecordIds: string[];
    },
    totalCount: number
  ): PasteStreamDoneEvent {
    return {
      id: 'done',
      totalCount,
      processedCount: summary.processedCount,
      updatedCount: summary.updatedCount,
      createdCount: summary.createdCount,
      data: {
        updatedCount: summary.updatedCount,
        createdCount: summary.createdCount,
        createdRecordIds: summary.createdRecordIds,
      },
    };
  }

  private createErrorEvent(
    error: DomainError,
    summary: {
      phase: PasteStreamErrorEvent['phase'];
      batchIndex: number;
      totalCount: number;
      processedCount: number;
      updatedCount: number;
      createdCount: number;
      recordIds: string[];
    }
  ): PasteStreamErrorEvent {
    return {
      id: 'error',
      phase: summary.phase,
      batchIndex: summary.batchIndex,
      totalCount: summary.totalCount,
      processedCount: summary.processedCount,
      updatedCount: summary.updatedCount,
      createdCount: summary.createdCount,
      recordIds: summary.recordIds,
      message: error.message,
      code: error.code,
    };
  }
}

/**
 * Expand paste content to fill the target range.
 *
 * If the selection range is an exact multiple of the paste content dimensions,
 * the content is automatically tiled to fill the entire range.
 */
function expandPasteContent(
  content: ReadonlyArray<ReadonlyArray<unknown>>,
  targetRows: number,
  targetCols: number
): ReadonlyArray<ReadonlyArray<unknown>> {
  if (content.length === 0 || content[0]?.length === 0) {
    return content;
  }

  const contentRows = content.length;
  const contentCols = content[0]!.length;

  if (targetRows === contentRows && targetCols === contentCols) {
    return content;
  }

  if (targetRows % contentRows !== 0 || targetCols % contentCols !== 0) {
    return content;
  }

  return Array.from({ length: targetRows }, (_, rowIdx) =>
    Array.from(
      { length: targetCols },
      (_, colIdx) => content[rowIdx % contentRows]![colIdx % contentCols]
    )
  );
}

async function* createEmptyPasteOperationStream(): AsyncIterable<
  Result<PasteOperation, DomainError>
> {
  yield* [];
}

async function* createPasteOperationStream(
  operations: ReadonlyArray<PasteOperation>
): AsyncIterable<Result<PasteOperation, DomainError>> {
  for (const operation of operations) {
    yield ok(operation);
  }
}
