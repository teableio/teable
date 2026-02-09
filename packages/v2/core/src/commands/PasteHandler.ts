/* eslint-disable no-inner-declarations */
import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
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
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldType } from '../domain/table/fields/FieldType';
import { DateTimeFormatting } from '../domain/table/fields/types/DateTimeFormatting';
import type { LinkField } from '../domain/table/fields/types/LinkField';
import { NumberFormatting } from '../domain/table/fields/types/NumberFormatting';
import type { UpdateRecordItem } from '../domain/table/methods/records';
import { calculateBatchSize } from '../domain/table/methods/records/calculateBatchSize';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import type { UndoRedoCommandLeafData } from '../ports/UndoRedoStore';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { buildRecordConditionSpec } from '../queries/RecordFilterMapper';
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
import { mergeOrderBy, resolveGroupByToOrderBy, resolveOrderBy } from './shared/orderBy';
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
  updates: RecordUpdateDTO[];
  createdRecords: RecordValuesDTO[];
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
      });
      const effectiveFilter = mergedDefaults.filter();
      const effectiveSort = mergedDefaults.sort();

      // 3. Build filter spec from effective view filter (if provided) - needed early for row count
      let filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined =
        undefined;
      if (effectiveFilter) {
        filterSpec = yield* buildRecordConditionSpec(table, effectiveFilter);
      }

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
            { mode: 'stored', pagination }
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
      const effectiveGroup = mergedDefaults.group();
      const groupByOrderBy = yield* resolveGroupByToOrderBy(effectiveGroup);
      const sortOrderBy = yield* resolveOrderBy(effectiveSort);
      const orderBy = mergeOrderBy(groupByOrderBy, sortOrderBy, command.viewId.toString());

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

      // 12. Execute paste within transaction
      const eventData: CollectedEventData = { updates: [], createdRecords: [] };

      yield* await handler.unitOfWork.withTransaction(context, async (txContext) => {
        return handler.executePasteStream(
          txContext,
          table,
          operationsStream,
          command.typecast,
          editableColumns,
          eventData
        );
      });

      // 13. Publish events AFTER transaction commits
      const events: IDomainEvent[] = [];

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

      const undoCommands: UndoRedoCommandLeafData[] = [];
      const redoCommands: UndoRedoCommandLeafData[] = [];

      if (eventData.createdRecords.length > 0) {
        undoCommands.push({
          type: 'DeleteRecords',
          version: 1,
          payload: {
            tableId: table.id().toString(),
            recordIds: eventData.createdRecords.map((record) => record.recordId),
          },
        });
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

        redoCommands.push({
          type: 'RestoreRecords',
          version: 1,
          payload: {
            tableId: table.id().toString(),
            records: restoreRecords,
          },
        });
      }

      if (undoCommands.length > 0 || redoCommands.length > 0) {
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
        const tableRecordResult = this.convertReadModelToTableRecord(readModel, table);
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

  /**
   * Convert a TableRecordReadModel to a TableRecord for in-memory spec evaluation.
   */
  private convertReadModelToTableRecord(
    readModel: TableRecordReadModel,
    table: Table
  ): Result<TableRecord, DomainError> {
    const recordIdResult = RecordId.create(readModel.id);
    if (recordIdResult.isErr()) {
      return err(recordIdResult.error);
    }

    const fieldValues: Array<{ fieldId: FieldId; value: TableRecordCellValue }> = [];

    for (const [fieldIdStr, rawValue] of Object.entries(readModel.fields)) {
      const fieldIdResult = FieldId.create(fieldIdStr);
      if (fieldIdResult.isErr()) {
        // Skip invalid field IDs (shouldn't happen in practice)
        continue;
      }
      const cellValueResult = TableRecordCellValue.create(rawValue);
      if (cellValueResult.isErr()) {
        return err(cellValueResult.error);
      }
      fieldValues.push({
        fieldId: fieldIdResult.value,
        value: cellValueResult.value,
      });
    }

    return TableRecord.create({
      id: recordIdResult.value,
      tableId: table.id(),
      fieldValues,
    });
  }

  /**
   * Execute paste operations using streaming.
   * Separates update and create operations, processes each stream independently.
   */
  private async executePasteStream(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    operationsStream: AsyncIterable<Result<PasteOperation, DomainError>>,
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    eventData: CollectedEventData
  ): Promise<Result<void, DomainError>> {
    const handler = this;
    const tracer = context.tracer;
    const executeSpan = tracer?.startSpan('teable.PasteHandler.executePasteStream');

    try {
      // Collect operations into update and create lists
      // We need to separate them because update needs existing record info
      const updateOperations: UpdateOperation[] = [];
      const createOperations: CreateOperation[] = [];

      const collectSpan = tracer?.startSpan('teable.PasteHandler.collectOperations');
      try {
        for await (const opResult of operationsStream) {
          if (opResult.isErr()) {
            return err(opResult.error);
          }
          const op = opResult.value;
          if (op.type === 'update') {
            updateOperations.push(op);
          } else {
            createOperations.push(op);
          }
        }
      } finally {
        collectSpan?.end();
      }

      const sideEffectsSpan = tracer?.startSpan('teable.PasteHandler.sideEffects');
      let tableForMutations: Table;
      try {
        const selectOptionFieldValues: ReadonlyMap<string, unknown>[] = [
          ...updateOperations,
          ...createOperations,
        ].map((op) => {
          const fieldValues = new Map<string, unknown>();
          for (const column of editableColumns) {
            const fieldIdStr = column.fieldId.toString();
            const rawValue = op.rowData[column.columnIndex] ?? null;
            fieldValues.set(fieldIdStr, rawValue);
          }
          return fieldValues;
        });

        const sideEffectResult = handler.recordWriteSideEffectService.execute(
          table,
          selectOptionFieldValues,
          typecast
        );
        if (sideEffectResult.isErr()) {
          return err(sideEffectResult.error);
        }
        tableForMutations = sideEffectResult.value.table;
        const tableUpdateResult = sideEffectResult.value.updateResult;

        if (tableUpdateResult) {
          const updateResult = await handler.tableUpdateFlow.execute(
            context,
            { table },
            () => ok(tableUpdateResult),
            { publishEvents: false }
          );
          if (updateResult.isErr()) {
            return err(updateResult.error);
          }
        }
      } finally {
        sideEffectsSpan?.end();
      }

      const linkTitleSpan = tracer?.startSpan('teable.PasteHandler.buildLinkTitleMap');
      let linkTitleMapResult: Result<LinkTitleMap, DomainError>;
      try {
        linkTitleMapResult = typecast
          ? await handler.buildLinkTitleMap(context, tableForMutations, editableColumns, [
              ...updateOperations,
              ...createOperations,
            ])
          : ok(new Map());
      } finally {
        linkTitleSpan?.end();
      }
      if (linkTitleMapResult.isErr()) {
        return err(linkTitleMapResult.error);
      }

      const linkTitleMap = linkTitleMapResult.value;

      // Process updates using streaming
      if (updateOperations.length > 0) {
        const updateSpan = tracer?.startSpan('teable.PasteHandler.processUpdates');
        try {
          const updateResult = await handler.processUpdatesStream(
            context,
            tableForMutations,
            updateOperations,
            typecast,
            editableColumns,
            linkTitleMap,
            eventData
          );
          if (updateResult.isErr()) {
            return err(updateResult.error);
          }
        } finally {
          updateSpan?.end();
        }
      }

      // Process creates using streaming
      if (createOperations.length > 0) {
        const createSpan = tracer?.startSpan('teable.PasteHandler.processCreates');
        try {
          const createResult = await handler.processCreatesStream(
            context,
            tableForMutations,
            createOperations,
            typecast,
            editableColumns,
            linkTitleMap,
            eventData
          );
          if (createResult.isErr()) {
            return err(createResult.error);
          }
        } finally {
          createSpan?.end();
        }
      }

      return ok(undefined);
    } finally {
      executeSpan?.end();
    }
  }

  /**
   * Process update operations using streaming.
   * Generates update batches and passes them directly to updateManyStream.
   */
  private async processUpdatesStream(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    updateOperations: ReadonlyArray<UpdateOperation>,
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    linkTitleMap: LinkTitleMap,
    eventData: CollectedEventData
  ): Promise<Result<void, DomainError>> {
    const handler = this;

    return safeTry<void, DomainError>(async function* () {
      // Generate UpdateRecordItems from operations
      const updateItems: UpdateRecordItem[] = [];
      const pendingUpdateEvents: Array<{
        recordId: string;
        oldVersion: number;
        oldValues: Map<string, unknown>;
      }> = [];

      for (const op of updateOperations) {
        const recordId = yield* RecordId.create(op.existingRecord.id);
        const fieldValues = new Map<string, unknown>();
        const oldValues = new Map<string, unknown>();

        for (const column of editableColumns) {
          const fieldId = column.fieldId;
          const fieldIdStr = fieldId.toString();
          const rawValue = op.rowData[column.columnIndex] ?? null;
          const newValue = handler.hydrateLinkValue(rawValue, linkTitleMap.get(fieldIdStr));
          const oldValue = op.existingRecord.fields[fieldIdStr];

          fieldValues.set(fieldIdStr, newValue);
          oldValues.set(fieldIdStr, oldValue);
        }

        updateItems.push({ recordId, fieldValues });

        pendingUpdateEvents.push({
          recordId: op.existingRecord.id,
          oldVersion: op.existingRecord.version,
          oldValues,
        });
      }

      // Create update batches generator from Table
      const updateBatches = table.updateRecordsStream(updateItems, { typecast });

      // Transform batches: resolve link titles and yield
      async function* resolveAndYieldBatches(): AsyncGenerator<
        Result<ReadonlyArray<RecordUpdateResult>, DomainError>
      > {
        for (const batchResult of updateBatches) {
          if (batchResult.isErr()) {
            yield batchResult;
            continue;
          }

          const batch = batchResult.value;
          const resolvedBatch: RecordUpdateResult[] = [];

          for (const updateResult of batch) {
            let mutateSpec = updateResult.mutateSpec;

            // Resolve values that require external lookups (user/link)
            if (typecast) {
              const needsResolutionResult = mutateSpec
                ? handler.recordMutationSpecResolver.needsResolution(mutateSpec)
                : ok(false);
              if (needsResolutionResult.isErr()) {
                yield err(needsResolutionResult.error);
                return;
              }
              if (needsResolutionResult.value) {
                const resolveResult = await handler.recordMutationSpecResolver.resolveAndReplace(
                  context,
                  mutateSpec
                );
                if (resolveResult.isErr()) {
                  yield err(resolveResult.error);
                  return;
                }
                mutateSpec = resolveResult.value;
              }
            }

            resolvedBatch.push(
              RecordUpdateResult.create(
                updateResult.record,
                mutateSpec,
                updateResult.fieldKeyMapping,
                updateResult.events
              )
            );
          }

          yield ok(resolvedBatch);
        }
      }

      // Execute updates via stream - pass async generator directly
      // Note: updateManyStream currently expects sync Generator, may need interface update
      // For now, collect the async generator results
      const resolvedBatches: Array<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> = [];
      let resolvedUpdateIndex = 0;
      for await (const batch of resolveAndYieldBatches()) {
        if (batch.isOk()) {
          for (const updateResult of batch.value) {
            const pending = pendingUpdateEvents[resolvedUpdateIndex];
            if (!pending) {
              return err(
                domainError.unexpected({
                  code: 'paste.update.event_mismatch',
                  message: 'Failed to map paste update event to resolved record update result',
                })
              );
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
        }

        resolvedBatches.push(batch);
      }

      function* syncBatchesGenerator(): Generator<
        Result<ReadonlyArray<RecordUpdateResult>, DomainError>
      > {
        for (const batch of resolvedBatches) {
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

  /**
   * Process create operations using streaming.
   * Generates record batches and passes them directly to insertManyStream.
   */
  private async processCreatesStream(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    createOperations: ReadonlyArray<CreateOperation>,
    typecast: boolean,
    editableColumns: ReadonlyArray<EditableColumn>,
    linkTitleMap: LinkTitleMap,
    eventData: CollectedEventData
  ): Promise<Result<void, DomainError>> {
    const handler = this;

    return safeTry<void, DomainError>(async function* () {
      const createFieldValues: ReadonlyMap<string, unknown>[] = createOperations.map((op) => {
        const fieldValues = new Map<string, unknown>();
        for (const column of editableColumns) {
          const fieldId = column.fieldId.toString();
          const rawValue = op.rowData[column.columnIndex] ?? null;
          fieldValues.set(fieldId, handler.hydrateLinkValue(rawValue, linkTitleMap.get(fieldId)));
        }
        return fieldValues;
      });

      const createResult = table.createRecords(createFieldValues, { typecast });
      if (createResult.isErr()) {
        return err(createResult.error);
      }

      let records = createResult.value.records;

      if (typecast) {
        const resolvedRecords: TableRecord[] = [];
        for (let index = 0; index < records.length; index++) {
          let record = records[index]!;
          const mutateSpec = createResult.value.mutateSpecs[index] ?? null;
          if (mutateSpec) {
            const needsResolutionResult =
              handler.recordMutationSpecResolver.needsResolution(mutateSpec);
            if (needsResolutionResult.isErr()) {
              return err(needsResolutionResult.error);
            }
            if (needsResolutionResult.value) {
              const resolveResult = await handler.recordMutationSpecResolver.resolveAndReplace(
                context,
                mutateSpec
              );
              if (resolveResult.isErr()) {
                return err(resolveResult.error);
              }
              const mutateResult = resolveResult.value.mutate(record);
              if (mutateResult.isErr()) {
                return err(mutateResult.error);
              }
              record = mutateResult.value;
            }
          }
          resolvedRecords.push(record);
        }
        records = resolvedRecords;
      }

      // Collect created records while streaming to insertManyStream
      const createdRecords: Array<{
        recordId: string;
        fields: Array<{ fieldId: string; value: unknown }>;
      }> = [];

      // Collect orders from insertManyStream callback
      const allRecordOrders = new Map<string, Record<string, number>>();

      const batchSize = calculateBatchSize(table.getFields().length);

      async function* recordBatchesIterable(): AsyncIterable<ReadonlyArray<TableRecord>> {
        for (let startIndex = 0; startIndex < records.length; startIndex += batchSize) {
          const batch = records.slice(startIndex, startIndex + batchSize);

          // Collect record info from each batch
          for (const record of batch) {
            const fields: Array<{ fieldId: string; value: unknown }> = [];
            for (const entry of record.fields().entries()) {
              fields.push({ fieldId: entry.fieldId.toString(), value: entry.value.toValue() });
            }
            createdRecords.push({
              recordId: record.id().toString(),
              fields,
            });
          }

          yield batch;
        }
      }

      // Execute inserts via stream with callback to collect orders
      yield* await handler.tableRecordRepository.insertManyStream(
        context,
        table,
        recordBatchesIterable(),
        {
          onBatchInserted: (progress) => {
            // Collect record orders from each batch
            if (progress.recordOrders) {
              for (const [recordId, orders] of progress.recordOrders) {
                allRecordOrders.set(recordId, orders);
              }
            }
          },
        }
      );

      // Add collected records to event data with orders
      for (const record of createdRecords) {
        const orders = allRecordOrders.get(record.recordId);
        eventData.createdRecords.push({
          recordId: record.recordId,
          fields: record.fields,
          orders,
        });
      }

      return ok(undefined);
    });
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
