import { Injectable, HttpException, HttpStatus, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpErrorCode } from '@teable/core';
import {
  BaseNodeResourceType,
  CreateRecordAction,
  SUPPORTEDTYPE,
  type IImportOptionRo,
  type IImportSheetSummary,
  type IImportStreamErrorEvent,
  type IImportStreamEvent,
  type IImportStreamProgressEvent,
  type IInplaceImportOptionRo,
  type ITableFullVo,
} from '@teable/openapi';
import { mapDomainErrorToHttpStatus, mapTableToDto } from '@teable/v2-contract-http';
import {
  v2CoreTokens,
  type ICommandBus,
  ImportCsvCommand,
  type ImportCsvResult,
  ImportExcelCommand,
  type ImportExcelResult,
  ImportRecordsCommand,
  type ImportRecordsResult,
  type Table,
  AsyncIterableQueue,
  type DomainError,
  type IImportProgress,
  type IImportSourceRegistry,
  ok,
} from '@teable/v2-core';
import { difference } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { BaseConfig, type IBaseConfig } from '../../../configs/base.config';
import { CustomHttpException } from '../../../custom.exception';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { BaseNodeService } from '../../base-node/base-node.service';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';
import { safeFetch } from '../../../utils/ssrf-http';
import {
  getImportRowLimitMax,
  remainingImportRowCount,
  resolveTruncatedSheetRetryCap,
} from './import-sheet-row-limit';

const maxImportStreamBufferedEvents = 64;

/**
 * V2 Import Open API Service
 *
 * Handles import operations using the V2 architecture via CommandBus.
 */
@Injectable()
export class ImportOpenApiV2Service {
  private readonly logger = new Logger(ImportOpenApiV2Service.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>,
    private readonly configService: ConfigService,
    private readonly audit: AuditScope,
    private readonly eventEmitter: EventEmitter2,
    private readonly baseNodeService: BaseNodeService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @Optional()
    private readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService
  ) {}

  /**
   * Resolve a relative URL to an absolute URL.
   * If the URL is already absolute, return as-is.
   */
  private resolveUrl(url: string): string {
    const trimmedUrl = url.trim();
    if (z.string().url().safeParse(trimmedUrl).success) {
      return trimmedUrl;
    }
    const storagePrefix =
      this.baseConfig.storagePrefix ?? process.env.STORAGE_PREFIX ?? process.env.PUBLIC_ORIGIN;
    if (storagePrefix) {
      const normalizedPrefix = storagePrefix.replace(/\/$/, '');
      const normalizedPath = trimmedUrl.startsWith('/') ? trimmedUrl : `/${trimmedUrl}`;
      return `${normalizedPrefix}${normalizedPath}`;
    }
    // For relative URLs, use localhost with the configured port
    const port = this.configService.get<number>('PORT') || 3000;
    return `http://localhost:${port}${trimmedUrl}`;
  }

  /**
   * Create table(s) from a CSV or Excel file using V2.
   * Excel is imported in-request like CSV; it is not sent back to v1.
   */
  async createTableFromImport(
    baseId: string,
    importOptions: IImportOptionRo,
    maxRowCount?: number
  ): Promise<ITableFullVo[]> {
    // Fail-fast before the long import. Placement is host-side after the table
    // is ready (the command already finished completeTableSchemaOperation).
    if (importOptions.folderId) {
      const folderNodeId = await this.baseNodeService.resolveFolderNodeId(
        baseId,
        importOptions.folderId
      );
      importOptions = { ...importOptions, folderId: folderNodeId };
    }

    if (importOptions.fileType === SUPPORTEDTYPE.CSV) {
      return await this.createTableFromCsvImport(baseId, importOptions, maxRowCount);
    }
    if (importOptions.fileType === SUPPORTEDTYPE.EXCEL) {
      return (await this.createTableFromExcelImport(baseId, importOptions, maxRowCount)).tables;
    }
    throw new HttpException(
      `V2 create-table import does not support ${importOptions.fileType}`,
      HttpStatus.BAD_REQUEST
    );
  }

