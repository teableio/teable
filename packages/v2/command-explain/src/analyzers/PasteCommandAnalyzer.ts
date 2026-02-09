import { inject, injectable } from '@teable/v2-di';
import { ok, err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type ITableRecordQueryRepository,
  type ISpecification,
  type TableRecordReadModel,
  type ITableRecordConditionSpecVisitor,
  TableRecordCellValue,
  TableRecord,
  type Table,
  TableQueryService,
  PasteCommand,
  FieldId,
  RecordId,
  OffsetPagination,
  PageLimit,
  PageOffset,
  buildRecordConditionSpec,
  v2CoreTokens,
} from '@teable/v2-core';
import type { Kysely } from 'kysely';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  RecordInsertBuilder,
  RecordUpdateBuilder,
  type DynamicDB,
  v2RecordRepositoryPostgresTokens,
} from '@teable/v2-adapter-table-repository-postgres';

import type { ICommandAnalyzer } from './ICommandAnalyzer';
import type {
  ExplainResult,
  ExplainOptions,
  CommandExplainInfo,
  SqlExplainInfo,
  ExplainAnalyzeOutput,
  ExplainOutput,
} from '../types';
import { DEFAULT_EXPLAIN_OPTIONS } from '../types';
import { v2CommandExplainTokens } from '../di/tokens';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';

type EditableColumn = {
  fieldId: FieldId;
  columnIndex: number;
};

type PasteSampleUpdate = {
  recordId: string;
  rowData: ReadonlyArray<unknown>;
};

type PasteSampleCreate = {
  rowData: ReadonlyArray<unknown>;
};

/**
 * Analyzer for PasteCommand.
 * Uses the first update/create operation as representative SQL for EXPLAIN.
 */
