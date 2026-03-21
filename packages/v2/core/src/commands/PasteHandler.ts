/* eslint-disable no-inner-declarations */
import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import {
  type RecordWritePluginExecution,
  RecordWritePluginRunner,
} from '../application/services/RecordWritePluginRunner';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UndoRedoService } from '../application/services/UndoRedoService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
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
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
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
import { buildRecordConditionSpec } from '../queries/RecordFilterMapper';
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
import type { SourceFieldMeta } from './PasteCommand';
import {
  mergeOrderByWithViewRowTieBreaker,
  resolveGroupByToOrderBy,
  resolveOrderBy,
} from './shared/orderBy';
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
  schemaUndoCommands: UndoRedoCommandLeafData[];
  schemaRedoCommands: UndoRedoCommandLeafData[];
}

interface CollectedPasteOperations {
  updateOperations: UpdateOperation[];
  createOperations: CreateOperation[];
}

/** Represents an update operation for an existing record */
interface UpdateOperation {
  type: 'update';
  existingRecord: TableRecordReadModel;
  rowData: ReadonlyArray<unknown>;
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
  pendingCreateOperation?: CreateOperation;
  tableForMutations: Table;
  accumulatedSideEffects: RecordWriteSideEffect[];
};

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
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.recordWriteUndoRedoPlanService)
    private readonly recordWriteUndoRedoPlanService: RecordWriteUndoRedoPlanService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
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
    command: PasteCommand
  ): Promise<Result<PasteResult, DomainError>> {
    const handler = this;

    return safeTry<PasteResult, DomainError>(async function* () {
      // 1. Get table
      let table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // 2. Get ordered visible field IDs from view's columnMeta or projection
      let orderedFieldIds = yield* table.getOrderedVisibleFieldIds(command.viewId.toString(), {
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
      const effectiveFilter = command.ignoreViewQuery
        ? command.filter ?? undefined
        : mergedDefaults.filter();
      const effectiveSort = command.ignoreViewQuery
        ? command.sort ?? undefined
        : mergedDefaults.sort();

      // 3. Build filter spec from effective view filter. Search-aware visible rows are handled
      // by the query repository so field-type-specific search semantics stay centralized.
      let filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined =
        undefined;
      if (effectiveFilter) {
        filterSpec = yield* buildRecordConditionSpec(table, effectiveFilter);
      }
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
            table,
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

      // 7. Expand columns if paste exceeds current field count
      const expandedColCount = expandedContent[0]!.length;
      const numColsToExpand = Math.max(0, startCol + expandedColCount - totalCols);
      if (numColsToExpand > 0) {
        const expandResult = yield* await handler.expandColumns(context, table, {
          numColsToExpand,
          sourceFields: command.sourceFields,
        });
        table = expandResult.table;
        if (expandResult.newFieldIds.length > 0) {
          orderedFieldIds = [...orderedFieldIds, ...expandResult.newFieldIds];
        }
      }

      // 8. Calculate target fields based on expanded content
      const targetFieldIds = orderedFieldIds.slice(startCol, startCol + expandedColCount);

      // 9. Filter out computed fields while preserving column indices
      const editableColumns: EditableColumn[] = [];
      targetFieldIds.forEach((fieldId, columnIndex) => {
        const fieldResult = table.getField((f) => f.id().equals(fieldId));
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
        table,
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
        updateFilterSpec = yield* buildRecordConditionSpec(table, command.updateFilter);
      }

      // 11. Generate paste operations by streaming through existing records
      const operationsStream = handler.generatePasteOperations(
        existingRecordsStream,
        expandedContent,
        table,
        updateFilterSpec
      );
      const collectedOperations = yield* await handler.collectPasteOperations(operationsStream);
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.paste,
        executionContext: context,
        table,
        payload: yield* handler.buildPastePluginPayload(
          command.typecast,
          editableColumns,
          collectedOperations.updateOperations,
          collectedOperations.createOperations
        ),
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      // 12. Execute paste within transaction
      const eventData: CollectedEventData = {
        tableEvents: [],
        updates: [],
        createdRecords: [],
        schemaUndoCommands: [],
        schemaRedoCommands: [],
      };

      yield* await handler.unitOfWork.withTransaction(context, async (txContext) => {
        return handler.executePasteStream(
          txContext,
          table,
          collectedOperations.updateOperations,
          collectedOperations.createOperations,
          pluginExecution,
          command.typecast,
          editableColumns,
          eventData
        );
      });

      // 13. Publish events AFTER transaction commits
      const events: IDomainEvent[] = [...eventData.tableEvents];

      if (eventData.updates.length > 0) {
        events.push(
          RecordsBatchUpdated.create({
            tableId: table.id(),
            baseId: table.baseId(),
            updates: eventData.updates,
            source: 'user',
          })
        );
      }

      if (eventData.createdRecords.length > 0) {
        events.push(
          RecordsBatchCreated.create({
            tableId: table.id(),
            baseId: table.baseId(),
            records: eventData.createdRecords,
          })
        );
      }

      if (events.length > 0) {
        yield* await handler.eventBus.publishMany(context, events);
      }

      const buildUpdateCommand = (recordId: string, fields: Record<string, unknown>) =>
        createUndoRedoCommand('UpdateRecord', {
          tableId: table.id().toString(),
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
            tableId: table.id().toString(),
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
            tableId: table.id().toString(),
            records: restoreRecords,
          })
        );
      }

      if (undoCommands.length > 0 || redoCommands.length > 0) {
        yield* await handler.undoRedoService.recordEntry(context, table.id(), {
          undoCommand: composeUndoRedoCommands([...undoCommands, ...eventData.schemaUndoCommands]),
          redoCommand: composeUndoRedoCommands([...eventData.schemaRedoCommands, ...redoCommands]),
        });
      }
      await pluginExecution.afterCommit();

      return ok({
        updatedCount: eventData.updates.length,
        createdCount: eventData.createdRecords.length,
        createdRecordIds: eventData.createdRecords.map((r) => r.recordId),
      });
    });
  }

  private async expandColumns(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    params: {
      numColsToExpand: number;
      sourceFields?: ReadonlyArray<SourceFieldMeta>;
    }
  ): Promise<Result<{ table: Table; newFieldIds: FieldId[] }, DomainError>> {
    const { numColsToExpand, sourceFields } = params;
    if (numColsToExpand <= 0) {
      return ok({ table, newFieldIds: [] });
    }

    const headerFields = sourceFields ?? [];
    const startIndex = Math.max(0, headerFields.length - numColsToExpand);
    const fieldInputs: ITableFieldInput[] = Array.from({ length: numColsToExpand }, (_, index) =>
      this.sourceFieldToInput(headerFields[startIndex + index])
    );

    const handler = this;
    return safeTry<{ table: Table; newFieldIds: FieldId[] }, DomainError>(async function* () {
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

      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { table },
        (current) =>
          current.update((mutator) => {
            let next = mutator;
            for (const field of createdFields) {
              next = next.addField(field, { foreignTables });
            }
            return next;
          }),
        {
          hooks: {
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                if (createdFields.length === 0) return ok([]);
                const sideEffectResult =
                  yield* await handler.fieldCreationSideEffectService.execute(transactionContext, {
                    table: updatedTable,
                    fields: createdFields,
                    foreignTables,
                  });
                return ok(sideEffectResult.events);
              }),
          },
        }
      );

      return ok({
        table: updateResult.table,
        newFieldIds: createdFields.map((field) => field.id()),
      });
    });
  }

  private sourceFieldToInput(field?: SourceFieldMeta): ITableFieldInput {
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

  private optionsRoToVoByCvType(
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

  private lookupOptionsRoToVo(field?: SourceFieldMeta): LooseFieldInput {
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
  private async *generatePasteOperations(
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

  private async collectPasteOperations(
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

  private buildPastePluginPayload(
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
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
      updateRecordsFieldValues.push(this.rowDataToFieldValues(operation.rowData, editableColumns));
    }

    return ok({
      editableFieldIds: editableColumns.map((column) => column.fieldId),
      updateRecordIds,
      updateRecordsFieldValues,
      createRecordsFieldValues: createOperations.map((operation) =>
        this.rowDataToFieldValues(operation.rowData, editableColumns)
      ),
      typecast,
      updateRecordCount: updateOperations.length,
      createRecordCount: createOperations.length,
      recordCount: updateOperations.length + createOperations.length,
    });
  }

  private rowDataToFieldValues(
    rowData: ReadonlyArray<unknown>,
    editableColumns: ReadonlyArray<EditableColumn>
  ): ReadonlyMap<string, unknown> {
    const fieldValues = new Map<string, unknown>();
    for (const column of editableColumns) {
      fieldValues.set(column.fieldId.toString(), rowData[column.columnIndex] ?? null);
    }
    return fieldValues;
  }

  /**
   * Execute paste operations using streaming.
   * Consumes update/create operations lazily and only keeps the current batch in memory.
   */
  private async executePasteStream(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    updateOperations: ReadonlyArray<UpdateOperation>,
    createOperations: ReadonlyArray<CreateOperation>,
    pluginExecution: RecordWritePluginExecution,
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    eventData: CollectedEventData
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
      };

      const beforePersistResult = await pluginExecution.beforePersist(context);
      if (beforePersistResult.isErr()) {
        return err(beforePersistResult.error);
      }

      if (updateOperations.length > 0) {
        const updateSpan = tracer?.startSpan('teable.PasteHandler.processUpdates');
        try {
          const updateResult = await handler.tableRecordRepository.updateManyStream(
            context,
            table,
            handler.createResolvedUpdateBatchStream(
              context,
              streamState,
              typecast,
              editableColumns,
              batchSize,
              eventData
            )
          );
          if (updateResult.isErr()) {
            return err(updateResult.error);
          }
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
            table,
            handler.createRecordBatchStream(
              context,
              streamState,
              typecast,
              editableColumns,
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
            table,
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

  private async *createResolvedUpdateBatchStream(
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

      const sideEffectResult = await this.prepareMutationChunk(
        context,
        streamState,
        updateOperations,
        typecast,
        editableColumns,
        eventData
      );
      if (sideEffectResult.isErr()) {
        yield err(sideEffectResult.error);
        return;
      }

      const batchTable = streamState.tableForMutations;
      const linkTitleMapResult = typecast
        ? await this.buildLinkTitleMap(context, batchTable, editableColumns, updateOperations)
        : ok(new Map());
      if (linkTitleMapResult.isErr()) {
        yield err(linkTitleMapResult.error);
        return;
      }

      const linkTitleMap = linkTitleMapResult.value;
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
          editableColumns,
          (fieldId, rawValue) => {
            oldValues.set(fieldId, op.existingRecord.fields[fieldId]);
            return this.hydrateLinkValue(rawValue, linkTitleMap.get(fieldId));
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

          const changes: RecordFieldChangeDTO[] = editableColumns.map((column) => {
            const fieldId = column.fieldId;
            const fieldIdStr = fieldId.toString();
            const newValue = updateResult.record.fields().get(fieldId)?.toValue() ?? null;
            const oldValue = pending.oldValues.get(fieldIdStr);
            return { fieldId: fieldIdStr, oldValue, newValue };
          });

          eventData.updates.push({
            recordId: pending.recordId,
            oldVersion: pending.oldVersion,
            newVersion: pending.oldVersion + 1,
            changes,
          });
          resolvedUpdateIndex += 1;
        }

        yield ok({
          table: batchTable,
          updates: resolvedBatch,
        });
      }
    }
  }

  private async *createRecordBatchStream(
    context: ExecutionContextPort.IExecutionContext,
    streamState: PasteOperationStreamState,
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    batchSize: number,
    createdRecordBatches: PendingCreatedRecord[][],
    eventData: CollectedEventData
  ): AsyncGenerator<TableRecordRepositoryPort.InsertManyStreamBatchInput> {
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
      const linkTitleMapResult = typecast
        ? await this.buildLinkTitleMap(context, batchTable, editableColumns, createOperations)
        : ok(new Map());
      if (linkTitleMapResult.isErr()) {
        throw linkTitleMapResult.error;
      }

      const linkTitleMap = linkTitleMapResult.value;
      const createFieldValues = createOperations.map((op) =>
        this.buildEditableFieldValues(op.rowData, editableColumns, (fieldId, rawValue) =>
          this.hydrateLinkValue(rawValue, linkTitleMap.get(fieldId))
        )
      );

      const createResult = batchTable.createRecords(createFieldValues, { typecast });
      if (createResult.isErr()) {
        throw createResult.error;
      }
      // `createRecords` emits per-record RecordCreated events on the aggregate root. Paste
      // replaces those with a single RecordsBatchCreated event after persistence, so discard
      // the per-record aggregate events here to avoid duplicate publication and linear growth.
      batchTable.pullDomainEvents();

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

  private async resolveUpdateBatch(
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

  private async resolveCreatedRecords(
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

  private async readNextUpdateChunk(
    streamState: PasteOperationStreamState,
    batchSize: number
  ): Promise<Result<ReadonlyArray<UpdateOperation> | null, DomainError>> {
    if (streamState.pendingCreateOperation) {
      return ok(null);
    }

    const batch: UpdateOperation[] = [];

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

      batch.push(operation);
    }

    return ok(batch.length > 0 ? batch : null);
  }

  private async readNextCreateChunk(
    streamState: PasteOperationStreamState,
    batchSize: number
  ): Promise<Result<ReadonlyArray<CreateOperation> | null, DomainError>> {
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

  private async prepareMutationChunk(
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

  private buildEditableFieldValues(
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

  private hydrateLinkValue(value: unknown, linkTitleMap: Map<string, string> | undefined): unknown {
    if (!linkTitleMap || linkTitleMap.size === 0) {
      return value;
    }

    if (value == null) {
      return value;
    }

    const hydrateItem = (item: unknown): unknown => {
      if (typeof item === 'string') {
        if (!item.startsWith('rec')) return item;
        const title = linkTitleMap.get(item);
        return title ? { id: item, title } : { id: item };
      }

      if (typeof item === 'object' && item !== null && 'id' in item) {
        const recordId = String((item as { id?: unknown }).id ?? '');
        const existingTitle = (item as { title?: unknown }).title;
        const title =
          typeof existingTitle === 'string'
            ? existingTitle
            : linkTitleMap.get(recordId) ?? undefined;
        return title ? { ...(item as Record<string, unknown>), id: recordId, title } : item;
      }

      return item;
    };

    if (Array.isArray(value)) {
      return value.map((item) => hydrateItem(item));
    }

    if (typeof value === 'string') {
      const tokens = value
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
      if (tokens.length === 0) {
        return value;
      }
      if (!tokens.every((token) => token.startsWith('rec'))) {
        return value;
      }
      if (tokens.length === 1) {
        return hydrateItem(tokens[0]);
      }
      return tokens.map((token) => hydrateItem(token));
    }

    return hydrateItem(value);
  }

  private async buildLinkTitleMap(
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

  private extractLinkIds(value: unknown): string[] {
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