  /**
   * Create a new table from a CSV file using V2 architecture via CommandBus.
   *
   * This adapts the existing V1 OpenAPI payload shape used by the UI
   * (attachmentUrl + worksheets) into the V2 ImportCsvCommand URL source.
   */
  @Audit({
    rootAction: CreateRecordAction.Import,
    resourceId: (baseId: string) => baseId,
    params: (_baseId: string, importOptions: IImportOptionRo) => ({
      fileType: importOptions.fileType,
    }),
  })
  async createTableFromCsvImport(
    baseId: string,
    importOptions: IImportOptionRo,
    maxRowCount?: number,
    onProgress?: (progress: IImportProgress) => void
  ): Promise<ITableFullVo[]> {
    await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);

    if (importOptions.fileType !== SUPPORTEDTYPE.CSV) {
      throw new HttpException(
        'V2 create-table import only supports CSV files',
        HttpStatus.BAD_REQUEST
      );
    }

    const worksheets = Object.values(importOptions.worksheets);
    const worksheet = worksheets.find((item) => item.importData) ?? worksheets[0];
    if (!worksheet) {
      return [];
    }

    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const resolvedUrl = this.resolveUrl(importOptions.attachmentUrl);
    // Keep 0 as a real limit ("no remaining quota") — treating it as undefined
    // would disable the row-limit check entirely for over-limit spaces.
    const normalizedMaxRowCount =
      maxRowCount !== undefined && maxRowCount >= 0 ? maxRowCount : undefined;

    const commandResult = ImportCsvCommand.createFromUrl({
      baseId,
      csvUrl: resolvedUrl,
      tableName: worksheet.name,
      importData: worksheet.importData,
      useFirstRowAsHeader: worksheet.useFirstRowAsHeader,
      columns: worksheet.columns.length
        ? worksheet.columns.map((column) => ({
            name: column.name,
            sourceColumnIndex: column.sourceColumnIndex,
            type: column.type,
          }))
        : undefined,
      batchSize: normalizedMaxRowCount ? Math.min(normalizedMaxRowCount, 500) : 500,
      maxRowCount: normalizedMaxRowCount,
    });
    if (commandResult.isErr()) {
      throwV2Error(commandResult.error, mapDomainErrorToHttpStatus(commandResult.error));
    }

    const command = onProgress
      ? commandResult.value.withOnProgress(onProgress)
      : commandResult.value;

    const result = await commandBus.execute<ImportCsvCommand, ImportCsvResult>(context, command);
    if (result.isErr()) {
      this.logger.error('V2 import CSV failed', result.error);
      this.eventEmitter.emit(Events.V2_TABLE_IMPORT_FINISH, {
        baseId,
        status: 'failed',
        error: result.error.message,
      });
      throwV2Error(result.error, mapDomainErrorToHttpStatus(result.error));
    }

