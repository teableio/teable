import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import type { RecordWritePluginExecution } from '../application/services/RecordWritePluginRunner';
import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import {
  beginTableSchemaOperation,
  completeTableSchemaOperation,
  failTableSchemaOperation,
} from '../application/services/TableSchemaOperationLifecycleService';
import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { RecordValuesDTO } from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { FieldName } from '../domain/table/fields/FieldName';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import * as CsvParserPort from '../ports/CsvParser';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import { RecordWriteOperationKind, type RecordWriteFieldValues } from '../ports/RecordWritePlugin';
import { TableOperationKind } from '../ports/TableOperationPlugin';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ImportCsvCommand, type ImportCsvColumn } from './ImportCsvCommand';

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

/**
 * CSV 导入结果
 */
export class ImportCsvResult {
  private constructor(
    readonly table: Table,
    readonly totalImported: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    table: Table,
    totalImported: number,
    events: ReadonlyArray<IDomainEvent>
  ): ImportCsvResult {
    return new ImportCsvResult(table, totalImported, [...events]);
  }
}

/**
 * CSV 导入 Handler
 *
 * 流程：
 * 1. 解析 CSV 头部获取列名
 * 2. 创建表（所有列为 SingleLineText 类型）
 * 3. 流式导入数据
 */