@injectable()
export class PasteCommandAnalyzer implements ICommandAnalyzer<PasteCommand> {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CommandExplainTokens.sqlExplainRunner)
    private readonly sqlExplainRunner: SqlExplainRunner,
    @inject(v2CommandExplainTokens.complexityCalculator)
    private readonly complexityCalculator: ComplexityCalculator
  ) {}

  async analyze(
    context: IExecutionContext,
    command: PasteCommand,
    options: ExplainOptions,
    startTime: number
  ): Promise<Result<ExplainResult, DomainError>> {
    const analyzer = this;
    const mergedOptions = { ...DEFAULT_EXPLAIN_OPTIONS, ...options };

    return safeTry<ExplainResult, DomainError>(async function* () {
      let sqlExplainMs = 0;

      const table = yield* await analyzer.tableQueryService.getById(context, command.tableId);
      const dbTableNameResult = table.dbTableName();
      if (dbTableNameResult.isErr()) {
        return err(dbTableNameResult.error);
      }
      const tableNameValueResult = dbTableNameResult.value.value();
      if (tableNameValueResult.isErr()) {
        return err(tableNameValueResult.error);
      }
      const tableName = tableNameValueResult.value;

      const view = yield* table.getView(command.viewId);
      const viewDefaults = yield* view.queryDefaults();
      const mergedDefaults = viewDefaults.merge({
        filter: command.filter,
        sort: command.sort,
      });
      const effectiveFilter = mergedDefaults.filter();
      const effectiveSort = mergedDefaults.sort();

      let filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined =
        undefined;
      if (effectiveFilter) {
        const specResult = buildRecordConditionSpec(table, effectiveFilter);
        if (specResult.isErr()) {
          return err(specResult.error);
        }
        filterSpec = specResult.value;
      }

      let updateFilterSpec:
        | ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
        | undefined = undefined;
      if (command.updateFilter) {
        const updateSpecResult = buildRecordConditionSpec(table, command.updateFilter);
        if (updateSpecResult.isErr()) {
          return err(updateSpecResult.error);
        }
        updateFilterSpec = updateSpecResult.value;
      }

      let totalRows = 0;
      if (command.rangeType === 'columns' || command.rangeType === 'rows') {
        const limitResult = PageLimit.create(1);
        if (limitResult.isErr()) {
          return err(limitResult.error);
        }
        const pagination = OffsetPagination.create(limitResult.value, PageOffset.zero());
        const countResult = yield* await analyzer.tableRecordQueryRepository.find(
          context,
          table,
          filterSpec,
          { mode: 'stored', pagination }
        );
        totalRows = countResult.total;
      }

      const orderedFieldIds = yield* table.getOrderedVisibleFieldIds(command.viewId.toString(), {
        projection: command.projection,
      });
      const totalCols = orderedFieldIds.length;

      const normalizedRanges = command.normalizeRanges(totalRows, totalCols);
      const [[startCol, startRow], [endCol, endRow]] = normalizedRanges;
      const targetRangeCols = endCol - startCol + 1;
      const targetRangeRows = endRow - startRow + 1;
      const expandedContent = expandPasteContent(command.content, targetRangeRows, targetRangeCols);

      if (expandedContent.length === 0 || expandedContent[0]?.length === 0) {
        return ok(
          buildExplainResult({
            commandInfo: {
              type: 'Paste',
              tableId: command.tableId.toString(),
              tableName: table.name().toString(),
              recordIds: [],
              changedFieldIds: [],
              changedFieldNames: [],
              changedFieldTypes: [],
              changeType: 'update',
            },
            sqlExplains: [],
            totalMs: Date.now() - startTime,
            sqlExplainMs,
            complexityCalculator: analyzer.complexityCalculator,
          })
        );
      }

      const expandedColCount = expandedContent[0]!.length;
      const numColsToExpand = Math.max(0, startCol + expandedColCount - totalCols);
      if (numColsToExpand > 0) {
        return err(
          domainError.validation({
            message: `Explain Paste does not support expanding columns (needs ${numColsToExpand} new columns)`,
          })
        );
      }

      const targetFieldIds = orderedFieldIds.slice(startCol, startCol + expandedColCount);
      const editableColumns: EditableColumn[] = [];
      targetFieldIds.forEach((fieldId, columnIndex) => {
        const fieldResult = table.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isOk() && !fieldResult.value.computed().toBoolean()) {
          editableColumns.push({ fieldId, columnIndex });
        }
      });

      if (editableColumns.length === 0) {
        return ok(
          buildExplainResult({
            commandInfo: {
              type: 'Paste',
              tableId: command.tableId.toString(),
              tableName: table.name().toString(),
              recordIds: [],
              changedFieldIds: [],
              changedFieldNames: [],
              changedFieldTypes: [],
              changeType: 'update',
            },
            sqlExplains: [],
            totalMs: Date.now() - startTime,
            sqlExplainMs,
            complexityCalculator: analyzer.complexityCalculator,
          })
        );
      }

      const changedFieldIds: string[] = [];
      const changedFieldNames: string[] = [];
      const changedFieldTypes: string[] = [];
      for (const column of editableColumns) {
        const fieldResult = table.getField((f) => f.id().equals(column.fieldId));
        if (fieldResult.isOk()) {
          const field = fieldResult.value;
          changedFieldIds.push(field.id().toString());
          changedFieldNames.push(field.name().toString());
          changedFieldTypes.push(field.type().toString());
        }
      }

      let orderBy: ReadonlyArray<{ fieldId: FieldId; direction: 'asc' | 'desc' }> | undefined =
        undefined;
      if (effectiveSort && effectiveSort.length > 0) {
        const sortItems: Array<{ fieldId: FieldId; direction: 'asc' | 'desc' }> = [];
        for (const s of effectiveSort) {
          const fieldIdResult = FieldId.create(s.fieldId);
          if (fieldIdResult.isErr()) {
            continue;
          }
          sortItems.push({ fieldId: fieldIdResult.value, direction: s.order });
        }
        if (sortItems.length > 0) {
          orderBy = sortItems;
        }
      }

      const limitResult = PageLimit.create(expandedContent.length);
      if (limitResult.isErr()) {
        return err(limitResult.error);
      }
      const offsetResult = PageOffset.create(startRow);
      if (offsetResult.isErr()) {
        return err(offsetResult.error);
      }
      const pagination = OffsetPagination.create(limitResult.value, offsetResult.value);
      const recordsResult = yield* await analyzer.tableRecordQueryRepository.find(
        context,
        table,
        filterSpec,
        { mode: 'stored', pagination, orderBy }
      );

      const recordIds: string[] = [];
      let updateCount = 0;
      let createCount = 0;
      let sampleUpdate: PasteSampleUpdate | null = null;
      let sampleCreate: PasteSampleCreate | null = null;

      let rowIndex = 0;
      for (const record of recordsResult.records) {
        if (rowIndex >= expandedContent.length) break;

        let canUpdate = true;
        if (updateFilterSpec) {
          const recordResult = convertReadModelToTableRecord(record, table);
          if (recordResult.isErr()) {
            return err(recordResult.error);
          }
          canUpdate = updateFilterSpec.isSatisfiedBy(recordResult.value);
        }

        if (canUpdate) {
          updateCount += 1;
          recordIds.push(record.id);
          if (!sampleUpdate) {
            sampleUpdate = { recordId: record.id, rowData: expandedContent[rowIndex]! };
          }
        }
        rowIndex += 1;
      }

      for (; rowIndex < expandedContent.length; rowIndex++) {
        createCount += 1;
        recordIds.push(`(new record ${createCount})`);
        if (!sampleCreate) {
          sampleCreate = { rowData: expandedContent[rowIndex]! };
        }
      }

      const changeType: CommandExplainInfo['changeType'] =
        updateCount > 0 ? 'update' : createCount > 0 ? 'insert' : 'update';

      const commandInfo: CommandExplainInfo = {
        type: 'Paste',
        tableId: command.tableId.toString(),
        tableName: table.name().toString(),
        recordIds,
        changedFieldIds,
        changedFieldNames,
        changedFieldTypes,
        changeType,
      };

      const sqlExplains: SqlExplainInfo[] = [];
      if (mergedOptions.includeSql) {
        const sqlExplainStart = Date.now();
        const now = new Date().toISOString();

        const pushExplain = async (stepDescription: string, sql: string, parameters: unknown[]) => {
          let explainAnalyze: ExplainAnalyzeOutput | null = null;
          let explainOnly: ExplainOutput | null = null;
          let explainError: string | null = null;

          const explainResult = await analyzer.sqlExplainRunner.explain(
            analyzer.db,
            sql,
            parameters,
            mergedOptions.analyze
          );
          if (explainResult.isOk()) {
            if (mergedOptions.analyze) {
              explainAnalyze = explainResult.value as ExplainAnalyzeOutput;
            } else {
              explainOnly = explainResult.value as ExplainOutput;
            }
          } else {
            explainError = explainResult.error.message;
          }

          sqlExplains.push({
            stepDescription,
            sql,
            parameters,
            explainAnalyze,
            explainOnly,
            explainError,
          });
        };

        if (sampleUpdate) {
          const recordIdResult = RecordId.create(sampleUpdate.recordId);
          if (recordIdResult.isErr()) {
            return err(recordIdResult.error);
          }

          const updateFieldValues = new Map<string, unknown>();
          for (const column of editableColumns) {
            const fieldIdStr = column.fieldId.toString();
            const rawValue = sampleUpdate.rowData[column.columnIndex] ?? null;
            updateFieldValues.set(fieldIdStr, rawValue);
          }

          const updateResult = table.updateRecord(recordIdResult.value, updateFieldValues, {
            typecast: command.typecast,
          });
          if (updateResult.isErr()) {
            return err(updateResult.error);
          }

          const updateBuilder = new RecordUpdateBuilder(
            analyzer.db as unknown as Kysely<DynamicDB>
          );
          const updateSqlResult = await updateBuilder.build({
            table,
            tableName,
            mutateSpec: updateResult.value.mutateSpec,
            recordId: recordIdResult.value.toString(),
            context: {
              actorId: 'explain_placeholder',
              now,
            },
          });
          if (updateSqlResult.isErr()) {
            return err(updateSqlResult.error);
          }

          const updatePrefix =
            updateCount > 1 ? `Paste update (1 of ${updateCount})` : 'Paste update';
          const { mainUpdate, additionalStatements } = updateSqlResult.value;

          await pushExplain(
            `${updatePrefix} - ${mainUpdate.description}`,
            mainUpdate.compiled.sql,
            mainUpdate.compiled.parameters as unknown[]
          );

          for (const stmt of additionalStatements) {
            await pushExplain(
              `${updatePrefix} - ${stmt.description}`,
              stmt.compiled.sql,
              stmt.compiled.parameters as unknown[]
            );
          }
        }

        if (sampleCreate) {
          const createFieldValues = new Map<string, unknown>();
          for (const column of editableColumns) {
            const fieldIdStr = column.fieldId.toString();
            const rawValue = sampleCreate.rowData[column.columnIndex] ?? null;
            createFieldValues.set(fieldIdStr, rawValue);
          }

          const createResult = table.createRecord(createFieldValues, {
            typecast: command.typecast,
          });
          if (createResult.isErr()) {
            return err(createResult.error);
          }

          const recordValues = recordFieldsToMap(table, createResult.value.record);
          const insertBuilder = new RecordInsertBuilder(
            analyzer.db as unknown as Kysely<DynamicDB>
          );
          const insertSqlResult = insertBuilder.build({
            table,
            tableName,
            fieldValues: recordValues,
            context: {
              recordId: createResult.value.record.id().toString(),
              actorId: 'explain_placeholder',
              now,
            },
          });
          if (insertSqlResult.isErr()) {
            return err(insertSqlResult.error);
          }

          const insertPrefix =
            createCount > 1 ? `Paste create (1 of ${createCount})` : 'Paste create';
          const { mainInsert, additionalStatements } = insertSqlResult.value;

          await pushExplain(
            `${insertPrefix} - ${mainInsert.description}`,
            mainInsert.compiled.sql,
            mainInsert.compiled.parameters as unknown[]
          );

          for (const stmt of additionalStatements) {
            await pushExplain(
              `${insertPrefix} - ${stmt.description}`,
              stmt.compiled.sql,
              stmt.compiled.parameters as unknown[]
            );
          }
        }

        sqlExplainMs = Date.now() - sqlExplainStart;
      }

      return ok(
        buildExplainResult({
          commandInfo,
          sqlExplains,
          totalMs: Date.now() - startTime,
          sqlExplainMs,
          complexityCalculator: analyzer.complexityCalculator,
        })
      );
    });
  }
}