    const tableId = result.value.table.id().toString();
    await this.attachImportedTableToFolder(baseId, tableId, importOptions.folderId);
    const table = this.mapImportedTable(result.value.table);
    this.eventEmitter.emit(Events.V2_TABLE_IMPORT_FINISH, {
      baseId,
      tableId,
      status: 'completed',
    });
    return [table];
  }

  /**
   * Create a table per Excel worksheet using V2 architecture via CommandBus.
   * Completes in-request (same as v2 CSV), including importData=false schema-only sheets.
   */
  @Audit({
    rootAction: CreateRecordAction.Import,
    resourceId: (baseId: string) => baseId,
    params: (_baseId: string, importOptions: IImportOptionRo) => ({
      fileType: importOptions.fileType,
    }),
  })
  async createTableFromExcelImport(
    baseId: string,
    importOptions: IImportOptionRo,
    maxRowCount?: number,
    onProgress?: (
      progress: IImportProgress,
      sheet: { index: number; count: number; name: string; key: string }
    ) => void,
    prefetchedExcelData?: Uint8Array
  ): Promise<{ tables: ITableFullVo[]; sheets: IImportSheetSummary[] }> {
    await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);

    if (importOptions.fileType !== SUPPORTEDTYPE.EXCEL) {
      throw new HttpException(
        'V2 create-table Excel import requires an Excel file',
        HttpStatus.BAD_REQUEST
      );
    }

    const worksheets = Object.entries(importOptions.worksheets);
    if (worksheets.length === 0) {
      return { tables: [], sheets: [] };
    }

    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const excelBytes =
      prefetchedExcelData ?? (await this.fetchAttachmentBytes(importOptions.attachmentUrl));
    const normalizedMaxRowCount =
      maxRowCount !== undefined && maxRowCount >= 0 ? maxRowCount : undefined;

    let remaining = normalizedMaxRowCount;
    const tables: ITableFullVo[] = [];
    const sheets: IImportSheetSummary[] = [];
    let firstSheetError: DomainError | undefined;

    for (const [sheetIndex, [sheetKey, worksheet]] of worksheets.entries()) {
      const skipData = remaining === 0;
      const sheetMax = skipData ? undefined : remaining;
      let expectedRows: number | undefined;
      const sheetMeta = {
        index: sheetIndex,
        count: worksheets.length,
        name: worksheet.name,
        key: sheetKey,
      };

      const buildCommand = (cap: number | undefined) => {
        const commandResult = ImportExcelCommand.createFromBuffer({
          baseId,
          excelData: excelBytes,
          tableName: worksheet.name,
          importData: worksheet.importData && !skipData,
          useFirstRowAsHeader: worksheet.useFirstRowAsHeader,
          sheetName: sheetKey,
          fileType: importOptions.fileType,
          columns: worksheet.columns.length
            ? worksheet.columns.map((column) => ({
                name: column.name,
                sourceColumnIndex: column.sourceColumnIndex,
                type: column.type,
              }))
            : undefined,
          batchSize: cap ? Math.min(cap, 500) : 500,
          maxRowCount: cap,
        });
        if (commandResult.isErr()) {
          return commandResult;
        }
        let command = commandResult.value.withTruncateOnRowLimit(true);
        if (onProgress) {
          command = command.withOnProgress((progress) => {
            if (progress.totalRows != null) {
              expectedRows = progress.totalRows;
            }
            onProgress(progress, sheetMeta);
          });
        }
        return ok(command);
      };

      const runSheet = async (cap: number | undefined) => {
        const commandResult = buildCommand(cap);
        if (commandResult.isErr()) {
          return commandResult;
        }
        return commandBus.execute<ImportExcelCommand, ImportExcelResult>(
          context,
          commandResult.value
        );
      };

      let result = await runSheet(sheetMax);
      if (result.isErr()) {
        const errorCap = getImportRowLimitMax(result.error);
        const retryCap =
          errorCap != null ? resolveTruncatedSheetRetryCap(sheetMax, errorCap) : undefined;
        if (retryCap != null) {
          this.logger.warn(
            `Excel sheet "${worksheet.name}" exceeded the row limit; retrying with cap ${retryCap}`
          );
          result = await runSheet(retryCap);
        }
      }

      if (result.isErr()) {
        firstSheetError ??= result.error;
        this.logger.error(`V2 import Excel sheet "${worksheet.name}" failed`, result.error);
        this.eventEmitter.emit(Events.V2_TABLE_IMPORT_FINISH, {
          baseId,
          status: 'failed',
          error: result.error.message,
        });
        sheets.push({
          name: worksheet.name,
          importedCount: 0,
          truncated: false,
          error: result.error.message,
        });
        continue;
      }

      const importedCount = result.value.totalImported;
      const tableId = result.value.table.id().toString();
      await this.attachImportedTableToFolder(baseId, tableId, importOptions.folderId);
      const table = this.mapImportedTable(result.value.table);
      this.eventEmitter.emit(Events.V2_TABLE_IMPORT_FINISH, {
        baseId,
        tableId,
        status: 'completed',
      });
      tables.push(table);
      sheets.push({
        name: worksheet.name,
        importedCount,
        truncated:
          skipData ||
          Boolean(worksheet.importData && expectedRows != null && importedCount < expectedRows),
      });
      remaining = remainingImportRowCount(remaining, importedCount);
    }

    if (tables.length === 0 && firstSheetError) {
      throwV2Error(firstSheetError, mapDomainErrorToHttpStatus(firstSheetError));
    }

    return { tables, sheets };
  }

  private mapImportedTable(table: Table): ITableFullVo {
    const mapped = mapTableToDto(table);
    if (mapped.isErr()) {
      throwV2Error(mapped.error, mapDomainErrorToHttpStatus(mapped.error));
    }
    const dto = mapped.value;
    return {
      id: dto.id,
      name: dto.name,
      dbTableName: dto.dbTableName ?? '',
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
      ...(dto.views[0]?.id ? { defaultViewId: dto.views[0].id } : {}),
      fields: dto.fields as ITableFullVo['fields'],
      views: dto.views as ITableFullVo['views'],
      records: [],
    };
  }

  private validateImportProjection(
    sourceColumnMap: Record<string, number | null>,
    projection?: string[]
  ): void {
    if (!projection) {
      return;
    }

    const fieldIds = Object.keys(sourceColumnMap);
    const noUpdateFields = difference(fieldIds, projection);
    if (noUpdateFields.length === 0) {
      return;
    }

    const tips = noUpdateFields.join(',');
    throw new CustomHttpException(
      `There is no permission to update these fields: ${tips}`,
      HttpErrorCode.RESTRICTED_RESOURCE,
      {
        localization: {
          i18nKey: 'httpErrors.permission.updateRecordWithDeniedFields',
          context: {
            fields: tips,
          },
        },
      }
    );
  }

  /**
   * Import records using V2 architecture via CommandBus.
   * Appends records from a file (CSV/Excel) to an existing table.
   *
   * The ImportRecordsCommand handler is responsible for:
   * - Finding the table by ID
   * - Parsing the import source
   * - Handling typecast and side effects (new select options)
   * - Resolving link fields
   * - Streaming record insertion
   *
   * @param baseId - The base ID
   * @param tableId - The table ID to import into
   * @param importOptions - Import options (V1 API type for compatibility)
   * @param maxRowCount - Optional max row count limit
   * @param projection - Optional field projection for permission check
   */
  @Audit({
    rootAction: CreateRecordAction.InplaceImport,
    resourceId: (_baseId: string, tableId: string) => tableId,
    params: (_baseId: string, _tableId: string, importOptions: IInplaceImportOptionRo) => ({
      fileType: importOptions.fileType,
    }),
  })
  async importRecords(
    baseId: string,
    tableId: string,
    importOptions: IInplaceImportOptionRo,
    maxRowCount?: number,
    projection?: string[],
    onProgress?: (progress: IImportProgress) => void
  ): Promise<{ totalImported: number }> {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const context = await this.v2ContextFactory.createContext(container);

    const { attachmentUrl, fileType, insertConfig } = importOptions;
    const { sourceColumnMap, sourceWorkSheetKey, excludeFirstRow } = insertConfig;

    this.validateImportProjection(sourceColumnMap, projection);

    // Resolve relative URL to absolute URL
    const resolvedUrl = this.resolveUrl(attachmentUrl);

    // Align with v1 behavior: treat 0 (or negative) as no limit
    // Keep 0 as a real limit ("no remaining quota") — treating it as undefined
    // would disable the row-limit check entirely for over-limit spaces.
    const normalizedMaxRowCount =
      maxRowCount !== undefined && maxRowCount >= 0 ? maxRowCount : undefined;

    // Create command
    const commandResult = ImportRecordsCommand.createFromUrl({
      tableId,
      url: resolvedUrl,
      fileType,
      sourceColumnMap,
      options: {
        skipFirstNLines: excludeFirstRow ? 1 : 0,
        sheetName: sourceWorkSheetKey,
        typecast: true,
        batchSize: normalizedMaxRowCount ? Math.min(normalizedMaxRowCount, 500) : 500,
        maxRowCount: normalizedMaxRowCount,
        onProgress,
      },
    });

    if (commandResult.isErr()) {
      throw new HttpException(commandResult.error.message, HttpStatus.BAD_REQUEST);
    }

    // Execute via CommandBus
    const result = await commandBus.execute<ImportRecordsCommand, ImportRecordsResult>(
      context,
      commandResult.value
    );

    if (result.isErr()) {
      this.logger.error('V2 import records failed', result.error);
      this.eventEmitter.emit(Events.V2_TABLE_IMPORT_FINISH, {
        baseId,
        tableId,
        status: 'failed',
        error: result.error.message,
      });

      // Map domain error to HTTP status
      const status =
        result.error.code === 'import.field_not_found' ||
        result.error.code === 'import.column_index_out_of_range' ||
        result.error.tags?.includes('validation')
          ? HttpStatus.BAD_REQUEST
          : result.error.tags?.includes('not-found')
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_SERVER_ERROR;

      throwV2Error(result.error, status);
    }

    // No manual audit emit: ImportRecordsHandler publishes RecordsBatchCreated per batch.
    // The projection writes one audit_log row per batch naturally, keeping the atomic
    // record-create action and attaching rootAction=InplaceImport from this operation.
    this.eventEmitter.emit(Events.V2_TABLE_IMPORT_FINISH, {
      baseId,
      tableId,
      status: 'completed',
    });
    return { totalImported: result.value.totalImported };
  }

  createTableFromImportStream(
    baseId: string,
    importOptions: IImportOptionRo,
    maxRowCount?: number
  ): AsyncIterable<IImportStreamEvent> {
    const queue = new AsyncIterableQueue<IImportStreamEvent>({
      maxBufferedItems: maxImportStreamBufferedEvents,
    });
    void this.runCreateTableFromImportStream(baseId, importOptions, maxRowCount, queue);
    return queue;
  }

  importRecordsStream(
    baseId: string,
    tableId: string,
    importOptions: IInplaceImportOptionRo,
    maxRowCount?: number,
    projection?: string[]
  ): AsyncIterable<IImportStreamEvent> {
    const queue = new AsyncIterableQueue<IImportStreamEvent>({
      maxBufferedItems: maxImportStreamBufferedEvents,
    });
    void this.runImportRecordsStream(
      baseId,
      tableId,
      importOptions,
      maxRowCount,
      projection,
      queue
    );
    return queue;
  }

  private async runCreateTableFromImportStream(
    baseId: string,
    importOptions: IImportOptionRo,
    maxRowCount: number | undefined,
    queue: AsyncIterableQueue<IImportStreamEvent>
  ) {
    const worksheets = Object.entries(importOptions.worksheets);
    const sheetCount = Math.max(worksheets.length, 1);
    let processedCount = 0;
    let totalCount = 0;
    let currentSheetIndex = 0;
    let currentSheetName = worksheets[0]?.[1]?.name;
    let currentSheetTotal = 0;
    let lastBatchIndex = -1;

    try {
      await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);
    } catch (error) {
      queue.push(
        this.toImportStreamError(error, {
          phase: 'preparing',
          sheetIndex: 0,
          sheetCount,
          sheetName: currentSheetName,
          batchIndex: -1,
          totalCount: 0,
          processedCount: 0,
          importedCount: 0,
        })
      );
      queue.close();
      return;
    }

    const pushProgress = (
      phase: IImportStreamProgressEvent['phase'],
      progress?: IImportProgress,
      sheet?: { index: number; count: number; name: string }
    ) => {
      const sheetProcessedCount = progress?.processedRows ?? 0;
      const sheetTotalCount = progress?.totalRows ?? currentSheetTotal;
      currentSheetTotal = sheetTotalCount || currentSheetTotal;
      const overallProcessed = processedCount + sheetProcessedCount;
      const knownTotal = totalCount || (progress?.totalRows ?? 0);
      lastBatchIndex = progress?.currentBatch ? progress.currentBatch - 1 : lastBatchIndex;
      queue.push(
        this.createImportProgressEvent({
          phase,
          sheetIndex: sheet?.index ?? currentSheetIndex,
          sheetCount: sheet?.count ?? sheetCount,
          sheetName: sheet?.name ?? currentSheetName,
          tableName: sheet?.name ?? currentSheetName,
          batchIndex: lastBatchIndex,
          totalCount: knownTotal,
          processedCount: overallProcessed,
          importedCount: overallProcessed,
          sheetTotalCount: currentSheetTotal,
          sheetProcessedCount,
          batchProcessedCount: progress?.processedRows ?? 0,
        })
      );
    };

    queue.push(
      this.createImportProgressEvent({
        phase: 'preparing',
        sheetIndex: 0,
        sheetCount,
        sheetName: currentSheetName,
        tableName: currentSheetName,
        batchIndex: -1,
        totalCount: 0,
        processedCount: 0,
        importedCount: 0,
        sheetTotalCount: 0,
        sheetProcessedCount: 0,
        batchProcessedCount: 0,
      })
    );

    try {
      if (importOptions.folderId) {
        const folderNodeId = await this.baseNodeService.resolveFolderNodeId(
          baseId,
          importOptions.folderId
        );
        importOptions = { ...importOptions, folderId: folderNodeId };
      }
      let prefetchedExcelData: Uint8Array | undefined;
      if (importOptions.fileType === SUPPORTEDTYPE.EXCEL) {
        prefetchedExcelData = await this.fetchAttachmentBytes(importOptions.attachmentUrl);
        const container = await this.v2ContainerService.getContainerForBase(baseId);
        totalCount = await this.countExcelDataRows(
          container,
          prefetchedExcelData,
          importOptions.worksheets
        );
        queue.push(
          this.createImportProgressEvent({
            phase: 'preparing',
            sheetIndex: 0,
            sheetCount,
            sheetName: currentSheetName,
            tableName: currentSheetName,
            batchIndex: -1,
            totalCount,
            processedCount: 0,
            importedCount: 0,
            sheetTotalCount: 0,
            sheetProcessedCount: 0,
            batchProcessedCount: 0,
          })
        );
      }

      const importResult =
        importOptions.fileType === SUPPORTEDTYPE.CSV
          ? {
              tables: await this.createTableFromCsvImport(
                baseId,
                importOptions,
                maxRowCount,
                (progress) => {
                  if (progress.totalRows != null && progress.totalRows > totalCount) {
                    totalCount = progress.totalRows;
                  }
                  pushProgress(progress.phase === 'parsing' ? 'parsing' : 'importing', progress, {
                    index: 0,
                    count: 1,
                    name: currentSheetName ?? 'CSV',
                  });
                  if (progress.phase === 'completed') {
                    processedCount += progress.processedRows;
                  }
                }
              ),
              sheets: undefined as IImportSheetSummary[] | undefined,
            }
          : await this.createTableFromExcelImport(
              baseId,
              importOptions,
              maxRowCount,
              (progress, sheet) => {
                currentSheetIndex = sheet.index;
                currentSheetName = sheet.name;
                pushProgress(
                  progress.phase === 'parsing' ? 'parsing' : 'importing',
                  progress,
                  sheet
                );
                if (progress.phase === 'completed') {
                  processedCount += progress.processedRows;
                  currentSheetTotal = 0;
                }
              },
              prefetchedExcelData
            );
      const tables = importResult.tables;

      queue.push({
        id: 'done',
        totalCount: totalCount || processedCount,
        processedCount,
        importedCount: processedCount,
        data: {
          tables,
          tableId: tables[0]?.id,
          sheets: importResult.sheets,
        },
      });
    } catch (error) {
      queue.push(
        this.toImportStreamError(error, {
          phase: 'importing',
          sheetIndex: currentSheetIndex,
          sheetCount,
          sheetName: currentSheetName,
          batchIndex: lastBatchIndex,
          totalCount,
          processedCount,
          importedCount: processedCount,
        })
      );
    } finally {
      queue.close();
    }
  }

  private async runImportRecordsStream(
    baseId: string,
    tableId: string,
    importOptions: IInplaceImportOptionRo,
    maxRowCount: number | undefined,
    projection: string[] | undefined,
    queue: AsyncIterableQueue<IImportStreamEvent>
  ) {
    const sheetName = importOptions.insertConfig.sourceWorkSheetKey;
    let processedCount = 0;
    let totalCount = 0;
    let lastBatchIndex = -1;

    try {
      await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
    } catch (error) {
      queue.push(
        this.toImportStreamError(error, {
          phase: 'preparing',
          sheetIndex: 0,
          sheetCount: 1,
          sheetName,
          batchIndex: -1,
          totalCount: 0,
          processedCount: 0,
          importedCount: 0,
        })
      );
      queue.close();
      return;
    }

    queue.push(
      this.createImportProgressEvent({
        phase: 'preparing',
        sheetIndex: 0,
        sheetCount: 1,
        sheetName,
        tableName: sheetName,
        batchIndex: -1,
        totalCount: 0,
        processedCount: 0,
        importedCount: 0,
        sheetTotalCount: 0,
        sheetProcessedCount: 0,
        batchProcessedCount: 0,
      })
    );

    try {
      const result = await this.importRecords(
        baseId,
        tableId,
        importOptions,
        maxRowCount,
        projection,
        (progress) => {
          processedCount = progress.processedRows;
          totalCount = progress.totalRows ?? totalCount;
          lastBatchIndex = progress.currentBatch ? progress.currentBatch - 1 : lastBatchIndex;
          queue.push(
            this.createImportProgressEvent({
              phase: progress.phase === 'parsing' ? 'parsing' : 'importing',
              sheetIndex: 0,
              sheetCount: 1,
              sheetName,
              tableName: sheetName,
              batchIndex: lastBatchIndex,
              totalCount,
              processedCount,
              importedCount: processedCount,
              sheetTotalCount: totalCount,
              sheetProcessedCount: processedCount,
              batchProcessedCount: 0,
            })
          );
        }
      );

      queue.push({
        id: 'done',
        totalCount: totalCount || result.totalImported,
        processedCount: result.totalImported,
        importedCount: result.totalImported,
        data: {
          tableId,
        },
      });
    } catch (error) {
      queue.push(
        this.toImportStreamError(error, {
          phase: 'importing',
          sheetIndex: 0,
          sheetCount: 1,
          sheetName,
          batchIndex: lastBatchIndex,
          totalCount,
          processedCount,
          importedCount: processedCount,
        })
      );
    } finally {
      queue.close();
    }
  }

  private async fetchAttachmentBytes(url: string): Promise<Uint8Array> {
    const resolvedUrl = this.resolveUrl(url);
    const response = await safeFetch(resolvedUrl);
    if (!response.ok) {
      throw new HttpException(
        `Failed to download import file: ${response.status}`,
        HttpStatus.BAD_GATEWAY
      );
    }
    const buffer = await response.buffer();
    return new Uint8Array(buffer);
  }

  private async countExcelDataRows(
    container: Awaited<ReturnType<V2ContainerService['getContainerForBase']>>,
    excelData: Uint8Array,
    worksheets: IImportOptionRo['worksheets']
  ): Promise<number> {
    const registry = container.resolve<IImportSourceRegistry>(v2CoreTokens.importSourceRegistry);
    const adapterResult = registry.getAdapter('excel');
    if (adapterResult.isErr()) {
      return 0;
    }

    let total = 0;
    for (const [sheetKey, worksheet] of Object.entries(worksheets)) {
      if (!worksheet.importData) {
        continue;
      }
      const parsed = await adapterResult.value.parse(
        { type: 'excel', data: excelData },
        { sheetName: sheetKey }
      );
      if (parsed.isErr()) {
        continue;
      }
      const skip = worksheet.useFirstRowAsHeader ? 1 : 0;
      total += Math.max((parsed.value.rowCount ?? 0) - skip, 0);
    }
    return total;
  }

  private createImportProgressEvent(
    event: Omit<IImportStreamProgressEvent, 'id'>
  ): IImportStreamProgressEvent {
    return { id: 'progress', ...event };
  }

  private toImportStreamError(
    error: unknown,
    snapshot: Omit<IImportStreamErrorEvent, 'id' | 'message' | 'code' | 'localization'>
  ): IImportStreamErrorEvent {
    if (error instanceof CustomHttpException) {
      return {
        id: 'error',
        ...snapshot,
        message: error.message,
        code: typeof error.data?.domainCode === 'string' ? error.data.domainCode : error.code,
        localization: error.data?.localization,
      };
    }
    if (error instanceof HttpException) {
      return {
        id: 'error',
        ...snapshot,
        message: error.message,
      };
    }
    return {
      id: 'error',
      ...snapshot,
      message: error instanceof Error ? error.message : 'Import stream failed',
    };
  }

  /**
   * Best-effort: on failure the table stays at root via node reconciliation.
   * Callers must pass a resolved folder node id (see resolveFolderNodeId).
   */
  private async attachImportedTableToFolder(
    baseId: string,
    tableId: string,
    folderNodeId: string | undefined
  ): Promise<void> {
    if (!folderNodeId) {
      return;
    }
    await this.baseNodeService
      .attachResourceToParent({
        baseId,
        parentId: folderNodeId,
        resourceType: BaseNodeResourceType.Table,
        resourceId: tableId,
      })
      .catch((e) => {
        this.logger.warn(`Failed to attach imported table ${tableId} to folder ${folderNodeId}`, e);
      });
  }
}
