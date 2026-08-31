import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ImportCsvColumn } from '../../commands/ImportCsvCommand';
import { toAsyncIterable } from '../../commands/shared/toAsyncIterable';
import type { BaseId } from '../../domain/base/BaseId';
import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { tableDataSafetyLimitErrors } from '../../domain/shared/TableDataSafetyLimits';
import type { RecordValuesDTO } from '../../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import type { CsvParseResult } from '../../ports/CsvParser';
import { NoopLogger } from '../../ports/defaults/NoopLogger';
import type * as EventBusPort from '../../ports/EventBus';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import type { IImportProgress } from '../../ports/import/IImportSource';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import {
  RecordWriteOperationKind,
  type RecordWriteFieldValues,
} from '../../ports/RecordWritePlugin';
import { TableOperationKind } from '../../ports/TableOperationPlugin';
import type * as TableRecordRepositoryPort from '../../ports/TableRecordRepository';
import type * as TableRepositoryPort from '../../ports/TableRepository';
import type * as TableSchemaRepositoryPort from '../../ports/TableSchemaRepository';
import type * as UnitOfWorkPort from '../../ports/UnitOfWork';
import type { RecordWritePluginExecution } from './RecordWritePluginRunner';
import { RecordWritePluginRunner } from './RecordWritePluginRunner';
import { TableOperationPluginRunner } from './TableOperationPluginRunner';
import {
  abandonTableSchemaOperation,
  beginTableSchemaOperation,
  completeTableSchemaOperation,
  failTableSchemaOperation,
} from './TableSchemaOperationLifecycleService';

type ChunkPluginOptions = {
  readonly table: Table;
  readonly batchSize: number;
  readonly operationId: string;
  readonly totalRecordCount: number;
  readonly events: IDomainEvent[];
};

type InferredCsvFieldType = 'checkbox' | 'number' | 'date' | 'longText' | 'singleLineText';

type ResolvedImportColumn = {
  readonly name: string;
  readonly sourceColumnIndex: number;
  readonly type: InferredCsvFieldType;
};

const csvInferenceSampleSize = 500;
const inferredCsvFieldTypeOrder: InferredCsvFieldType[] = [
  'checkbox',
  'number',
  'date',
  'longText',
  'singleLineText',
];
const dateFormatPatterns: RegExp[] = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/,
  /^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/,
  /^\d{1,2}-\d{1,2}-\d{4}$/,
  /^\d{4}\/\d{1,2}\/\d{1,2}$/,
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,
  /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?$/,
];
const reasonableYearMin = 1;
const reasonableYearMax = 9999;

const tableRecordToRecordWriteFieldValues = (record: TableRecord): RecordWriteFieldValues =>
  new Map(
    record
      .fields()
      .entries()
      .map((entry) => [entry.fieldId.toString(), entry.value.toValue()] as const)
  );

export type TabularImportSource = 'csv' | 'excel';

export type ImportTabularTableInput = {
  readonly baseId: BaseId;
  readonly tableName: TableName | undefined;
  readonly importData: boolean;
  readonly batchSize: number;
  readonly maxRowCount: number | undefined;
  readonly columns: ReadonlyArray<ImportCsvColumn> | undefined;
  readonly parseResult: CsvParseResult;
  readonly source: TabularImportSource;
  readonly onProgress?: (progress: IImportProgress) => void;
  /**
   * When set, a row-count cap stops inserting further rows instead of failing
   * the whole table. Used by multi-sheet Excel import so later worksheets still run.
   */
  readonly truncateOnRowLimit?: boolean;
};

/**
 * Result of creating a table from a parsed tabular import source.
 */
export class ImportTabularTableResult {
  private constructor(
    readonly table: Table,
    readonly totalImported: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    table: Table,
    totalImported: number,
    events: ReadonlyArray<IDomainEvent>
  ): ImportTabularTableResult {
    return new ImportTabularTableResult(table, totalImported, [...events]);
  }
}

/**
 * Shared create-table import workflow for parsed CSV/Excel rows.
 */