function recordFieldsToMap(table: Table, record: TableRecord) {
  const fieldValues = new Map<string, unknown>();
  const recordFields = record.fields();

  for (const field of table.getFields()) {
    const cellValue = recordFields.get(field.id());
    const rawValue = cellValue?.toValue() ?? null;
    fieldValues.set(field.id().toString(), rawValue);
  }

  return fieldValues;
}

function convertReadModelToTableRecord(
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
      continue;
    }
    const cellValueResult = TableRecordCellValue.create(rawValue);
    if (cellValueResult.isErr()) {
      return err(cellValueResult.error);
    }
    fieldValues.push({ fieldId: fieldIdResult.value, value: cellValueResult.value });
  }

  return TableRecord.create({
    id: recordIdResult.value,
    tableId: table.id(),
    fieldValues,
  });
}

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

function buildExplainResult(params: {
  commandInfo: CommandExplainInfo;
  sqlExplains: ReadonlyArray<SqlExplainInfo>;
  totalMs: number;
  sqlExplainMs: number;
  complexityCalculator: ComplexityCalculator;
}): ExplainResult {
  const complexity = params.complexityCalculator.calculate({
    commandInfo: params.commandInfo,
    computedImpact: null,
    sqlExplains: params.sqlExplains,
  });

  return {
    command: params.commandInfo,
    computedImpact: null,
    computedLocks: null,
    linkLocks: null,
    sqlExplains: params.sqlExplains,
    complexity,
    timing: {
      totalMs: params.totalMs,
      dependencyGraphMs: 0,
      planningMs: 0,
      sqlExplainMs: params.sqlExplainMs,
    },
  };
}
