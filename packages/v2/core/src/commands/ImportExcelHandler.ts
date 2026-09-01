import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  uniquifyImportName,
  ImportTabularTableService,
} from '../application/services/ImportTabularTableService';
import type { ImportTabularTableResult } from '../application/services/ImportTabularTableService';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import type { CsvParseResult } from '../ports/CsvParser';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type { IImportParseResult } from '../ports/import/IImportSource';
import * as IImportSourceRegistryPort from '../ports/import/IImportSourceRegistry';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import type { ImportExcelColumn } from './ImportExcelCommand';
import { ImportExcelCommand } from './ImportExcelCommand';

export { ImportTabularTableResult as ImportExcelResult } from '../application/services/ImportTabularTableService';

const excelCellToString = (value: unknown): string => {
  if (value == null) {
    return '';
  }
  return String(value);
};

export const uniquifyExcelHeaders = (headers: ReadonlyArray<string>): string[] => {
  const seen: string[] = [];
  return headers.map((header, index) => {
    const unique = uniquifyImportName(header || `Column_${index + 1}`, seen);
    seen.push(unique);
    return unique;
  });
};

export const excelParseResultToCsvParseResult = (
  parseResult: IImportParseResult,
  useFirstRowAsHeader: boolean,
  columns?: ReadonlyArray<ImportExcelColumn>
): Result<CsvParseResult, DomainError> => {
  const skipFirstNLines = useFirstRowAsHeader ? 1 : 0;
  const columnCount = Math.max(
    parseResult.headers.length,
    columns?.reduce((max, column) => Math.max(max, column.sourceColumnIndex + 1), 0) ?? 0
  );

  let headers: string[];
  if (useFirstRowAsHeader) {
    headers = uniquifyExcelHeaders(
      parseResult.headers.map((header, index) => header || `Column_${index + 1}`)
    );
  } else {
    const seen: string[] = [];
    headers = Array.from({ length: columnCount }, (_, index) => {
      const named = columns?.find((column) => column.sourceColumnIndex === index)?.name;
      const unique = uniquifyImportName(named || `Field ${index + 1}`, seen);
      seen.push(unique);
      return unique;
    });
  }

  if (headers.length === 0) {
    return err(
      domainError.validation({
        message: 'Excel sheet has no columns',
        code: 'import.excel.no_columns',
      })
    );
  }

  const mapRow = (row: ReadonlyArray<unknown>): Record<string, string> => {
    const record: Record<string, string> = {};
    for (let index = 0; index < headers.length; index++) {
      record[headers[index]] = excelCellToString(row[index]);
    }
    return record;
  };

  function* namedRows(rows: Iterable<ReadonlyArray<unknown>>): Iterable<Record<string, string>> {
    let rowIndex = 0;
    for (const row of rows) {
      if (rowIndex++ < skipFirstNLines) {
        continue;
      }
      yield mapRow(row);
    }
  }

  async function* namedRowsAsync(
    rows: AsyncIterable<ReadonlyArray<unknown>>
  ): AsyncIterable<Record<string, string>> {
    let rowIndex = 0;
    for await (const row of rows) {
      if (rowIndex++ < skipFirstNLines) {
        continue;
      }
      yield mapRow(row);
    }
  }

  const dataRowCount =
    parseResult.rowCount != null ? Math.max(parseResult.rowCount - skipFirstNLines, 0) : undefined;

  if (parseResult.rowsAsync) {
    return ok({
      headers,
      rows: [],
      rowsAsync: namedRowsAsync(parseResult.rowsAsync),
      rowCount: dataRowCount,
    });
  }

  return ok({
    headers,
    rows: namedRows(parseResult.rows ?? []),
    rowCount: dataRowCount,
  });
};

/**
 * Excel 新建表导入 Handler。
 *
 * 1. 通过 import source registry 解析指定 worksheet
 * 2. 将 array rows 转成 CSV 风格 named rows（重复表头 uniquify）
 * 3. 复用 ImportTabularTableService 建表并同步写入数据
 */
@CommandHandler(ImportExcelCommand)
@injectable()
export class ImportExcelHandler
  implements ICommandHandler<ImportExcelCommand, ImportTabularTableResult>
{
  private readonly tabularImporter: ImportTabularTableService;

  constructor(
    @inject(v2CoreTokens.importSourceRegistry)
    private readonly registry: IImportSourceRegistryPort.IImportSourceRegistry,
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
    command: ImportExcelCommand
  ): Promise<Result<ImportTabularTableResult, DomainError>> {
    const handler = this;
    return safeTry<ImportTabularTableResult, DomainError>(async function* () {
      const adapter = yield* handler.registry.getAdapter(command.source.type);
      const parseResult = yield* await adapter.parse(command.source, {
        sheetName: command.sheetName,
      });
      const csvParseResult = yield* excelParseResultToCsvParseResult(
        parseResult,
        command.useFirstRowAsHeader,
        command.columns
      );
      const totalRows =
        parseResult.rowCount != null
          ? Math.max(parseResult.rowCount - (command.useFirstRowAsHeader ? 1 : 0), 0)
          : undefined;
      command.onProgress?.({
        phase: 'parsing',
        processedRows: 0,
        currentBatch: 0,
        totalRows,
      });
      return handler.tabularImporter.import(context, {
        baseId: command.baseId,
        tableName: command.tableName,
        importData: command.importData,
        batchSize: command.batchSize,
        maxRowCount: command.maxRowCount,
        columns: command.columns,
        parseResult: csvParseResult,
        source: 'excel',
        onProgress: command.onProgress,
        truncateOnRowLimit: command.truncateOnRowLimit,
      });
    });
  }
}