export const uniquifyImportName = (name: string, seenNames: ReadonlyArray<string>): string => {
  const trimmed = name.trim() || 'Field';
  if (!seenNames.includes(trimmed)) {
    return trimmed;
  }

  let index = 2;
  let candidate = `${trimmed} ${index}`;
  while (seenNames.includes(candidate)) {
    index += 1;
    candidate = `${trimmed} ${index}`;
  }
  return candidate;
};

export class ImportTabularTableService {
  constructor(
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    private readonly eventBus: EventBusPort.IEventBus,
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    private readonly recordWritePluginRunner: RecordWritePluginRunner = new RecordWritePluginRunner(
      [],
      new NoopLogger(),
      new DefaultTableMapper()
    ),
    private readonly tableOperationPluginRunner: TableOperationPluginRunner = new TableOperationPluginRunner(
      [],
      new NoopLogger()
    )
  ) {}

  async import(
    context: ExecutionContextPort.IExecutionContext,
    command: ImportTabularTableInput
  ): Promise<Result<ImportTabularTableResult, DomainError>> {
    const handler = this;
    return safeTry<ImportTabularTableResult, DomainError>(async function* () {
      const parseResult = command.parseResult;
      const sampledRows = await handler.sampleAsyncRows(
        parseResult.rowsAsync ?? toAsyncIterable(parseResult.rows),
        csvInferenceSampleSize
      );
      const inferenceRows = sampledRows.sampleRows;
      const rowsAsync = sampledRows.rowsAsync;
      const knownRowCount =
        parseResult.rowCount ?? (sampledRows.exhausted ? sampledRows.sampleRows.length : undefined);
      const source = command.source;
      const emptyColumnsCode = source === 'excel' ? 'import.excel.no_columns' : 'csv.no_columns';
      const emptyColumnsMessage =
        source === 'excel' ? 'Excel sheet has no columns' : 'CSV file has no columns';

      if (parseResult.headers.length === 0) {
        return err(
          domainError.validation({
            message: emptyColumnsMessage,
            code: emptyColumnsCode,
          })
        );
      }

      const tableName =
        command.tableName ??
        (yield* TableName.create(
          `Import_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}`
        ));

      const importColumns = yield* handler.resolveImportColumns(
        parseResult.headers,
        inferenceRows,
        command.columns
      );
      const table = yield* handler.buildTableFromColumns(command.baseId, tableName, importColumns);
      const tablePluginExecution = yield* await handler.tableOperationPluginRunner.prepare({
        kind: TableOperationKind.importCsv,
        executionContext: context,
        payload: {
          baseId: command.baseId,
          tableName,
          table,
          fieldCount: table.getFields().length,
          viewCount: table.views().length,
          recordCount: command.importData
            ? capImportRecordCount(knownRowCount ?? 0, command.maxRowCount)
            : 0,
        },
        isTransactionBound: false,
      });
      yield* await tablePluginExecution.guard();

      const persistedTable = yield* await handler.unitOfWork.withTransaction(
        context,
        async (metaTransactionContext) =>
          safeTry<Table, DomainError>(async function* () {
            const persistedTable = yield* await handler.tableRepository.insert(
              metaTransactionContext,
              table
            );
            yield* await beginTableSchemaOperation(
              handler.unitOfWork,
              handler.tableRepository,
              metaTransactionContext,
              persistedTable,
              {
                type: 'table.import',
                payload: {
                  source,
                  durableSource: false,
                },
              }
            );
            return ok(persistedTable);
          }),
        { scope: 'meta' }
      );

      const importResult = await handler.unitOfWork.withTransaction(
        context,
        async (dataTransactionContext) => {
          return safeTry<{ totalImported: number; events: IDomainEvent[] }, DomainError>(
            async function* () {
              yield* await handler.tableSchemaRepository.insert(
                dataTransactionContext,
                persistedTable
              );
              if (!command.importData) {
                command.onProgress?.({
                  phase: 'completed',
                  processedRows: 0,
                  currentBatch: 0,
                  totalRows: 0,
                });
                return ok({ totalImported: 0, events: [] });
              }

              const totalRecordCount = capImportRecordCount(
                knownRowCount ?? 0,
                command.maxRowCount
              );
              command.onProgress?.({
                phase: 'inserting',
                processedRows: 0,
                currentBatch: 0,
                totalRows: knownRowCount,
              });
              const operationId = `import-${source}:${persistedTable.id().toString()}`;
              const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
                kind: RecordWriteOperationKind.createStream,
                executionContext: dataTransactionContext,
                table: persistedTable,
                payload: {
                  recordsFieldValues: [],
                  batchSize: command.batchSize,
                  recordCount: totalRecordCount,
                },
                orchestration: {
                  mode: 'stream',
                  scope: 'operation',
                  operationId,
                  totalRecordCount,
                },
                isTransactionBound: true,
              });
              yield* await pluginExecution.guard();

              const exceedsRowLimit =
                command.maxRowCount !== undefined &&
                (sampledRows.sampleRows.length > command.maxRowCount ||
                  (knownRowCount !== undefined && knownRowCount > command.maxRowCount));
              if (exceedsRowLimit && !command.truncateOnRowLimit) {
                return err(
                  domainError.validation({
                    code: tableDataSafetyLimitErrors.rowsPerTableMax.code,
                    message: `Exceed max row limit: ${command.maxRowCount}`,
                    details: {
                      max: command.maxRowCount,
                      maxRowCount: command.maxRowCount,
                      rowCount: Math.max(sampledRows.sampleRows.length, knownRowCount ?? 0),
                    },
                    localization: {
                      i18nKey: tableDataSafetyLimitErrors.rowsPerTableMax.i18nKey,
                      context: { max: command.maxRowCount },
                    },
                  })
                );
              }

              const fieldIdMap = handler.buildFieldIdMap(
                persistedTable,
                parseResult.headers,
                importColumns
              );
              const recordEvents: IDomainEvent[] = [];
              const recordsIterable = handler.createRecordsIterableAsync(
                rowsAsync,
                fieldIdMap,
                command.maxRowCount,
                command.truncateOnRowLimit === true
              );
              const batchGenerator = persistedTable.createRecordsStreamAsync(recordsIterable, {
                batchSize: command.batchSize,
                typecast: true,
              });

              const insertResult = yield* await handler.tableRecordRepository.insertManyStream(
                dataTransactionContext,
                persistedTable,
                handler.consumeBatchesAsync(
                  batchGenerator,
                  pluginExecution,
                  dataTransactionContext,
                  {
                    table: persistedTable,
                    batchSize: command.batchSize,
                    operationId,
                    totalRecordCount,
                    events: recordEvents,
                  }
                ),
                {
                  deferComputedUpdates: true,
                  enqueueDeferredComputedUpdates: true,
                  onBatchInserted: (progress) => {
                    command.onProgress?.({
                      phase: 'inserting',
                      processedRows: progress.totalInserted,
                      currentBatch: progress.batchIndex + 1,
                      totalRows: knownRowCount,
                    });
                  },
                }
              );

              command.onProgress?.({
                phase: 'completed',
                processedRows: insertResult.totalInserted,
                currentBatch: 0,
                totalRows: insertResult.totalInserted,
              });

              return ok({ totalImported: insertResult.totalInserted, events: recordEvents });
            }
          );
        },
        { scope: 'data' }
      );
      if (importResult.isErr()) {
        // The data-phase transaction (physical table + rows) rolled back, so
        // drop the meta rows committed in the meta phase as well — otherwise a
        // ghost table (meta without storage) stays visible in table lists.
        const cleanupResult = await handler.unitOfWork.withTransaction(
          context,
          async (metaTransactionContext) =>
            handler.tableRepository.delete(metaTransactionContext, persistedTable, {
              mode: 'permanent',
            }),
          { scope: 'meta' }
        );
        if (cleanupResult.isErr()) {
          // Could not remove the meta — fall back to the error provision state
          // so ready-only queries still filter the table out.
          yield* await failTableSchemaOperation(
            handler.unitOfWork,
            handler.tableRepository,
            context,
            persistedTable,
            {
              lastError: importResult.error.message,
              type: 'table.import',
              payload: {
                source,
                durableSource: false,
              },
            }
          );
        } else {
          // Successful cleanup still leaves the pending table.import row. If it
          // stays pending, the schema-operation runner claims it after the stale
          // window and fails with "Only structure-only DotTea imports can be
          // repaired automatically" even though the original CSV error is gone.
          yield* await abandonTableSchemaOperation(
            handler.unitOfWork,
            handler.tableRepository,
            context,
            persistedTable,
            {
              lastError: importResult.error.message,
              type: 'table.import',
              payload: {
                source,
                durableSource: false,
              },
            }
          );
        }
        return err(importResult.error);
      }

      yield* await completeTableSchemaOperation(
        handler.unitOfWork,
        handler.tableRepository,
        context,
        persistedTable,
        { type: 'table.import' }
      );

      // 5. 发布事件
      const events = [...table.pullDomainEvents(), ...importResult.value.events];
      yield* await handler.eventBus.publishMany(context, events);

      return ok(
        ImportTabularTableResult.create(persistedTable, importResult.value.totalImported, events)
      );
    });
  }

  private resolveImportColumns(
    headers: ReadonlyArray<string>,
    sampleRows: ReadonlyArray<Record<string, string>>,
    columns: ReadonlyArray<ImportCsvColumn> | undefined
  ): Result<ReadonlyArray<ResolvedImportColumn>, DomainError> {
    const fieldTypes = this.inferFieldTypes(headers, sampleRows);

    if (!columns?.length) {
      return ok(
        headers.map((header, index) => ({
          name: header || `Column_${index + 1}`,
          sourceColumnIndex: index,
          type: fieldTypes[index] ?? 'singleLineText',
        }))
      );
    }

    const resolvedColumns: ResolvedImportColumn[] = [];
    for (const column of columns) {
      if (column.sourceColumnIndex < 0 || column.sourceColumnIndex >= headers.length) {
        return err(
          domainError.validation({
            code: 'import.column_index_out_of_range',
            message: `Column index ${column.sourceColumnIndex} is out of range`,
            details: {
              sourceColumnIndex: column.sourceColumnIndex,
              columnCount: headers.length,
            },
          })
        );
      }

      const fallbackName = `Column_${column.sourceColumnIndex + 1}`;
      resolvedColumns.push({
        name: column.name || headers[column.sourceColumnIndex] || fallbackName,
        sourceColumnIndex: column.sourceColumnIndex,
        type:
          this.resolveFieldType(column.type) ??
          fieldTypes[column.sourceColumnIndex] ??
          'singleLineText',
      });
    }

    return ok(resolvedColumns);
  }

  /**
   * 从导入列定义构建表。
   */
  private buildTableFromColumns(
    baseId: BaseId,
    tableName: TableName,
    columns: ReadonlyArray<ResolvedImportColumn>
  ): Result<Table, DomainError> {
    const builder = Table.builder().withBaseId(baseId).withName(tableName);
    const seenFieldNames: string[] = [];

    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const fieldName = uniquifyImportName(column.name, seenFieldNames);
      seenFieldNames.push(fieldName);
      const fieldNameResult = FieldName.create(fieldName);
      if (fieldNameResult.isErr()) {
        return err(fieldNameResult.error);
      }

      const fieldBuilder = this.createFieldBuilder(builder, column.type).withName(
        fieldNameResult.value
      );

      // 第一列设为主键
      if (i === 0) {
        fieldBuilder.primary();
      }

      fieldBuilder.done();
    }

    // 添加默认 Grid 视图
    builder.view().defaultGrid().done();

    return builder.build();
  }

  private inferFieldTypes(
    headers: ReadonlyArray<string>,
    sampleRows: ReadonlyArray<Record<string, string>>
  ): InferredCsvFieldType[] {
    return headers.map((header) => {
      const values = sampleRows
        .map((row) => row[header])
        .filter((value): value is string => value != null && value !== '');
      if (values.length === 0) {
        return 'singleLineText';
      }

      let candidates = [...inferredCsvFieldTypeOrder];
      for (const value of values) {
        if (candidates.length <= 1) {
          break;
        }

        if (this.matchesInferredType(value, 'longText')) {
          candidates = ['longText'];
          break;
        }

        candidates = candidates.filter((type) => this.matchesInferredType(value, type));
      }

      return candidates[0] ?? 'singleLineText';
    });
  }

  private matchesInferredType(value: string, type: InferredCsvFieldType): boolean {
    switch (type) {
      case 'checkbox':
        return value.toLowerCase() === 'true' || value.toLowerCase() === 'false';
      case 'number':
        return value.trim() !== '' && !Number.isNaN(Number(value));
      case 'date':
        return this.isValidImportDate(value);
      case 'longText':
        return /\n/.test(value);
      case 'singleLineText':
        return true;
    }
  }

  private isValidImportDate(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || !dateFormatPatterns.some((pattern) => pattern.test(trimmed))) {
      return false;
    }

    const date = new Date(value);
    if (date.toString() === 'Invalid Date') {
      return false;
    }

    const year = date.getFullYear();
    return year >= reasonableYearMin && year <= reasonableYearMax;
  }

  private createFieldBuilder(
    builder: ReturnType<typeof Table.builder>,
    type: InferredCsvFieldType
  ) {
    switch (type) {
      case 'checkbox':
        return builder.field().checkbox();
      case 'number':
        return builder.field().number();
      case 'date':
        return builder.field().date();
      case 'longText':
        return builder.field().longText();
      case 'singleLineText':
        return builder.field().singleLineText();
    }
  }

  private resolveFieldType(type: string | undefined): InferredCsvFieldType | undefined {
    switch (type) {
      case 'checkbox':
      case 'number':
      case 'date':
      case 'longText':
      case 'singleLineText':
        return type;
      default:
        return undefined;
    }
  }

  /**
   * 构建字段 ID 映射（CSV 列名 → 字段 ID）
   */
  private buildFieldIdMap(
    table: Table,
    headers: ReadonlyArray<string>,
    columns: ReadonlyArray<ResolvedImportColumn>
  ): Map<string, string> {
    const fields = table.getFields();
    const map = new Map<string, string>();

    // 按导入列定义匹配，保留 sourceColumnIndex 指向的源列。
    for (let i = 0; i < columns.length && i < fields.length; i++) {
      const header = headers[columns[i].sourceColumnIndex];
      const field = fields[i];
      map.set(header, field.id().toString());
    }

    return map;
  }

  /**
   * 消费异步批次生成器，解包 Result
   */
  private async *consumeBatchesAsync(
    generator: AsyncGenerator<Result<ReadonlyArray<TableRecord>, DomainError>>,
    pluginExecution: RecordWritePluginExecution,
    transactionContext: ExecutionContextPort.IExecutionContext,
    options: ChunkPluginOptions
  ): AsyncGenerator<ReadonlyArray<TableRecord>> {
    let chunkIndex = 0;
    for await (const batchResult of generator) {
      if (batchResult.isErr()) {
        throw batchResult.error;
      }
      const chunkPluginExecution = await this.prepareChunkPluginExecution(
        transactionContext,
        pluginExecution,
        batchResult.value,
        {
          ...options,
          chunkIndex,
        }
      );
      if (chunkPluginExecution.isErr()) {
        throw chunkPluginExecution.error;
      }
      const beforePersistResult =
        await chunkPluginExecution.value.beforePersist(transactionContext);
      if (beforePersistResult.isErr()) {
        throw beforePersistResult.error;
      }
      chunkIndex += 1;
      this.addRecordsBatchCreatedEvent(batchResult.value, options);
      yield batchResult.value;
    }
  }

  private addRecordsBatchCreatedEvent(
    records: ReadonlyArray<TableRecord>,
    options: ChunkPluginOptions
  ): void {
    const eventRecords = this.toEventRecords(records);
    if (eventRecords.length === 0) {
      return;
    }

    options.events.push(
      RecordsBatchCreated.create({
        tableId: options.table.id(),
        baseId: options.table.baseId(),
        records: eventRecords,
        source: { type: 'import' },
      })
    );
  }

  private toEventRecords(records: ReadonlyArray<TableRecord>): ReadonlyArray<RecordValuesDTO> {
    return records.map((record) => ({
      recordId: record.id().toString(),
      fields: record
        .fields()
        .entries()
        .map((entry) => ({
          fieldId: entry.fieldId.toString(),
          value: entry.value.toValue(),
        })),
    }));
  }

  private async prepareChunkPluginExecution(
    transactionContext: ExecutionContextPort.IExecutionContext,
    previousExecution: RecordWritePluginExecution,
    records: ReadonlyArray<TableRecord>,
    options: ChunkPluginOptions & { chunkIndex: number }
  ): Promise<Result<RecordWritePluginExecution, DomainError>> {
    const recordsFieldValues = records.map(tableRecordToRecordWriteFieldValues);
    const result = await this.recordWritePluginRunner.prepare(
      {
        kind: RecordWriteOperationKind.createStream,
        executionContext: transactionContext,
        table: options.table,
        payload: {
          recordsFieldValues,
          batchSize: options.batchSize,
          recordCount: records.length,
        },
        orchestration: {
          mode: 'stream',
          scope: 'chunk',
          operationId: options.operationId,
          totalRecordCount: options.totalRecordCount,
          chunkIndex: options.chunkIndex,
        },
        isTransactionBound: true,
      },
      { previousExecution }
    );
    if (result.isErr()) {
      return err(result.error);
    }

    const guardResult = await result.value.guard();
    if (guardResult.isErr()) {
      return err(guardResult.error);
    }

    return ok(result.value);
  }

  private async sampleAsyncRows(
    rowsAsync: AsyncIterable<Record<string, string>>,
    sampleSize: number
  ): Promise<{
    sampleRows: ReadonlyArray<Record<string, string>>;
    rowsAsync: AsyncIterable<Record<string, string>>;
    exhausted: boolean;
  }> {
    const iterator = rowsAsync[Symbol.asyncIterator]();
    const sampleRows: Record<string, string>[] = [];
    let exhausted = false;

    while (sampleRows.length < sampleSize) {
      const next = await iterator.next();
      if (next.done) {
        exhausted = true;
        break;
      }
      sampleRows.push(next.value);
    }

    return {
      sampleRows,
      rowsAsync: this.prependRows(sampleRows, iterator),
      exhausted,
    };
  }

  private async *prependRows(
    rows: ReadonlyArray<Record<string, string>>,
    iterator: AsyncIterator<Record<string, string>>
  ): AsyncIterable<Record<string, string>> {
    for (const row of rows) {
      yield row;
    }

    while (true) {
      const next = await iterator.next();
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }

  /**
   * 将 CSV 行异步迭代器转换为记录字段值的 AsyncIterable
   */
  private async *createRecordsIterableAsync(
    rows: AsyncIterable<Record<string, string>>,
    fieldIdMap: Map<string, string>,
    maxRowCount?: number,
    truncateOnRowLimit = false
  ): AsyncIterable<ReadonlyMap<string, unknown>> {
    let rowCount = 0;
    for await (const row of rows) {
      rowCount += 1;
      if (maxRowCount !== undefined && rowCount > maxRowCount) {
        if (truncateOnRowLimit) {
          return;
        }
        throw domainError.validation({
          code: tableDataSafetyLimitErrors.rowsPerTableMax.code,
          message: `Exceed max row limit: ${maxRowCount}`,
          details: {
            max: maxRowCount,
            maxRowCount,
            rowCount,
          },
          localization: {
            i18nKey: tableDataSafetyLimitErrors.rowsPerTableMax.i18nKey,
            context: { max: maxRowCount },
          },
        });
      }

      const fieldValues = new Map<string, unknown>();

      for (const [csvColumn, value] of Object.entries(row)) {
        const fieldId = fieldIdMap.get(csvColumn);
        if (value === '') {
          continue;
        }
        if (fieldId) {
          fieldValues.set(fieldId, value);
        }
      }

      yield fieldValues;
    }
  }
}

const capImportRecordCount = (planned: number, maxRowCount: number | undefined): number => {
  if (maxRowCount === undefined) {
    return planned;
  }
  return Math.min(planned, Math.max(0, maxRowCount));
};
