import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry, type Result } from 'neverthrow';

import { validatePasteExpansion } from '../../commands/PasteCommand';
import type { NormalizedRanges, RangeType } from '../../commands/RangeUtils';
import {
  mergeOrderByWithViewRowTieBreaker,
  resolveGroupByToOrderBy,
  resolveOrderBy,
} from '../../commands/shared/orderBy';
import { toTableRecord } from '../../commands/shared/toTableRecord';
import {
  collectForeignTableReferences,
  parseTableFieldSpec,
  resolveTableFieldInputs,
  type ICreateTableFieldSpec,
} from '../../commands/TableFieldSpecs';
import type { DomainError } from '../../domain/shared/DomainError';
import { OffsetPagination } from '../../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../../domain/shared/pagination/PageLimit';
import { PageOffset } from '../../domain/shared/pagination/PageOffset';
import { composeAndSpecsOrUndefined } from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { FieldType } from '../../domain/table/fields/FieldType';
import { DateTimeFormatting } from '../../domain/table/fields/types/DateTimeFormatting';
import { NumberFormatting } from '../../domain/table/fields/types/NumberFormatting';
import { RecordWriteSideEffectVisitor } from '../../domain/table/fields/visitors/RecordWriteSideEffectVisitor';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { ViewId } from '../../domain/table/views/ViewId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type { ITableMapper } from '../../ports/mappers/TableMapper';
import type { RecordQueryPluginScope } from '../../ports/RecordQueryPlugin';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { v2CoreTokens } from '../../ports/tokens';
import type { RecordFilter } from '../../queries/RecordFilterDto';
import {
  buildRecordConditionSpec,
  buildSanitizedRecordConditionSpec,
  replaceCurrentUserTagInFilter,
} from '../../queries/RecordFilterMapper';
import type { RecordSearch } from '../../queries/RecordSearch';
import { resolveVisibleRowSearch } from '../../queries/RecordSearch';
import {
  dateFormattingSchema,
  numberFormattingSchema,
  numberShowAsSchema,
  singleLineTextShowAsSchema,
  type ITableFieldInput,
} from '../../schemas/field';
import type { ForeignTableLoaderService } from './ForeignTableLoaderService';
import { extractPasteLinkTitles } from './PasteLinkAutoResolveService';
import type { RecordWritePluginExecution } from './RecordWritePluginRunner';
import type { TableQueryService } from './TableQueryService';

export type PastePreparationSourceField = {
  readonly id?: string;
  readonly name?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
  readonly cellValueType?: string;
  readonly isComputed?: boolean;
  readonly isLookup?: boolean;
  readonly isMultipleCellValue?: boolean;
};

export type PastePreparationSort = {
  readonly fieldId: string;
  readonly order: 'asc' | 'desc';
};

export type PastePreparationGroup = {
  readonly fieldId: string;
  readonly order: 'asc' | 'desc';
};

export type PastePreparationCommand = {
  readonly tableId: TableId;
  readonly viewId: ViewId;
  readonly rangeType: RangeType;
  readonly content: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly filter: RecordFilter | undefined;
  readonly updateFilter: RecordFilter | undefined;
  readonly search: RecordSearch | undefined;
  readonly sourceFields: ReadonlyArray<PastePreparationSourceField> | undefined;
  readonly typecast: boolean;
  readonly projection: ReadonlyArray<string> | undefined;
  readonly sort: ReadonlyArray<PastePreparationSort> | undefined;
  readonly groupBy: ReadonlyArray<PastePreparationGroup> | undefined;
  readonly ignoreViewQuery: boolean;
  normalizeRanges(totalRows: number, totalCols: number): NormalizedRanges;
};

export type PasteEditableColumn = {
  readonly fieldId: FieldId;
  readonly columnIndex: number;
};

export type PasteUpdateOperation = {
  readonly type: 'update';
  readonly existingRecord: TableRecordReadModel;
  readonly rowData: ReadonlyArray<unknown>;
  readonly editableColumns?: ReadonlyArray<PasteEditableColumn>;
};

export type PasteCreateOperation = {
  readonly type: 'create';
  readonly rowData: ReadonlyArray<unknown>;
};

