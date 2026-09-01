import { inject, injectable } from '@teable/v2-di';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ImportTabularTableService } from '../application/services/ImportTabularTableService';
import type { ImportTabularTableResult } from '../application/services/ImportTabularTableService';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import * as CsvParserPort from '../ports/CsvParser';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ImportCsvCommand } from './ImportCsvCommand';

export { ImportTabularTableResult as ImportCsvResult } from '../application/services/ImportTabularTableService';

/**
 * CSV 导入 Handler
 *
 * 流程：
 * 1. 解析 CSV 头部获取列名
 * 2. 创建表
 * 3. 流式导入数据
 */
@CommandHandler(ImportCsvCommand)
@injectable()
export class ImportCsvHandler
  implements ICommandHandler<ImportCsvCommand, ImportTabularTableResult>
{
  private readonly tabularImporter: ImportTabularTableService;

  constructor(
    @inject(v2CoreTokens.csvParser)
    private readonly csvParser: CsvParserPort.ICsvParser,
    @inject(v2CoreTokens.tableRepository)
    tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.eventBus)
    eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.recordWritePluginRunner)
    recordWritePluginRunner: RecordWritePluginRunner = new RecordWritePluginRunner(
      [],
      new NoopLogger(),
      new DefaultTableMapper()
    ),
    @inject(v2CoreTokens.tableOperationPluginRunner)
    tableOperationPluginRunner: TableOperationPluginRunner = new TableOperationPluginRunner(
      [],
      new NoopLogger()
    )
  ) {
    this.tabularImporter = new ImportTabularTableService(
      tableRepository,
      tableSchemaRepository,
      tableRecordRepository,
      eventBus,
      unitOfWork,
      recordWritePluginRunner,
      tableOperationPluginRunner
    );
  }

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ImportCsvCommand
  ): Promise<Result<ImportTabularTableResult, DomainError>> {
    const handler = this;
    return safeTry<ImportTabularTableResult, DomainError>(async function* () {
      const parseResult = yield* await handler.parseCsvSource(
        command.csvSource,
        command.useFirstRowAsHeader
      );
      command.onProgress?.({
        phase: 'parsing',
        processedRows: 0,
        currentBatch: 0,
        totalRows: parseResult.rowCount,
      });
      return handler.tabularImporter.import(context, {
        baseId: command.baseId,
        tableName: command.tableName,
        importData: command.importData,
        batchSize: command.batchSize,
        maxRowCount: command.maxRowCount,
        columns: command.columns,
        parseResult,
        source: 'csv',
        onProgress: command.onProgress,
      });
    });
  }

  private async parseCsvSource(
    source: CsvParserPort.CsvSource,
    useFirstRowAsHeader: boolean
  ): Promise<Result<CsvParserPort.CsvParseResult, DomainError>> {
    const options: CsvParserPort.CsvParseOptions = { hasHeader: useFirstRowAsHeader };
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

    return this.csvParser.parse(source, options);
  }
}
