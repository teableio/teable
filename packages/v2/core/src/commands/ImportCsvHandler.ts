import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  beginTableSchemaOperation,
  completeTableSchemaOperation,
  failTableSchemaOperation,
} from '../application/services/TableSchemaOperationLifecycleService';
import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { FieldName } from '../domain/table/fields/FieldName';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import * as CsvParserPort from '../ports/CsvParser';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ImportCsvCommand } from './ImportCsvCommand';

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
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ImportCsvCommand
  ): Promise<Result<ImportCsvResult, DomainError>> {
    const handler = this;
    return safeTry<ImportCsvResult, DomainError>(async function* () {
      // 1. 解析 CSV（根据数据源类型选择同步或异步）
      const parseResult = yield* await handler.parseCsvSource(command.csvSource);

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

      // 3. 构建表（所有列为 SingleLineText）
      const table = yield* handler.buildTableFromHeaders(
        command.baseId,
        tableName,
        parseResult.headers
      );

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
          return safeTry<{ totalImported: number }, DomainError>(async function* () {
            yield* await handler.tableSchemaRepository.insert(
              dataTransactionContext,
              persistedTable
            );

            const fieldIdMap = handler.buildFieldIdMap(persistedTable, parseResult.headers);

            const recordsIterable = parseResult.rowsAsync
              ? handler.createRecordsIterableAsync(parseResult.rowsAsync, fieldIdMap)
              : handler.createRecordsIterable(parseResult.rows, fieldIdMap);

            const batchGenerator = parseResult.rowsAsync
              ? persistedTable.createRecordsStreamAsync(
                  recordsIterable as AsyncIterable<ReadonlyMap<string, unknown>>,
                  {
                    batchSize: command.batchSize,
                  }
                )
              : persistedTable.createRecordsStream(
                  recordsIterable as Iterable<ReadonlyMap<string, unknown>>,
                  {
                    batchSize: command.batchSize,
                  }
                );

            const insertResult = yield* await handler.tableRecordRepository.insertManyStream(
              dataTransactionContext,
              persistedTable,
              parseResult.rowsAsync
                ? handler.consumeBatchesAsync(
                    batchGenerator as AsyncGenerator<
                      Result<ReadonlyArray<TableRecord>, DomainError>
                    >
                  )
                : handler.consumeBatches(
                    batchGenerator as Generator<Result<ReadonlyArray<TableRecord>, DomainError>>
                  )
            );

            return ok({ totalImported: insertResult.totalInserted });
          });
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
      const events = [...table.pullDomainEvents()];
      yield* await handler.eventBus.publishMany(context, events);

      return ok(ImportCsvResult.create(persistedTable, importResult.value.totalImported, events));
    });
  }

  /**
   * 从 CSV 头部构建表
   * 所有列都是 SingleLineText 类型，第一列为主键
   */
  private buildTableFromHeaders(
    baseId: ImportCsvCommand['baseId'],
    tableName: TableName,
    headers: ReadonlyArray<string>
  ): Result<Table, DomainError> {
    const builder = Table.builder().withBaseId(baseId).withName(tableName);

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const fieldNameResult = FieldName.create(header || `Column_${i + 1}`);
      if (fieldNameResult.isErr()) {
        return err(fieldNameResult.error);
      }

      const fieldBuilder = builder.field().singleLineText().withName(fieldNameResult.value);

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

  /**
   * 构建字段 ID 映射（CSV 列名 → 字段 ID）
   */
  private buildFieldIdMap(table: Table, headers: ReadonlyArray<string>): Map<string, string> {
    const fields = table.getFields();
    const map = new Map<string, string>();

    // 按顺序匹配（假设字段顺序与 headers 顺序一致）
    for (let i = 0; i < headers.length && i < fields.length; i++) {
      const header = headers[i];
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
  private *consumeBatches(
    generator: Generator<Result<ReadonlyArray<TableRecord>, DomainError>>
  ): Generator<ReadonlyArray<TableRecord>> {
    for (const batchResult of generator) {
      if (batchResult.isErr()) {
        throw batchResult.error;
      }
      yield batchResult.value;
    }
  }

  /**
   * 消费异步批次生成器，解包 Result
   */
  private async *consumeBatchesAsync(
    generator: AsyncGenerator<Result<ReadonlyArray<TableRecord>, DomainError>>
  ): AsyncGenerator<ReadonlyArray<TableRecord>> {
    for await (const batchResult of generator) {
      if (batchResult.isErr()) {
        throw batchResult.error;
      }
      yield batchResult.value;
    }
  }

  /**
   * 解析 CSV 数据源
   * 根据类型选择同步或异步解析
   */
  private async parseCsvSource(
    source: CsvParserPort.CsvSource
  ): Promise<Result<CsvParserPort.CsvParseResult, DomainError>> {
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
      return this.csvParser.parseAsync(source);
    }

    // string 和 buffer 使用同步解析
    return this.csvParser.parse(source);
  }

  /**
   * 将 CSV 行异步迭代器转换为记录字段值的 AsyncIterable
   */
  private async *createRecordsIterableAsync(
    rows: AsyncIterable<Record<string, string>>,
    fieldIdMap: Map<string, string>
  ): AsyncIterable<ReadonlyMap<string, unknown>> {
    for await (const row of rows) {
      const fieldValues = new Map<string, unknown>();

      for (const [csvColumn, value] of Object.entries(row)) {
        const fieldId = fieldIdMap.get(csvColumn);
        if (fieldId) {
          fieldValues.set(fieldId, value);
        }
      }

      yield fieldValues;
    }
  }
}