export type PasteColumnExpansion = {
  readonly originalTable: Table;
  readonly projectedTable: Table;
  readonly newFields: ReadonlyArray<Field>;
  readonly foreignTables: ReadonlyArray<Table>;
};

export type PasteSelectOptionProjection = {
  readonly fieldId: FieldId;
  readonly optionCount: number;
};

export type PastePreparationFacts = {
  readonly submittedRows: number;
  readonly selectedRows: number;
  readonly acceptedRows: number;
  readonly updateCandidates: number;
  readonly createCandidates: number;
  readonly rejectedSelectedRows: number;
  readonly submittedCells: number;
  readonly selectedFieldCount: number;
  readonly writableFieldCount: number;
  readonly columnExpansionCount: number;
  readonly selectOptionCreations: ReadonlyArray<PasteSelectOptionProjection>;
  readonly selectOptionProjection: 'known' | 'unknown';
  readonly linkTitleResolutionCandidateCount: number;
  readonly linkTitleProjection: 'known' | 'unknown';
  readonly affectedRowsEstablished: false;
  readonly readAuthorization: 'checked' | 'unknown';
  readonly writeAuthorization: 'unknown';
};

export type PastePreparation = {
  readonly persistedTable: Table;
  readonly tableForPaste: Table;
  readonly editableColumns: ReadonlyArray<PasteEditableColumn>;
  readonly columnExpansion?: PasteColumnExpansion;
  readonly updateOperations: ReadonlyArray<PasteUpdateOperation>;
  readonly createOperations: ReadonlyArray<PasteCreateOperation>;
  readonly typecast: boolean;
  readonly facts: PastePreparationFacts;
};

export type PasteWriteScopeResult = {
  readonly updateOperations: ReadonlyArray<PasteUpdateOperation>;
  readonly createOperations: ReadonlyArray<PasteCreateOperation>;
  readonly createColumns: ReadonlyArray<PasteEditableColumn>;
  readonly rejectedUpdateRows: number;
};

type LooseFieldInput = {
  type: string;
  name?: string;
  options?: Record<string, unknown>;
};

const expandPasteContent = (
  content: ReadonlyArray<ReadonlyArray<unknown>>,
  targetRows: number,
  targetCols: number
): ReadonlyArray<ReadonlyArray<unknown>> => {
  if (content.length === 0 || content[0]?.length === 0) return content;
  const contentRows = content.length;
  const contentCols = content[0]!.length;
  if (targetRows === contentRows && targetCols === contentCols) return content;
  if (targetRows % contentRows !== 0 || targetCols % contentCols !== 0) return content;
  return Array.from({ length: targetRows }, (_, rowIndex) =>
    Array.from(
      { length: targetCols },
      (_, columnIndex) => content[rowIndex % contentRows]![columnIndex % contentCols]
    )
  );
};

