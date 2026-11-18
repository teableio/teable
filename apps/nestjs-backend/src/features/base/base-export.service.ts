/* eslint-disable sonarjs/no-duplicate-string */
import { Readable, PassThrough } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type {
  ILinkFieldOptions,
  ILocalization,
  IConditionalRollupFieldOptions,
  IConditionalLookupOptions,
} from '@teable/core';
import { FieldType, getRandomString, ViewType, isLinkLookupOptions } from '@teable/core';
import type { Field, View, TableMeta, Base } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition, UploadType } from '@teable/openapi';
import type {
  BaseNodeResourceType,
  ExportBaseProgressCallback,
  IBaseJson,
  IExportBaseVo,
} from '@teable/openapi';
import archiver from 'archiver';
import { Knex } from 'knex';
import { groupBy, omit, pick } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { DatabaseRouter } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex/knex.module';
import { V1Engine } from '../../tracing/decorators/v1-engine';
import type { IClsStore } from '../../types/cls';
import type { I18nPath } from '../../types/i18n.generated';
import { baseDisplayName } from '../../utils/base-name';
import { resolveBuildVersion } from '../../utils/build-version';
import { second } from '../../utils/second';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { NotificationService } from '../notification/notification.service';
import { PENDING_ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import { createViewVoByRaw } from '../view/model/factory';
import { BaseExportCoordinator } from './base-export-coordinator';
import {
  appendBaseExportEntry,
  createBaseExportCsvStream,
  isBaseExportCancelled,
} from './base-export-stream';
import { EXCLUDE_SYSTEM_FIELDS } from './constant';
import { isCrossSpaceReferenceAllowed } from './cross-space-detection.util';
import { EXPORT_ZIP_OPTIONS, guardExportArchive } from './export-archive-guard';
import { exportBaseObjectPath } from './export-cleanup/export-base-path';
@Injectable()
export class BaseExportService {
  public static readonly CSV_CHUNK = 500;
  public static readonly FIELD_EXPORT_BATCH_SIZE = 500;
  public static readonly VIEW_EXPORT_BATCH_SIZE = 500;
  private static readonly TABLE_ID_QUERY_CHUNK_SIZE = 100;
  public static readonly FILE_SUFFIX = 'tea';
  public static readonly EXPORT_FIELD_COLUMNS = [
    'id',
    'name',
    'description',
    'options',
    'type',
    'dbFieldName',
    'notNull',
    'unique',
    'isPrimary',
    'hasError',
    'order',
    'lookupOptions',
    'isLookup',
    'isConditionalLookup',
    'aiConfig',
    'meta',
    // for formula field
    'dbFieldType',
    'cellValueType',
    'isMultipleCellValue',
  ];
  private readonly logger = new Logger(BaseExportService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly notificationService: NotificationService,
    private readonly eventEmitterService: EventEmitterService,
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @StorageConfig() private readonly storageConfig: IStorageConfig,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly databaseRouter: DatabaseRouter,
    private readonly exportCoordinator: BaseExportCoordinator
  ) {}

  private captureExportError(
    error: unknown,
    context: {
      stage: 'fetchBase' | 'processExport';
      baseId: string;
      includeData: boolean;
      baseName?: string;
    }
  ) {
    const err = error instanceof Error ? error : new Error(String(error));
    const userId = this.cls.get('user.id');

    Sentry.withScope((scope) => {
      scope.setTag('feature', 'base-export');
      scope.setTag('export.stage', context.stage);
      scope.setContext('base-export', {
        baseId: context.baseId,
        baseName: context.baseName,
        includeData: context.includeData,
        userId,
      });
      scope.setLevel?.('error');
      Sentry.captureException(err);
    });

    this.logger.error(
      `export base zip failed at ${context.stage}: ${err.message}`,
      err.stack ?? undefined
    );
  }

  private generateExportFolderId() {
    return `${getRandomString(12)}`;
  }

  /** Unsignalled internal callers retain their best-effort download contract. */
  async appendFileToArchive(
    archive: archiver.Archiver,
    bucket: string,
    s3Path: string,
    archivePath: string,
    timeoutMs: number = 10 * 60 * 1000,
    _chatId?: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    const controller = new AbortController();
    let stream: Readable | undefined;
    const abort = () => controller.abort(signal?.reason);
    const destroy = () => stream?.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', destroy, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(
      () => controller.abort(new Error(`File stream timeout after ${timeoutMs}ms: ${archivePath}`)),
      timeoutMs
    );
    try {
      controller.signal.throwIfAborted();
      stream = await this.storageAdapter.downloadFile(bucket, s3Path);
      controller.signal.throwIfAborted();
      await appendBaseExportEntry(archive, stream, archivePath, controller.signal);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to export file ${s3Path} to ${archivePath}: ${error instanceof Error ? error.message : String(error)}`
      );
      if (signal) {
        controller.signal.throwIfAborted();
        throw error;
      }
      return false;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', destroy);
      stream?.destroy();
    }
  }

  @V1Engine()
  async exportBaseZip(
    baseId: string,
    includeData = true,
    onProgress?: ExportBaseProgressCallback,
    signal?: AbortSignal
  ): Promise<IExportBaseVo | undefined> {
    return this.exportCoordinator.run(
      {
        baseId,
        includeData,
        userId: this.cls.get('user.id'),
        onProgress,
        signal,
        onCancelled: () =>
          this.notifyExportResult(
            baseId,
            {
              i18nKey: 'common.email.templates.notify.exportBase.cancelled.message',
              context: { baseId },
            },
            { status: 'cancelled' }
          ),
      },
      (jobSignal, progress, commitTerminalOutcome) =>
        this.performExport(baseId, includeData, progress, jobSignal, commitTerminalOutcome)
    );
  }

  private async performExport(
    baseId: string,
    includeData: boolean,
    onProgress: ExportBaseProgressCallback,
    signal: AbortSignal,
    commitTerminalOutcome: () => boolean
  ): Promise<IExportBaseVo> {
    let baseName: string | undefined;
    onProgress('preparing');
    signal.throwIfAborted();
    try {
      const { name } = await this.prismaService.base.findFirstOrThrow({
        where: {
          id: baseId,
        },
        select: {
          name: true,
        },
      });
      signal.throwIfAborted();
      baseName = baseDisplayName(name);
    } catch (error) {
      if (isBaseExportCancelled(signal)) throw error;
      this.captureExportError(error, {
        stage: 'fetchBase',
        baseId,
        includeData,
      });
      throw error;
    }

    // create a stream pass through, ready to fill data
    const passThrough = new PassThrough();

    const archive = archiver('zip', EXPORT_ZIP_OPTIONS);
    const guard = guardExportArchive(archive, passThrough);

    archive.pipe(passThrough);

    const token = this.generateExportFolderId();
    const bucket = StorageAdapter.getBucket(UploadType.ExportBase);
    const linkExpiresIn = second(this.storageConfig.tokenExpireIn);

    // Critical: Start upload first to ensure passThrough has a consumer, preventing backpressure blocking
    // If uploadFileStream is called after finalize(), large files will hang in append
    // Note: This occupies sockets, recommend setting BACKEND_STORAGE_S3_UPLOAD_QUEUE_SIZE=1 to control upload concurrency to 1
    const exportFileName = `${baseName}.${BaseExportService.FILE_SUFFIX}`;
    const uploadPromise = this.storageAdapter.uploadFileStream(
      bucket,
      exportBaseObjectPath(token, BaseExportService.FILE_SUFFIX, linkExpiresIn),
      passThrough,
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/octet-stream',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(exportFileName)}`,
      },
      guard.signal
    );
    // The upload runs alongside the archive; a part failing mid-export must stop the export
    // instead of surfacing later as an unhandled rejection.
    uploadPromise.catch(guard.fail);
    const onAbort = () => guard.fail(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    let processing: Promise<void> | undefined;

    try {
      onProgress?.('exporting_archive');
      processing = this.prismaService.$tx(
        async (prisma) => {
          guard.signal.throwIfAborted();
          await prisma.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          guard.signal.throwIfAborted();
          await this.pipeArchive(archive, baseId, includeData, onProgress, guard.signal);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: this.thresholdConfig.bigTransactionTimeout,
        }
      );
      await guard.run(processing);
      await guard.run(archive.finalize());
      onProgress?.('uploading_archive');
      const uploadResult = await guard.run(uploadPromise);
      const { path } = uploadResult;
      onProgress?.('generating_download_url');
      const previewUrl = await this.storageAdapter.getPreviewUrl(
        StorageAdapter.getBucket(UploadType.ExportBase),
        path,
        linkExpiresIn,
        {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(exportFileName)}`,
        }
      );
      const message: ILocalization<I18nPath> = {
        i18nKey: 'common.email.templates.notify.exportBase.success.message',
        context: {
          baseId,
          baseName,
          previewUrl,
          name: exportFileName,
        },
      };
      signal.throwIfAborted();
      commitTerminalOutcome();
      await this.notifyExportResult(baseId, message, {
        status: 'success',
        previewUrl,
        attachment: {
          name: exportFileName,
          path,
        },
      });
      onProgress?.('done');
      return { previewUrl, baseName, fileName: exportFileName };
    } catch (e) {
      guard.fail(e);
      if (isBaseExportCancelled(signal)) throw e;
      this.captureExportError(e, {
        stage: 'processExport',
        baseId,
        baseName,
        includeData,
      });
      if (!commitTerminalOutcome()) throw e;
      if (e instanceof Error) {
        const message: ILocalization<I18nPath> = {
          i18nKey: 'common.email.templates.notify.exportBase.failed.message',
          context: {
            baseId,
            baseName,
            errorMessage: e.message,
          },
        };
        try {
          await this.notifyExportResult(baseId, message, {
            status: 'failed',
            errorMessage: e.message,
          });
        } catch (notificationError) {
          this.captureExportError(notificationError, {
            stage: 'processExport',
            baseId,
            baseName,
            includeData,
          });
          throw notificationError;
        }
      }
      throw e;
    } finally {
      // Keep the shared process slot until pending DB reads and upload cleanup unwind.
      await Promise.allSettled([processing, uploadPromise]);
      signal.removeEventListener('abort', onAbort);
    }
  }

  @V1Engine()
  async pipeArchive(
    archive: archiver.Archiver,
    baseId: string,
    includeData: boolean,
    onProgress?: ExportBaseProgressCallback,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    await this.processExportBaseZip(baseId, includeData, archive, onProgress, signal);
  }

  async processExportBaseZip(
    baseId: string,
    includeData: boolean,
    archive: archiver.Archiver,
    onProgress?: ExportBaseProgressCallback,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const prisma = this.prismaService.txClient();
    //  1. get all raw info
    const baseRaw = await prisma.base.findUniqueOrThrow({
      where: {
        id: baseId,
        deletedTime: null,
      },
    });
    signal?.throwIfAborted();
    const baseLabel = `${baseRaw.id}/${baseDisplayName(baseRaw.name)}`;
    const tableRaws = await prisma.tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });
    signal?.throwIfAborted();
    const tableIds = tableRaws.map(({ id }) => id);
    const fieldRaws = await this.findFieldsByTableIds(tableIds, signal);
    const viewRaws = await this.findViewsByTableIds(tableIds, signal);

    // 2. generate base structure json
    onProgress?.('exporting_structure');
    const structure = await this.generateBaseStructConfig({
      baseRaw,
      tableRaws,
      fieldRaws,
      viewRaws,
      signal,
    });
    signal?.throwIfAborted();
    await appendBaseExportEntry(
      archive,
      Readable.from(JSON.stringify(structure, null, 2)),
      'structure.json',
      signal
    );

    // 4 export data
    if (includeData) {
      onProgress?.('exporting_attachments');
      this.logger.log(`export base ${baseLabel}: Start exporting attachments`);
      // 4.0 export attachments
      await this.appendAttachments('attachments', tableRaws, archive, signal);
      this.logger.log(`export base ${baseLabel}: End exporting attachments data csv`);

      onProgress?.('exporting_attachment_metadata');
      // 4.1 export attachments data .csv
      this.logger.log(`export base ${baseLabel}: Start exporting attachments data csv`);
      await this.appendAttachmentsDataCsv('attachments', tableRaws, archive, signal);
      this.logger.log(`export base ${baseLabel}: End exporting attachments data csv`);

      onProgress?.('exporting_table_data');
      this.logger.log(`export base ${baseLabel}: Start exporting table data csv`);

      // 4.2 export table data csv
      const crossBaseRelativeFields = this.getCrossBaseFields(fieldRaws, false);
      const crossBaseRelativeFieldIds = new Set(crossBaseRelativeFields.map(({ id }) => id));
      const crossBaseRelativeFieldsRaws = fieldRaws.filter(({ id }) =>
        crossBaseRelativeFieldIds.has(id)
      );

      for (const [index, tableRaw] of tableRaws.entries()) {
        signal?.throwIfAborted();
        onProgress?.('table_data_started', tableRaw.name, {
          type: 'progress',
          phase: 'table_data_started',
          tableId: tableRaw.id,
          tableName: tableRaw.name,
          tableIndex: index + 1,
          totalTables: tableRaws.length,
        });
        const crossBaseFieldRaws = crossBaseRelativeFieldsRaws.filter(
          ({ tableId }) => tableId === tableRaw.id
        );
        const buttonDbFieldNames = fieldRaws
          .filter(
            ({ type, isLookup, tableId }) =>
              type === FieldType.Button && !isLookup && tableId === tableRaw.id
          )
          .map((f) => f.dbFieldName);

        const excludeDbFieldNames = [...EXCLUDE_SYSTEM_FIELDS, ...buttonDbFieldNames];
        await this.appendTableDataCsv(
          archive,
          'tables',
          tableRaw,
          crossBaseFieldRaws,
          excludeDbFieldNames,
          onProgress,
          signal
        );
        onProgress?.('table_data_done', tableRaw.name, {
          type: 'progress',
          phase: 'table_data_done',
          tableId: tableRaw.id,
          tableName: tableRaw.name,
          tableIndex: index + 1,
          totalTables: tableRaws.length,
        });
      }

      const linkFieldRaws = fieldRaws
        .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
        .filter(({ id }) => !crossBaseRelativeFieldIds.has(id));

      // 5. export junction csv for link fields
      const junctionTableName = [] as string[];
      for (const linkFieldRaw of linkFieldRaws) {
        const linkField = createFieldInstanceByRaw(linkFieldRaw);
        const { options } = linkField;
        const { fkHostTableName, selfKeyName, foreignKeyName } = options as ILinkFieldOptions;
        if (fkHostTableName.includes('junction_') && !junctionTableName.includes(fkHostTableName)) {
          await this.appendJunctionCsv(
            'tables',
            linkFieldRaw.tableId,
            fkHostTableName,
            selfKeyName,
            foreignKeyName,
            archive,
            signal
          );
        }
      }

      this.logger.log(`export base ${baseLabel}: End exporting table data csv`);
    }
  }

  async generateBaseStructConfig({
    baseRaw,
    tableRaws,
    fieldRaws,
    viewRaws,
    // whether support cross base link fields
    allowCrossBase = false,
    includeNodes,
    includedFolderIds,
    includedDashboardIds,
    excludedTableIds,
    // for enterprise version, do not delete these properties
    includedAppIds,
    includedWorkflowIds,
    includedRoutineIds,
    // Root node IDs - nodes that should have their parentId set to null
    rootNodeIds,
    // When set, fields whose foreign base lives in a different space are also
    // degraded to text even when allowCrossBase=true (same-space cross-base
    // remains a real link).
    destSpaceId,
    signal,
  }: {
    baseRaw: Base;
    tableRaws: TableMeta[];
    fieldRaws: Field[];
    viewRaws: View[];
    allowCrossBase?: boolean;
    includeNodes?: string[];
    includedFolderIds?: string[];
    includedDashboardIds?: string[];
    includedAppIds?: string[];
    includedWorkflowIds?: string[];
    includedRoutineIds?: string[];
    excludedTableIds?: string[];
    rootNodeIds?: string[];
    destSpaceId?: string;
    signal?: AbortSignal;
  }) {
    signal?.throwIfAborted();
    const { name: baseName, icon: baseIcon, id: baseId } = baseRaw;
    const crossSpaceForeignBaseIds = await this.computeCrossSpaceForeignBaseIds(
      fieldRaws,
      destSpaceId,
      signal
    );
    const fieldsByTableId = groupBy(fieldRaws, 'tableId');
    const viewsByTableId = groupBy(viewRaws, 'tableId');
    const tables = [] as IBaseJson['tables'];
    for (const table of tableRaws) {
      const { name, description, order, id, icon, dbTableName } = table;
      const realDbTableName = dbTableName?.split('.')?.pop();
      const tableObject = {
        id,
        name,
        order,
        description,
        icon,
        dbTableName: realDbTableName,
      } as IBaseJson['tables'][number];
      const currentTableFields = fieldsByTableId[id] ?? [];
      tableObject.fields = this.generateFieldConfig(
        currentTableFields,
        allowCrossBase,
        excludedTableIds,
        crossSpaceForeignBaseIds
      );
      tableObject.views = this.generateViewConfig(viewsByTableId[id] ?? []);
      tables.push(tableObject);
    }

    const plugins = await this.generatePluginConfig(
      baseId,
      includedDashboardIds,
      viewRaws,
      tableRaws.map(({ id }) => id),
      signal
    );
    const folders = await this.generateFolderConfig(baseId, includedFolderIds, signal);
    const nodes = await this.generateNodeConfig(baseId, includeNodes, rootNodeIds, signal);

    return {
      id: baseId,
      // structure.json is also the source of the duplicate/import base name: never null here
      name: baseDisplayName(baseName),
      icon: baseIcon,
      version: resolveBuildVersion(),
      tables,
      plugins,
      folders,
      nodes,
    };
  }

  private async *getAttachmentMetadataPages(
    tableRaws: TableMeta[],
    includeDeleted: boolean,
    signal?: AbortSignal
  ) {
    // Legacy refs belong to the main transaction; table CSV queries use DatabaseRouter.
    // Keep that v1 mapping and the full Prisma metadata shape (including its CSV order).
    const prisma = this.prismaService.txClient();
    const tableIds = tableRaws.map(({ id }) => id);
    const seen = new Set<string>();
    let cursor: string | undefined;
    while (true) {
      signal?.throwIfAborted();
      const refs = await prisma.attachmentsTable.findMany({
        where: { tableId: { in: tableIds }, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, token: true, name: true },
        orderBy: { id: 'asc' },
        take: BaseExportService.CSV_CHUNK,
      });
      signal?.throwIfAborted();
      if (!refs.length) return;
      cursor = refs[refs.length - 1].id;
      const names = new Map<string, string>();
      for (const ref of refs) {
        if (seen.has(ref.token)) continue;
        seen.add(ref.token);
        names.set(ref.token, ref.name);
      }
      if (!names.size) continue;
      signal?.throwIfAborted();
      const rows = await prisma.attachments.findMany({
        where: {
          token: { in: [...names.keys()] },
          ...(includeDeleted ? {} : { deletedTime: null }),
        },
      });
      signal?.throwIfAborted();
      if (rows.length) yield { rows, names };
    }
  }

  private async appendAttachments(
    filePath: string,
    tableRaws: TableMeta[],
    archive: archiver.Archiver,
    signal?: AbortSignal
  ) {
    const bucket = StorageAdapter.getBucket(UploadType.Table);
    // v1 includes deleted file bodies but excludes their metadata rows. Preserve that quirk.
    for await (const { rows, names } of this.getAttachmentMetadataPages(tableRaws, true, signal)) {
      for (const { token, path } of rows) {
        signal?.throwIfAborted();
        await this.appendFileToArchive(
          archive,
          bucket,
          path,
          `${filePath}/${token}.${names.get(token)?.split('.').pop()}`,
          undefined,
          undefined,
          signal
        );
      }
    }
    // Keep v1's bodies-before-thumbnails ordering without retaining all metadata.
    for await (const { rows, names } of this.getAttachmentMetadataPages(tableRaws, true, signal)) {
      for (const { token, thumbnailPath } of rows) {
        if (!thumbnailPath) continue;
        const suffix = names.get(token)?.split('.').pop() || 'jpg';
        const thumbnails = JSON.parse(thumbnailPath) as Record<string, string>;
        for (const size of ['lg', 'md', 'sm']) {
          const path = thumbnails[size];
          if (!path) continue;
          signal?.throwIfAborted();
          await this.appendFileToArchive(
            archive,
            bucket,
            path,
            `${filePath}/thumbnail__${path.split('/').pop()}.${suffix}`,
            undefined,
            undefined,
            signal
          );
        }
      }
    }
  }

  private async appendTableDataCsv(
    archive: archiver.Archiver,
    filePath: string,
    tableRaw: TableMeta,
    crossBaseRelativeFields: Field[],
    excludeDbFieldNames: string[],
    onProgress?: ExportBaseProgressCallback,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const { dbTableName, id } = tableRaw;
    const prisma = await this.databaseRouter.dataPrismaExecutorForTable(id, {
      useTransaction: true,
    });
    signal?.throwIfAborted();
    const columnInfoQuery = this.dbProvider.columnInfo(dbTableName);
    const columnInfo = await prisma.$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);
    signal?.throwIfAborted();

    // 1. set csv header
    const convertLinkFields = crossBaseRelativeFields.filter(({ type }) => type === FieldType.Link);
    const fkNames = convertLinkFields
      .filter(({ type }) => type === FieldType.Link)
      .map(({ id }) => `__fk_${id}`);
    const columnHeader = columnInfo
      .map(({ name }) => name)
      // exclude system fields
      .filter((name) => !excludeDbFieldNames.includes(name))
      // an interrupted row-order backfill has no column on the imported table
      .filter((name) => !name.startsWith(PENDING_ROW_ORDER_FIELD_PREFIX))
      // exclude fk fields which are cross base link fields
      .filter((name) => !fkNames.includes(name));
    const service = this;
    async function* rows(): AsyncGenerator<readonly unknown[]> {
      let offset = 0;
      let processedRows = 0;
      while (true) {
        signal?.throwIfAborted();
        const records = await service.getChunkRecords(prisma, dbTableName, offset);
        signal?.throwIfAborted();
        if (!records.length) return;
        for (const record of records) {
          signal?.throwIfAborted();
          const converted = service.transformConvertFieldsCellValue(record, crossBaseRelativeFields);
          yield columnHeader.map((header) => converted[header]);
        }
        offset += BaseExportService.CSV_CHUNK;
        processedRows += records.length;
        onProgress?.('table_data_progress', tableRaw.name, {
          type: 'progress',
          phase: 'table_data_progress',
          tableId: tableRaw.id,
          tableName: tableRaw.name,
          processedRows,
          batchProcessedRows: records.length,
          currentBatch: Math.ceil(offset / BaseExportService.CSV_CHUNK),
        });
      }
    }
    await appendBaseExportEntry(
      archive,
      createBaseExportCsvStream(columnHeader, rows(), signal),
      `${filePath}/${id}.csv`,
      signal
    );
  }

  private async appendAttachmentsDataCsv(
    filePath: string,
    tableRaws: TableMeta[],
    archive: archiver.Archiver,
    signal?: AbortSignal
  ) {
    const pages = this.getAttachmentMetadataPages(tableRaws, false, signal);
    try {
      let page = await pages.next();
      signal?.throwIfAborted();
      if (page.done) return;
      const headers = Object.keys(page.value.rows[0]).filter(
        (name) => !EXCLUDE_SYSTEM_FIELDS.includes(name)
      );
      async function* rows(): AsyncGenerator<readonly unknown[]> {
        while (!page.done) {
          for (const attachment of page.value.rows) {
            signal?.throwIfAborted();
            const values: Record<string, unknown> = { ...attachment, size: Number(attachment.size) };
            yield headers.map((header) => values[header]);
          }
          signal?.throwIfAborted();
          page = await pages.next();
        }
      }
      await appendBaseExportEntry(
        archive,
        createBaseExportCsvStream(headers, rows(), signal),
        `${filePath}/attachments.csv`,
        signal
      );
    } finally {
      await pages.return(undefined);
    }
  }

  private async appendJunctionCsv(
    filePath: string,
    tableId: string,
    fkHostTableName: string,
    _selfKeyName: string,
    _foreignKeyName: string,
    archive: archiver.Archiver,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const prisma = await this.databaseRouter.dataPrismaExecutorForTable(tableId, {
      useTransaction: true,
    });
    signal?.throwIfAborted();
    const columnInfoQuery = this.dbProvider.columnInfo(fkHostTableName);
    const columnInfo = await prisma.$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);
    signal?.throwIfAborted();

    // 1. set csv header
    const columnHeader = columnInfo
      .map(({ name }) => name)
      // exclude id column
      .filter((name) => name !== '__id');
    const service = this;
    async function* rows(): AsyncGenerator<readonly unknown[]> {
      let offset = 0;
      while (true) {
        signal?.throwIfAborted();
        const query = service.knex(fkHostTableName)
          .select('*')
          .limit(BaseExportService.CSV_CHUNK)
          .offset(offset)
          .toQuery();
        const records = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(query);
        signal?.throwIfAborted();
        if (!records.length) return;
        for (const record of records) {
          signal?.throwIfAborted();
          yield columnHeader.map((header) => record[header]);
        }
        offset += BaseExportService.CSV_CHUNK;
      }
    }
    await appendBaseExportEntry(
      archive,
      createBaseExportCsvStream(columnHeader, rows(), signal),
      `${filePath}/${fkHostTableName}.csv`,
      signal
    );
  }

  private async getChunkRecords(
    prisma: { $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> },
    dbTableName: string,
    offset: number
  ) {
    const recordsQuery = this.knex(dbTableName)
      .select('*')
      .limit(BaseExportService.CSV_CHUNK)
      .offset(offset)
      .orderBy('__auto_number', 'asc')
      .toQuery();
    return await prisma.$queryRawUnsafe<Record<string, unknown>[]>(recordsQuery);
  }

  async findFieldsByTableIds(tableIds: string[], signal?: AbortSignal) {
    const prisma = this.prismaService.txClient();
    const fieldRaws: Field[] = [];

    for (
      let index = 0;
      index < tableIds.length;
      index += BaseExportService.TABLE_ID_QUERY_CHUNK_SIZE
    ) {
      const tableIdChunk = tableIds.slice(
        index,
        index + BaseExportService.TABLE_ID_QUERY_CHUNK_SIZE
      );
      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        signal?.throwIfAborted();
        const page = await prisma.field.findMany({
          where: {
            tableId: { in: tableIdChunk },
            deletedTime: null,
          },
          ...(cursor
            ? {
                cursor: {
                  id: cursor,
                },
                skip: 1,
              }
            : {}),
          orderBy: [{ tableId: 'asc' }, { id: 'asc' }],
          take: BaseExportService.FIELD_EXPORT_BATCH_SIZE,
        });
        signal?.throwIfAborted();

        fieldRaws.push(...page);

        hasMore = page.length === BaseExportService.FIELD_EXPORT_BATCH_SIZE;
        if (hasMore) {
          cursor = page[page.length - 1].id;
        }
      }
    }

    return fieldRaws;
  }

  async findViewsByTableIds(tableIds: string[], signal?: AbortSignal) {
    const prisma = this.prismaService.txClient();
    const viewRaws: View[] = [];

    for (
      let index = 0;
      index < tableIds.length;
      index += BaseExportService.TABLE_ID_QUERY_CHUNK_SIZE
    ) {
      const tableIdChunk = tableIds.slice(
        index,
        index + BaseExportService.TABLE_ID_QUERY_CHUNK_SIZE
      );
      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        signal?.throwIfAborted();
        const page = await prisma.view.findMany({
          where: {
            tableId: { in: tableIdChunk },
            deletedTime: null,
          },
          ...(cursor
            ? {
                cursor: {
                  id: cursor,
                },
                skip: 1,
              }
            : {}),
          orderBy: [{ tableId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
          take: BaseExportService.VIEW_EXPORT_BATCH_SIZE,
        });
        signal?.throwIfAborted();

        viewRaws.push(...page);

        hasMore = page.length === BaseExportService.VIEW_EXPORT_BATCH_SIZE;
        if (hasMore) {
          cursor = page[page.length - 1].id;
        }
      }
    }

    return viewRaws;
  }

  /**
   * @description convert the cell value to the csv value
   * @param value - the cell value
   * @param dbFieldName - the db field name
   * @param convertFields - the fields which cross base link fields and relative fields (formula or lookup) need to be convert to single line text
   * @returns the csv value
   */
  private transformConvertFieldsCellValue(
    value: Record<string, unknown>,
    crossBaseRelativeFields: Field[]
  ) {
    if (!value) {
      return value;
    }

    const newRecord = {} as Record<string, unknown>;

    const crossBaseRelativeDbFieldNames = crossBaseRelativeFields.map(
      ({ dbFieldName }) => dbFieldName
    );

    Object.entries(value).forEach(([key, value]) => {
      let newValue = value;
      const fieldRaw = crossBaseRelativeFields.find(({ dbFieldName }) => dbFieldName === key);
      if (crossBaseRelativeDbFieldNames.includes(key) && value && fieldRaw) {
        const fieldIns = createFieldInstanceByRaw(fieldRaw);
        newValue = fieldIns.cellValue2String(newValue);
      }

      // convert date to iso string
      if (value instanceof Date) {
        newValue = value.toISOString();
      }

      newRecord[key] = newValue;
    });

    return newRecord;
  }

  // cross base link field and relative fields should convert to text as well
  private generateFieldConfig(
    fieldRaws: Field[],
    allowCrossBase = false,
    excludedTableIds?: string[],
    crossSpaceForeignBaseIds: Set<string> = new Set()
  ) {
    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const createdTimeMap = fieldRaws.reduce(
      (acc, field) => {
        acc[field.id] = field.createdTime.toISOString();
        return acc;
      },
      {} as Record<string, string>
    );

    const crossBaseRelativeFields = this.getCrossBaseFields(
      fieldRaws,
      allowCrossBase,
      crossSpaceForeignBaseIds
    );

    const disconnectedFields = this.getDisconnectedFields(
      fieldRaws,
      crossBaseRelativeFields.map(({ id }) => id),
      excludedTableIds
    );

    const otherFields = fields
      .filter(
        ({ id }) =>
          !crossBaseRelativeFields.map(({ id }) => id).includes(id) &&
          !disconnectedFields.map(({ id }) => id).includes(id)
      )
      .map((field, index) => ({
        ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
        createdTime: createdTimeMap[field.id],
        order: fieldRaws[index].order,
      }));

    return [
      ...otherFields,
      ...crossBaseRelativeFields,
      ...disconnectedFields,
    ] as IBaseJson['tables'][number]['fields'];
  }

  private getDisconnectedFields(
    fieldRaws: Field[],
    crossBaseRelativeFields: string[],
    excludedTableIds?: string[]
  ) {
    const restFields = fieldRaws.filter(({ id }) => !crossBaseRelativeFields?.includes(id));
    if (!excludedTableIds?.length) {
      return [];
    }

    const fields = restFields.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const createdTimeMap = restFields.reduce(
      (acc, field) => {
        acc[field.id] = field.createdTime.toISOString();
        return acc;
      },
      {} as Record<string, string>
    );

    const disconnectedLinkFields = fields
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .filter(({ options }) =>
        excludedTableIds.includes((options as ILinkFieldOptions)?.foreignTableId)
      )
      .map((field, index) => {
        const res = {
          ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
          type: FieldType.SingleLineText,
          createdTime: createdTimeMap[field.id],
          order: fieldRaws[index].order,
        };

        return omit(res, [
          'options',
          'lookupOptions',
          'isLookup',
          'isConditionalLookup',
          'isMultipleCellValue',
        ]);
      });

    // fields which rely on the disconnected link fields (link-based lookup/rollup)
    const disconnectedRelativeFields = fields
      .filter(
        ({ type, isLookup }) =>
          isLookup || type === FieldType.Rollup || type === FieldType.ConditionalRollup
      )
      .filter(({ lookupOptions }) => {
        if (!lookupOptions || !isLinkLookupOptions(lookupOptions)) {
          return false;
        }
        return disconnectedLinkFields.map(({ id }) => id).includes(lookupOptions.linkFieldId);
      })
      .map((field, index) => {
        const res = {
          ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
          type: FieldType.SingleLineText,
          createdTime: createdTimeMap[field.id],
          order: fieldRaws[index].order,
          dbFieldType: 'TEXT',
          cellValueType: 'string',
        };

        return omit(res, [
          'options',
          'lookupOptions',
          'isLookup',
          'isConditionalLookup',
          'isMultipleCellValue',
        ]);
      });

    const alreadyHandledIds = new Set([
      ...disconnectedLinkFields.map(({ id }) => id),
      ...disconnectedRelativeFields.map(({ id }) => id),
    ]);

    // Conditional fields (ConditionalLookup/ConditionalRollup) that directly reference excluded tables
    // These don't go through a link field, so they aren't caught by the link-based check above
    const disconnectedConditionalFields = fields
      .filter(({ id }) => !alreadyHandledIds.has(id))
      .filter(
        ({ type, isLookup, isConditionalLookup }) =>
          (isLookup && isConditionalLookup) || type === FieldType.ConditionalRollup
      )
      .filter((field) => {
        const { type, isLookup, isConditionalLookup, lookupOptions, options } = field;

        if (isLookup && isConditionalLookup) {
          const conditionalOptions = lookupOptions as IConditionalLookupOptions | undefined;
          return (
            conditionalOptions?.foreignTableId &&
            excludedTableIds.includes(conditionalOptions.foreignTableId)
          );
        }

        if (type === FieldType.ConditionalRollup) {
          const conditionalOptions = options as IConditionalRollupFieldOptions | undefined;
          return (
            conditionalOptions?.foreignTableId &&
            excludedTableIds.includes(conditionalOptions.foreignTableId)
          );
        }

        return false;
      })
      .map((field, index) => {
        const res = {
          ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
          type: FieldType.SingleLineText,
          createdTime: createdTimeMap[field.id],
          order: fieldRaws[index].order,
          dbFieldType: 'TEXT',
          cellValueType: 'string',
        };

        return omit(res, [
          'options',
          'lookupOptions',
          'isLookup',
          'isConditionalLookup',
          'isMultipleCellValue',
        ]);
      });

    return [
      ...disconnectedLinkFields,
      ...disconnectedRelativeFields,
      ...disconnectedConditionalFields,
    ] as IBaseJson['tables'][number]['fields'];
  }

  private async computeCrossSpaceForeignBaseIds(
    fieldRaws: Field[],
    destSpaceId?: string,
    signal?: AbortSignal
  ): Promise<Set<string>> {
    signal?.throwIfAborted();
    if (!destSpaceId || isCrossSpaceReferenceAllowed()) return new Set();
    const foreignBaseIds = new Set<string>();
    for (const f of fieldRaws) {
      try {
        const opts = f.options ? JSON.parse(f.options as string) : null;
        const baseId = opts?.baseId;
        if (typeof baseId === 'string') foreignBaseIds.add(baseId);
      } catch {
        // ignore
      }
      try {
        const lopts = f.lookupOptions ? JSON.parse(f.lookupOptions as string) : null;
        const baseId = lopts?.baseId;
        if (typeof baseId === 'string') foreignBaseIds.add(baseId);
      } catch {
        // ignore
      }
    }
    if (foreignBaseIds.size === 0) return new Set();
    const bases = await this.prismaService.txClient().base.findMany({
      where: { id: { in: Array.from(foreignBaseIds) }, deletedTime: null },
      select: { id: true, spaceId: true },
    });
    signal?.throwIfAborted();
    return new Set(bases.filter((b) => b.spaceId !== destSpaceId).map((b) => b.id));
  }

  private getCrossBaseFields(
    fieldRaws: Field[],
    allowCrossBase = false,
    crossSpaceForeignBaseIds: Set<string> = new Set()
  ) {
    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const createdTimeMap = fieldRaws.reduce(
      (acc, field) => {
        acc[field.id] = field.createdTime.toISOString();
        return acc;
      },
      {} as Record<string, string>
    );

    // When allowCrossBase=false, every cross-base field is degraded (legacy behavior).
    // When allowCrossBase=true, only fields whose foreign base lives in a different
    // space than the destination (crossSpaceForeignBaseIds) are degraded — same-space
    // cross-base relationships are preserved.
    const shouldDegradeByBaseId = (baseId: string | undefined): boolean => {
      if (!baseId) return false;
      if (!allowCrossBase) return true;
      return crossSpaceForeignBaseIds.has(baseId);
    };

    const linkDegradeIds = new Set<string>(
      fields
        .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
        .filter(({ options }) =>
          shouldDegradeByBaseId((options as ILinkFieldOptions | undefined)?.baseId)
        )
        .map(({ id }) => id)
    );

    const omitDegradedKeys = [
      'options',
      'lookupOptions',
      'isLookup',
      'isConditionalLookup',
      'isMultipleCellValue',
    ] as const;

    const crossBaseLinkFields = fields
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .filter(({ options }) => Boolean((options as ILinkFieldOptions)?.baseId))
      .map((field, index) => {
        const degrade = linkDegradeIds.has(field.id);
        const res = {
          ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
          type: degrade ? FieldType.SingleLineText : field.type,
          createdTime: createdTimeMap[field.id],
          order: fieldRaws[index].order,
        };

        return degrade ? omit(res, omitDegradedKeys) : res;
      });

    // fields which rely on the cross base link fields (link-based lookup/rollup)
    const relativeFields = fields
      .filter(
        ({ type, isLookup }) =>
          isLookup || type === FieldType.Rollup || type === FieldType.ConditionalRollup
      )
      .filter((field) => {
        const { lookupOptions, type, options } = field;

        // Case 1: lookup field that is itself a cross-base link (type === 'link' && isLookup && options.baseId)
        // This happens when you lookup a cross-base link field through a local link field
        if (type === FieldType.Link && (options as ILinkFieldOptions)?.baseId) {
          return true;
        }

        // Case 2: lookup/rollup field that depends on a cross-base link field
        if (!lookupOptions || !isLinkLookupOptions(lookupOptions)) {
          return false;
        }
        return crossBaseLinkFields.map(({ id }) => id).includes(lookupOptions.linkFieldId);
      })
      .map((field, index) => {
        let degrade: boolean;
        if (field.type === FieldType.Link && (field.options as ILinkFieldOptions)?.baseId) {
          degrade = shouldDegradeByBaseId((field.options as ILinkFieldOptions).baseId);
        } else if (field.lookupOptions && isLinkLookupOptions(field.lookupOptions)) {
          degrade = linkDegradeIds.has(field.lookupOptions.linkFieldId);
        } else {
          degrade = !allowCrossBase;
        }

        const res = {
          ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
          type: degrade ? FieldType.SingleLineText : field.type,
          createdTime: createdTimeMap[field.id],
          order: fieldRaws[index].order,
          dbFieldType: degrade ? 'TEXT' : field.dbFieldType,
          cellValueType: degrade ? 'string' : field.cellValueType,
        };

        return degrade ? omit(res, omitDegradedKeys) : res;
      });

    const alreadyHandledIds = new Set([
      ...crossBaseLinkFields.map(({ id }) => id),
      ...relativeFields.map(({ id }) => id),
    ]);

    // Conditional fields (ConditionalLookup/ConditionalRollup) that are cross-base
    // These don't use a link field as intermediary, so they have their own baseId
    const conditionalCrossBaseFields = fields
      .filter(({ id }) => !alreadyHandledIds.has(id))
      .filter(
        ({ type, isLookup, isConditionalLookup }) =>
          (isLookup && isConditionalLookup) || type === FieldType.ConditionalRollup
      )
      .filter((field) => {
        const { type, isLookup, isConditionalLookup, lookupOptions, options } = field;

        if (isLookup && isConditionalLookup) {
          const conditionalOptions = lookupOptions as IConditionalLookupOptions | undefined;
          return Boolean(conditionalOptions?.baseId);
        }

        if (type === FieldType.ConditionalRollup) {
          const conditionalOptions = options as IConditionalRollupFieldOptions | undefined;
          return Boolean(conditionalOptions?.baseId);
        }

        return false;
      })
      .map((field, index) => {
        const conditionalBaseId =
          field.isLookup && field.isConditionalLookup
            ? (field.lookupOptions as IConditionalLookupOptions | undefined)?.baseId
            : (field.options as IConditionalRollupFieldOptions | undefined)?.baseId;
        const degrade = shouldDegradeByBaseId(conditionalBaseId);

        const res = {
          ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
          type: degrade ? FieldType.SingleLineText : field.type,
          createdTime: createdTimeMap[field.id],
          order: fieldRaws[index].order,
          dbFieldType: degrade ? 'TEXT' : field.dbFieldType,
          cellValueType: degrade ? 'string' : field.cellValueType,
        };

        return degrade ? omit(res, omitDegradedKeys) : res;
      });

    return [
      ...crossBaseLinkFields,
      ...relativeFields,
      ...conditionalCrossBaseFields,
    ] as IBaseJson['tables'][number]['fields'];
  }

  private generateViewConfig(viewRaws: View[]): IBaseJson['tables'][number]['views'] {
    return (
      viewRaws
        // .filter(({ type }) => type !== ViewType.Plugin)
        .map((viewRaw) => createViewVoByRaw(viewRaw))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((view, index) => ({
          ...pick(view, [
            'id',
            'name',
            'description',
            'type',
            'sort',
            'filter',
            'group',
            'options',
            'columnMeta',
            'enableShare',
            'shareMeta',
            'shareId',
            'isLocked',
          ]),
          order: index,
        })) as IBaseJson['tables'][number]['views']
    );
  }

  async generateFolderConfig(
    baseId: string,
    includedFolderIds?: string[],
    signal?: AbortSignal
  ): Promise<IBaseJson['folders']> {
    signal?.throwIfAborted();
    // If includedFolderIds is an empty array, return empty array (user filtered but no folders selected)
    if (includedFolderIds !== undefined && includedFolderIds.length === 0) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const folderRaws = await prisma.baseNodeFolder.findMany({
      where: {
        baseId,
        deletedTime: null,
        ...(includedFolderIds && includedFolderIds.length > 0
          ? { id: { in: includedFolderIds } }
          : {}),
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        name: true,
      },
    });
    signal?.throwIfAborted();

    return folderRaws.map((folderRaw) => ({
      id: folderRaw.id,
      name: folderRaw.name,
    }));
  }

  /**
   * Generate node configuration for base export/duplicate
   *
   * @param baseId - The base ID to get nodes from
   * @param includeNodes - Optional array of node IDs to include
   * @param rootNodeIds - Optional array of node IDs that should become root nodes (parentId = null)
   */
  async generateNodeConfig(
    baseId: string,
    includeNodes?: string[],
    rootNodeIds?: string[],
    signal?: AbortSignal
  ): Promise<IBaseJson['nodes']> {
    signal?.throwIfAborted();
    // If includeNodes is an empty array, return empty array (user filtered but no nodes selected)
    if (includeNodes !== undefined && includeNodes.length === 0) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const nodeRaws = await prisma.baseNode.findMany({
      where: {
        baseId,
        ...(includeNodes && includeNodes.length > 0 ? { id: { in: includeNodes } } : {}),
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        parentId: true,
        resourceId: true,
        resourceType: true,
        order: true,
      },
    });
    signal?.throwIfAborted();

    const rootNodeIdSet = rootNodeIds ? new Set(rootNodeIds) : null;

    return nodeRaws.map((nodeRaw) => {
      // Set parentId to null if:
      // 1. This node is in rootNodeIds, or
      // 2. The parent node is not in includeNodes
      const parentId =
        rootNodeIdSet?.has(nodeRaw.id) ||
        (includeNodes && nodeRaw.parentId && !includeNodes.includes(nodeRaw.parentId))
          ? null
          : nodeRaw.parentId;

      return {
        id: nodeRaw.id,
        parentId,
        resourceId: nodeRaw.resourceId,
        resourceType: nodeRaw.resourceType as BaseNodeResourceType,
        order: nodeRaw.order,
      };
    });
  }

  async generatePluginConfig(
    baseId: string,
    includedDashboardIds?: string[],
    viewRaws?: View[],
    includedTableIds?: string[],
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const pluginJson = {} as IBaseJson['plugins'];

    pluginJson[PluginPosition.Dashboard] = await this.generateDashboard(
      baseId,
      includedDashboardIds,
      signal
    );

    pluginJson[PluginPosition.Panel] = await this.generatePluginPanel(
      baseId,
      includedTableIds,
      signal
    );

    pluginJson[PluginPosition.View] = await this.generatePluginView(baseId, viewRaws, signal);

    return pluginJson;
  }

  private async generatePluginView(baseId: string, viewRaws?: View[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const viewPluginRaws = viewRaws
      ? viewRaws.filter(({ type }) => type === ViewType.Plugin)
      : await this.findPluginViewsByBaseId(baseId, signal);

    const viewPluginInstallRaws = await this.prismaService.txClient().pluginInstall.findMany({
      where: {
        positionId: {
          in: viewPluginRaws.map(({ id }) => id),
        },
      },
    });
    signal?.throwIfAborted();

    return viewPluginRaws.map((viewRaw) => {
      const pluginInstall = viewPluginInstallRaws.find(
        ({ positionId }) => positionId === viewRaw.id
      )!;

      return {
        ...pick(viewRaw, ['id', 'name', 'description', 'type', 'isLocked', 'tableId', 'order']),
        columnMeta: viewRaw.columnMeta ? JSON.parse(viewRaw.columnMeta) : null,
        options: viewRaw.options ? JSON.parse(viewRaw.options) : null,
        filter: viewRaw.filter ? JSON.parse(viewRaw.filter) : null,
        group: viewRaw.group ? JSON.parse(viewRaw.group) : null,
        shareMeta: viewRaw.shareMeta ? JSON.parse(viewRaw.shareMeta) : null,
        pluginInstall: {
          ...pick(pluginInstall, ['id', 'pluginId', 'baseId', 'name', 'positionId', 'position']),
          storage: pluginInstall.storage ? JSON.parse(pluginInstall.storage) : null,
        },
      };
    }) as unknown as IBaseJson['plugins'][PluginPosition.View];
  }

  private async findPluginViewsByBaseId(baseId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const tableIds = await this.prismaService.txClient().tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });
    signal?.throwIfAborted();

    return (await this.findViewsByTableIds(tableIds.map(({ id }) => id), signal)).filter(
      ({ type }) => type === ViewType.Plugin
    );
  }

  private async generatePluginPanel(
    baseId: string,
    includedTableIds?: string[],
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const prisma = this.prismaService.txClient();
    const tableIds =
      includedTableIds ??
      (
        await prisma.tableMeta.findMany({
          where: {
            baseId,
            deletedTime: null,
          },
          select: {
            id: true,
          },
        })
      ).map(({ id }) => id);
    signal?.throwIfAborted();

    const pluginPanelRaws = await prisma.pluginPanel.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        name: true,
        layout: true,
        tableId: true,
      },
    });
    signal?.throwIfAborted();

    const panelInstallPluginRaws = await prisma.pluginInstall.findMany({
      where: {
        positionId: {
          in: pluginPanelRaws.map(({ id }) => id),
        },
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        positionId: true,
        position: true,
        storage: true,
      },
    });
    signal?.throwIfAborted();

    return pluginPanelRaws.map(({ id, name, layout, tableId }) => {
      const panelConfig = {
        id,
        name,
        layout: layout ? JSON.parse(layout) : null,
        tableId,
      } as unknown as IBaseJson['plugins'][PluginPosition.Panel][number];

      panelConfig.pluginInstall = panelInstallPluginRaws
        .filter(({ positionId }) => positionId === id)
        .map(({ id, pluginId, positionId, position, name, storage }) => ({
          id,
          pluginId,
          positionId,
          position,
          name,
          storage: storage ? JSON.parse(storage) : null,
        })) as unknown as IBaseJson['plugins'][PluginPosition.Panel][number]['pluginInstall'];

      return panelConfig;
    });
  }

  private async generateDashboard(
    baseId: string,
    includedDashboardIds?: string[],
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    // If includedDashboardIds is an empty array, return empty array (user filtered but no dashboards selected)
    if (includedDashboardIds !== undefined && includedDashboardIds.length === 0) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const dashboardRaws = await prisma.dashboard.findMany({
      where: {
        baseId,
        deletedTime: null,
        ...(includedDashboardIds && includedDashboardIds.length > 0
          ? { id: { in: includedDashboardIds } }
          : {}),
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        name: true,
        layout: true,
      },
    });
    signal?.throwIfAborted();

    const dashboardInstallPluginRaws = await prisma.pluginInstall.findMany({
      where: {
        positionId: {
          in: dashboardRaws.map(({ id }) => id),
        },
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        positionId: true,
        position: true,
        storage: true,
      },
    });
    signal?.throwIfAborted();

    return dashboardRaws.map(({ id, name, layout }) => {
      const dashboardConfig = {
        id,
        name,
        layout: layout ? JSON.parse(layout) : null,
      } as unknown as IBaseJson['plugins'][PluginPosition.Dashboard][number];

      dashboardConfig.pluginInstall = dashboardInstallPluginRaws
        .filter(({ positionId }) => positionId === id)
        .map(({ id, pluginId, positionId, position, name, storage }) => ({
          id,
          pluginId,
          positionId,
          position,
          name,
          storage: storage ? JSON.parse(storage) : null,
        })) as unknown as IBaseJson['plugins'][PluginPosition.Dashboard][number]['pluginInstall'];

      return dashboardConfig;
    });
  }

  private async notifyExportResult(
    baseId: string,
    message: string | ILocalization<I18nPath>,
    result?: {
      status: 'success' | 'failed' | 'cancelled';
      previewUrl?: string;
      attachment?: { name: string; path: string };
      errorMessage?: string;
    }
  ) {
    const userId = this.cls.get('user.id');
    this.eventEmitterService.emit(Events.BASE_EXPORT_COMPLETE, {
      status: result?.status,
      previewUrl: result?.previewUrl,
      attachment: result?.attachment,
      errorMessage: result?.errorMessage,
    });
    await this.notificationService.sendExportBaseResultNotify({
      baseId: baseId,
      toUserId: userId,
      message: message,
    });
  }
}