@CommandHandler(ImportCsvCommand)
@injectable()
export class ImportCsvHandler implements ICommandHandler<ImportCsvCommand, ImportCsvResult> {
  constructor(
    @inject(v2CoreTokens.csvParser)
    private readonly csvParser: CsvParserPort.ICsvParser,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner = new RecordWritePluginRunner(
      [],
      new NoopLogger(),
      new DefaultTableMapper()
    ),
    @inject(v2CoreTokens.tableOperationPluginRunner)
    private readonly tableOperationPluginRunner: TableOperationPluginRunner = new TableOperationPluginRunner(
      [],
      new NoopLogger()
    )
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ImportCsvCommand
  ): Promise<Result<ImportCsvResult, DomainError>> {
    const handler = this;
    return safeTry<ImportCsvResult, DomainError>(async function* () {
      // 1. 解析 CSV（根据数据源类型选择同步或异步）
      const parseResult = yield* await handler.parseCsvSource(
        command.csvSource,
        command.useFirstRowAsHeader
      );
      const asyncRows = parseResult.rowsAsync
        ? await handler.sampleAsyncRows(parseResult.rowsAsync, csvInferenceSampleSize)
        : undefined;
      const rows = parseResult.rowsAsync ? undefined : [...parseResult.rows];
      const inferenceRows = asyncRows?.sampleRows ?? rows?.slice(0, csvInferenceSampleSize) ?? [];
      const rowsAsync = asyncRows?.rowsAsync;

      if (parseResult.headers.length === 0) {
        return err(
          domainError.validation({
            message: 'CSV file has no columns',
            code: 'csv.no_columns',
          })
        );
      }

      // 2. 创建表名
      const tableName =
        command.tableName ??
        (yield* TableName.create(
          `Import_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}`
        ));

      // 3. 构建表（V2 owns CSV field type inference unless callers provide columns）
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
          recordCount: command.importData ? rows?.length ?? 0 : 0,
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
                  source: 'csv',
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
                return ok({ totalImported: 0, events: [] });
              }

              const totalRecordCount = rows?.length ?? 0;
              const operationId = `import-csv:${persistedTable.id().toString()}`;
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

              if (command.maxRowCount !== undefined && rows && rows.length > command.maxRowCount) {
                return err(
                  domainError.validation({
                    code: 'validation.limit.rows_per_table_max',
                    message: `Exceed max row limit: ${command.maxRowCount}`,
                    details: {
                      max: command.maxRowCount,
                      maxRowCount: command.maxRowCount,
                      rowCount: rows.length,
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

              const recordsIterable = rowsAsync
                ? handler.createRecordsIterableAsync(rowsAsync, fieldIdMap, command.maxRowCount)
                : handler.createRecordsIterable(rows ?? [], fieldIdMap);

              const batchGenerator = rowsAsync
                ? persistedTable.createRecordsStreamAsync(
                    recordsIterable as AsyncIterable<ReadonlyMap<string, unknown>>,
                    {
                      batchSize: command.batchSize,
                      typecast: true,
                    }
                  )
                : persistedTable.createRecordsStream(
                    recordsIterable as Iterable<ReadonlyMap<string, unknown>>,
                    {
                      batchSize: command.batchSize,
                      typecast: true,
                    }
                  );

              const insertResult = yield* await handler.tableRecordRepository.insertManyStream(
                dataTransactionContext,
                persistedTable,
                parseResult.rowsAsync
                  ? handler.consumeBatchesAsync(
                      batchGenerator as AsyncGenerator<
                        Result<ReadonlyArray<TableRecord>, DomainError>
                      >,
                      pluginExecution,
                      dataTransactionContext,
                      {
                        table: persistedTable,
                        batchSize: command.batchSize,
                        operationId,
                        totalRecordCount,
                        events: recordEvents,
                      }
                    )
                  : handler.consumeBatches(
                      batchGenerator as Generator<Result<ReadonlyArray<TableRecord>, DomainError>>,
                      pluginExecution,
                      dataTransactionContext,
                      {
                        table: persistedTable,
                        batchSize: command.batchSize,
                        operationId,
                        totalRecordCount,
                        events: recordEvents,
                      }
                    )
              );

              return ok({ totalImported: insertResult.totalInserted, events: recordEvents });
            }
          );
        },
        { scope: 'data' }
      );
      if (importResult.isErr()) {
        yield* await failTableSchemaOperation(
          handler.unitOfWork,
          handler.tableRepository,
          context,
          persistedTable,
          {
            lastError: importResult.error.message,
            type: 'table.import',
            payload: {
              source: 'csv',
              durableSource: false,
            },
          }
        );
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

      return ok(ImportCsvResult.create(persistedTable, importResult.value.totalImported, events));
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
    baseId: ImportCsvCommand['baseId'],
    tableName: TableName,
    columns: ReadonlyArray<ResolvedImportColumn>
  ): Result<Table, DomainError> {
    const builder = Table.builder().withBaseId(baseId).withName(tableName);
    const seenFieldNames: string[] = [];

    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const fieldName = this.getUniqueFieldName(column.name, seenFieldNames);
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

  private getUniqueFieldName(name: string, seenNames: ReadonlyArray<string>): string {
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
   * 将 CSV 行转换为记录字段值的 Iterable
   */
  private *createRecordsIterable(
    rows: Iterable<Record<string, string>>,
    fieldIdMap: Map<string, string>
  ): Iterable<ReadonlyMap<string, unknown>> {
    for (const row of rows) {
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

  /**
   * 消费批次生成器，解包 Result
   */
  private async *consumeBatches(
    generator: Generator<Result<ReadonlyArray<TableRecord>, DomainError>>,
    pluginExecution: RecordWritePluginExecution,
    transactionContext: ExecutionContextPort.IExecutionContext,
    options: ChunkPluginOptions
  ): AsyncGenerator<ReadonlyArray<TableRecord>> {
    let chunkIndex = 0;
    for (const batchResult of generator) {
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

  /**
   * 解析 CSV 数据源
   * 根据类型选择同步或异步解析
   */
  private async parseCsvSource(
    source: CsvParserPort.CsvSource,
    useFirstRowAsHeader: boolean
  ): Promise<Result<CsvParserPort.CsvParseResult, DomainError>> {
    const options: CsvParserPort.CsvParseOptions = { hasHeader: useFirstRowAsHeader };
    // stream 和 url 类型需要异步解析
    if (source.type === 'stream' || source.type === 'url') {
      if (!this.csvParser.parseAsync) {
        return err(
          domainError.infrastructure({
            message: 'CSV parser does not support async parsing for stream/url sources',
            code: 'csv.async_not_supported',
          })
        );
      }
      return this.csvParser.parseAsync(source, options);
    }

    // string 和 buffer 使用同步解析
    return this.csvParser.parse(source, options);
  }

  private async sampleAsyncRows(
    rowsAsync: AsyncIterable<Record<string, string>>,
    sampleSize: number
  ): Promise<{
    sampleRows: ReadonlyArray<Record<string, string>>;
    rowsAsync: AsyncIterable<Record<string, string>>;
  }> {
    const iterator = rowsAsync[Symbol.asyncIterator]();
    const sampleRows: Record<string, string>[] = [];

    while (sampleRows.length < sampleSize) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      sampleRows.push(next.value);
    }

    return {
      sampleRows,
      rowsAsync: this.prependRows(sampleRows, iterator),
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
    maxRowCount?: number
  ): AsyncIterable<ReadonlyMap<string, unknown>> {
    let rowCount = 0;
    for await (const row of rows) {
      rowCount += 1;
      if (maxRowCount !== undefined && rowCount > maxRowCount) {
        throw domainError.validation({
          code: 'validation.limit.rows_per_table_max',
          message: `Exceed max row limit: ${maxRowCount}`,
          details: {
            max: maxRowCount,
            maxRowCount,
            rowCount,
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