@injectable()
export class PastePreparationService {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper = new DefaultTableMapper()
  ) {}

  async prepare(
    context: IExecutionContext,
    command: PastePreparationCommand,
    options: {
      readonly readScope?: RecordQueryPluginScope;
      readonly resolveReadScope?: (
        table: Table
      ) => Promise<Result<RecordQueryPluginScope | undefined, DomainError>>;
      readonly readAuthorization: 'checked' | 'unknown';
      readonly includeSchemaProjection?: boolean;
    }
  ): Promise<Result<PastePreparation, DomainError>> {
    const service = this;
    return safeTry<PastePreparation, DomainError>(async function* () {
      const persistedTable = yield* await service.tableQueryService.getById(
        context,
        command.tableId
      );
      let tableForPaste = persistedTable;
      let orderedFieldIds = yield* persistedTable.getOrderedVisibleFieldIds(
        command.viewId.toString(),
        { projection: command.projection }
      );
      const readScope = options.resolveReadScope
        ? yield* await options.resolveReadScope(persistedTable)
        : options.readScope;
      if (readScope?.readableFieldIds) {
        orderedFieldIds = orderedFieldIds.filter((fieldId) =>
          readScope.readableFieldIds!.has(fieldId.toString())
        );
      }

      const view = yield* persistedTable.getView(command.viewId);
      const viewDefaults = yield* view.queryDefaults();
      const mergedDefaults = viewDefaults.merge({
        filter: command.filter,
        sort: command.sort,
        group: command.groupBy,
      });
      const effectiveFilter = command.ignoreViewQuery
        ? (command.filter ?? undefined)
        : mergedDefaults.filter();
      const effectiveSort = command.ignoreViewQuery
        ? (command.sort ?? undefined)
        : mergedDefaults.sort();
      const effectiveGroup = command.ignoreViewQuery
        ? (command.groupBy ?? undefined)
        : mergedDefaults.group();

      const actorResolvedFilter = replaceCurrentUserTagInFilter(
        persistedTable,
        effectiveFilter,
        context.actorId.toString()
      );
      const viewFilterSpec = yield* buildSanitizedRecordConditionSpec(
        persistedTable,
        actorResolvedFilter
      );
      const filterSpec = composeAndSpecsOrUndefined(
        [
          viewFilterSpec,
          readScope?.recordSpec && !readScope.skipRecordSpec ? readScope.recordSpec : undefined,
        ].filter(
          (spec): spec is ISpecification<TableRecord, ITableRecordConditionSpecVisitor> =>
            spec != null
        )
      );
      const visibleRowSearch = resolveVisibleRowSearch(command.search, orderedFieldIds);

      let totalRows = 0;
      if (command.rangeType === 'columns' || command.rangeType === 'rows') {
        const limit = yield* PageLimit.create(1);
        const pagination = OffsetPagination.create(limit, PageOffset.zero());
        const countResult = yield* await service.tableRecordQueryRepository.find(
          context,
          persistedTable,
          filterSpec,
          { mode: 'stored', pagination, search: visibleRowSearch, includeTotal: true }
        );
        totalRows = countResult.total;
      }

      const [[startCol, startRow], [endCol, endRow]] = command.normalizeRanges(
        totalRows,
        orderedFieldIds.length
      );
      const targetRangeCols = endCol - startCol + 1;
      const targetRangeRows = endRow - startRow + 1;
      yield* validatePasteExpansion(command.content, targetRangeRows, targetRangeCols);
      const expandedContent = expandPasteContent(command.content, targetRangeRows, targetRangeCols);
      const submittedCells = command.content.reduce((sum, row) => sum + row.length, 0);

      if (expandedContent.length === 0 || expandedContent[0]?.length === 0) {
        return ok<PastePreparation, DomainError>({
          persistedTable,
          tableForPaste,
          editableColumns: [],
          updateOperations: [],
          createOperations: [],
          typecast: command.typecast,
          facts: {
            submittedRows: command.content.length,
            selectedRows: 0,
            acceptedRows: 0,
            updateCandidates: 0,
            createCandidates: 0,
            rejectedSelectedRows: 0,
            submittedCells,
            selectedFieldCount: 0,
            writableFieldCount: 0,
            columnExpansionCount: 0,
            selectOptionCreations: [],
            selectOptionProjection: 'known',
            linkTitleResolutionCandidateCount: 0,
            linkTitleProjection: 'known',
            affectedRowsEstablished: false,
            readAuthorization: options.readAuthorization,
            writeAuthorization: 'unknown',
          },
        });
      }

      const expandedColumnCount = expandedContent[0]!.length;
      const columnsToExpand = Math.max(0, startCol + expandedColumnCount - orderedFieldIds.length);
      let columnExpansion: PasteColumnExpansion | undefined;
      if (columnsToExpand > 0) {
        columnExpansion = yield* await service.prepareColumnExpansion(context, persistedTable, {
          columnsToExpand,
          sourceFields: command.sourceFields,
        });
        tableForPaste = columnExpansion.projectedTable;
        orderedFieldIds = [
          ...orderedFieldIds,
          ...columnExpansion.newFields.map((field) => field.id()),
        ];
      }

      const targetFieldIds = orderedFieldIds.slice(startCol, startCol + expandedColumnCount);
      const editableColumns: PasteEditableColumn[] = [];
      targetFieldIds.forEach((fieldId, columnIndex) => {
        const field = tableForPaste.getField((candidate) => candidate.id().equals(fieldId));
        if (field.isOk() && !field.value.computed().toBoolean()) {
          editableColumns.push({ fieldId, columnIndex });
        }
      });

      if (editableColumns.length === 0) {
        return ok<PastePreparation, DomainError>({
          persistedTable,
          tableForPaste,
          editableColumns,
          columnExpansion,
          updateOperations: [],
          createOperations: [],
          typecast: command.typecast,
          facts: {
            submittedRows: command.content.length,
            selectedRows: 0,
            acceptedRows: 0,
            updateCandidates: 0,
            createCandidates: 0,
            rejectedSelectedRows: 0,
            submittedCells,
            selectedFieldCount: targetFieldIds.length,
            writableFieldCount: 0,
            columnExpansionCount: columnExpansion?.newFields.length ?? 0,
            selectOptionCreations: [],
            selectOptionProjection: 'known',
            linkTitleResolutionCandidateCount: 0,
            linkTitleProjection: 'known',
            affectedRowsEstablished: false,
            readAuthorization: options.readAuthorization,
            writeAuthorization: 'unknown',
          },
        });
      }

      const groupByOrderBy = yield* resolveGroupByToOrderBy(effectiveGroup);
      const sortOrderBy = yield* resolveOrderBy(effectiveSort);
      const orderBy = mergeOrderByWithViewRowTieBreaker(
        groupByOrderBy,
        sortOrderBy,
        command.viewId.toString()
      );

      let updateFilterSpec:
        | ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
        | undefined;
      if (command.updateFilter) {
        updateFilterSpec = yield* buildRecordConditionSpec(persistedTable, command.updateFilter);
      }

      const records = service.tableRecordQueryRepository.findStream(
        context,
        persistedTable,
        filterSpec,
        {
          mode: 'stored',
          pagination: { offset: startRow, limit: expandedContent.length },
          orderBy,
          search: visibleRowSearch,
        }
      );
      const split = yield* await service.splitOperations(
        records,
        expandedContent,
        persistedTable,
        updateFilterSpec
      );

      const fieldValues = [...split.updateOperations, ...split.createOperations].map((operation) =>
        service.rowDataToFieldValues(operation.rowData, editableColumns)
      );
      const includeSchemaProjection = options.includeSchemaProjection !== false;
      const selectProjection = includeSchemaProjection
        ? RecordWriteSideEffectVisitor.collect(tableForPaste, fieldValues, command.typecast)
        : undefined;
      const selectOptionCreations = selectProjection?.isOk()
        ? selectProjection.value.map((effect) => ({
            fieldId: effect.fieldId,
            optionCount: effect.options.length,
          }))
        : [];
      const linkTitleResolutionCandidateCount =
        includeSchemaProjection && command.typecast
          ? service.countLinkTitleResolutionCandidates(tableForPaste, editableColumns, [
              ...split.updateOperations,
              ...split.createOperations,
            ])
          : 0;

      return ok<PastePreparation, DomainError>({
        persistedTable,
        tableForPaste,
        editableColumns,
        columnExpansion,
        updateOperations: split.updateOperations,
        createOperations: split.createOperations,
        typecast: command.typecast,
        facts: {
          submittedRows: command.content.length,
          selectedRows: split.selectedRows,
          acceptedRows: split.updateOperations.length + split.createOperations.length,
          updateCandidates: split.updateOperations.length,
          createCandidates: split.createOperations.length,
          rejectedSelectedRows: split.rejectedSelectedRows,
          submittedCells,
          selectedFieldCount: targetFieldIds.length,
          writableFieldCount: editableColumns.length,
          columnExpansionCount: columnExpansion?.newFields.length ?? 0,
          selectOptionCreations,
          selectOptionProjection: selectProjection?.isOk() ? 'known' : 'unknown',
          linkTitleResolutionCandidateCount,
          linkTitleProjection: includeSchemaProjection ? 'known' : 'unknown',
          affectedRowsEstablished: false,
          readAuthorization: options.readAuthorization,
          writeAuthorization: 'unknown',
        },
      });
    });
  }

  applyWriteScope(
    preparation: PastePreparation,
    execution: RecordWritePluginExecution
  ): Result<PasteWriteScopeResult, DomainError> {
    return execution.getScope().andThen((scope) => {
      const expandedFieldIds = new Set(
        preparation.columnExpansion?.newFields.map((field) => field.id().toString()) ?? []
      );
      const updateOperations: PasteUpdateOperation[] = [];
      for (const operation of preparation.updateOperations) {
        const record = toTableRecord(preparation.persistedTable, operation.existingRecord);
        if (record.isErr()) return err(record.error);
        if (scope?.recordSpec && !scope.recordSpec.isSatisfiedBy(record.value)) continue;
        const allowed = execution.getUpdateFieldIdsForRecord(record.value);
        if (allowed.isErr()) return err(allowed.error);
        const columns = this.filterColumns(
          preparation.editableColumns,
          allowed.value,
          expandedFieldIds,
          false
        );
        if (columns.length === 0) continue;
        updateOperations.push({ ...operation, editableColumns: columns });
      }

      const createColumns = this.filterColumns(
        preparation.editableColumns,
        scope?.createFieldIds,
        expandedFieldIds,
        true
      );
      return ok({
        updateOperations,
        createOperations: createColumns.length ? preparation.createOperations : [],
        createColumns,
        rejectedUpdateRows: preparation.updateOperations.length - updateOperations.length,
      });
    });
  }

  async prepareColumnExpansion(
    context: IExecutionContext,
    table: Table,
    input: {
      readonly columnsToExpand: number;
      readonly sourceFields?: ReadonlyArray<PastePreparationSourceField>;
    }
  ): Promise<Result<PasteColumnExpansion, DomainError>> {
    const service = this;
    return safeTry<PasteColumnExpansion, DomainError>(async function* () {
      const detachedTable = yield* table.clone(service.tableMapper);
      const sourceFields = input.sourceFields ?? [];
      const startIndex = Math.max(0, sourceFields.length - input.columnsToExpand);
      const fieldInputs = Array.from({ length: input.columnsToExpand }, (_, index) =>
        service.sourceFieldToInput(sourceFields[startIndex + index])
      );
      const existingNames = detachedTable.getFields().map((field) => field.name().toString());
      const resolvedInputs = yield* resolveTableFieldInputs(fieldInputs, existingNames, {
        t: context.$t,
        hostTable: detachedTable,
      });
      const specs: ICreateTableFieldSpec[] = [];
      for (const fieldInput of resolvedInputs) {
        specs.push(yield* parseTableFieldSpec(fieldInput, { isPrimary: false }));
      }
      const references = yield* collectForeignTableReferences(specs);
      const foreignTables = yield* await service.foreignTableLoaderService.load(context, {
        baseId: detachedTable.baseId(),
        references,
      });
      const newFields: Field[] = [];
      for (const spec of specs) {
        newFields.push(
          yield* spec.createField({ baseId: detachedTable.baseId(), tableId: detachedTable.id() })
        );
      }
      const projected = yield* detachedTable.update((mutator) => {
        let next = mutator;
        for (const field of newFields) next = next.addField(field, { foreignTables });
        return next;
      });
      return ok({
        originalTable: table,
        projectedTable: projected.table,
        newFields,
        foreignTables,
      });
    });
  }

  private async splitOperations(
    records: AsyncIterable<Result<TableRecordReadModel, DomainError>>,
    content: ReadonlyArray<ReadonlyArray<unknown>>,
    table: Table,
    updateFilterSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<
    Result<
      {
        updateOperations: PasteUpdateOperation[];
        createOperations: PasteCreateOperation[];
        selectedRows: number;
        rejectedSelectedRows: number;
      },
      DomainError
    >
  > {
    const updateOperations: PasteUpdateOperation[] = [];
    const createOperations: PasteCreateOperation[] = [];
    let rowIndex = 0;
    let selectedRows = 0;
    let rejectedSelectedRows = 0;
    for await (const recordResult of records) {
      if (rowIndex >= content.length) break;
      if (recordResult.isErr()) return err(recordResult.error);
      selectedRows += 1;
      let accepted = true;
      if (updateFilterSpec) {
        const record = toTableRecord(table, recordResult.value);
        if (record.isErr()) return err(record.error);
        accepted = updateFilterSpec.isSatisfiedBy(record.value);
      }
      if (accepted) {
        updateOperations.push({
          type: 'update',
          existingRecord: recordResult.value,
          rowData: content[rowIndex]!,
        });
      } else {
        rejectedSelectedRows += 1;
      }
      rowIndex += 1;
    }
    for (; rowIndex < content.length; rowIndex += 1) {
      createOperations.push({ type: 'create', rowData: content[rowIndex]! });
    }
    return ok({ updateOperations, createOperations, selectedRows, rejectedSelectedRows });
  }

  private rowDataToFieldValues(
    rowData: ReadonlyArray<unknown>,
    columns: ReadonlyArray<PasteEditableColumn>
  ): Map<string, unknown> {
    return new Map(
      columns.map((column) => [column.fieldId.toString(), rowData[column.columnIndex] ?? null])
    );
  }

  private countLinkTitleResolutionCandidates(
    table: Table,
    columns: ReadonlyArray<PasteEditableColumn>,
    operations: ReadonlyArray<PasteUpdateOperation | PasteCreateOperation>
  ): number {
    const titlesByField = new Map<string, Set<string>>();
    for (const column of columns) {
      const field = table.getField((candidate) => candidate.id().equals(column.fieldId));
      if (field.isOk() && field.value.type().equals(FieldType.link())) {
        titlesByField.set(column.fieldId.toString(), new Set());
      }
    }
    for (const operation of operations) {
      for (const column of columns) {
        const titles = titlesByField.get(column.fieldId.toString());
        if (!titles) continue;
        for (const title of extractPasteLinkTitles(operation.rowData[column.columnIndex])) {
          titles.add(title);
        }
      }
    }
    let count = 0;
    for (const titles of titlesByField.values()) {
      count += titles.size;
    }
    return count;
  }

  private filterColumns(
    columns: ReadonlyArray<PasteEditableColumn>,
    allowedFieldIds: ReadonlySet<string> | undefined,
    extraAllowedFieldIds: ReadonlySet<string>,
    rejectEmptyAllowedSet: boolean
  ): ReadonlyArray<PasteEditableColumn> {
    if (!allowedFieldIds) return columns;
    if (rejectEmptyAllowedSet && allowedFieldIds.size === 0) return [];
    return columns.filter((column) => {
      const fieldId = column.fieldId.toString();
      return allowedFieldIds.has(fieldId) || extraAllowedFieldIds.has(fieldId);
    });
  }

  private sourceFieldToInput(field?: PastePreparationSourceField): ITableFieldInput {
    if (!field?.type) return { type: 'singleLineText' } as ITableFieldInput;
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
          options: { isMultiple: false, shouldNotify: true },
        } as ITableFieldInput;
      }
      const mapped = this.optionsRoToVoByCellValueType(field.cellValueType, field.options);
      return { ...baseField, type: mapped.type, options: mapped.options } as ITableFieldInput;
    }
    if (field.isLookup) {
      const mapped = this.lookupOptionsRoToVo(field);
      return { ...baseField, type: mapped.type, options: mapped.options } as ITableFieldInput;
    }
    return baseField as ITableFieldInput;
  }

  private optionsRoToVoByCellValueType(
    cellValueType?: string,
    options?: Record<string, unknown>
  ): LooseFieldInput {
    const safeOptions = options ?? {};
    switch (cellValueType) {
      case 'number': {
        const formatting = numberFormattingSchema.safeParse(safeOptions.formatting);
        const showAs = numberShowAsSchema.safeParse(safeOptions.showAs);
        return {
          type: 'number',
          options: {
            formatting: formatting.success ? formatting.data : NumberFormatting.default().toDto(),
            ...(showAs.success ? { showAs: showAs.data } : {}),
          },
        };
      }
      case 'dateTime': {
        const formatting = dateFormattingSchema.safeParse(safeOptions.formatting);
        return {
          type: 'date',
          options: {
            formatting: formatting.success ? formatting.data : DateTimeFormatting.default().toDto(),
          },
        };
      }
      case 'boolean':
        return { type: 'checkbox', options: {} };
      case 'string':
      default: {
        const showAs = singleLineTextShowAsSchema.safeParse(safeOptions.showAs);
        return { type: 'singleLineText', options: showAs.success ? { showAs: showAs.data } : {} };
      }
    }
  }

  private lookupOptionsRoToVo(field: PastePreparationSourceField): LooseFieldInput {
    if (field.type === 'singleSelect' && field.isMultipleCellValue) {
      return { type: 'multipleSelect', options: field.options };
    }
    if (field.type === 'user' && field.isMultipleCellValue) {
      return { type: 'user', options: { ...field.options, isMultiple: true } };
    }
    return { type: field.type ?? 'singleLineText', options: field.options };
  }
}
