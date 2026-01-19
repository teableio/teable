/* eslint-disable sonarjs/no-duplicate-string */
import { Readable, PassThrough } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { ILinkFieldOptions, ILocalization } from '@teable/core';
import { FieldType, getRandomString, ViewType, isLinkLookupOptions } from '@teable/core';
import type { Field, View, TableMeta, Base } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition, UploadType } from '@teable/openapi';
import type { BaseNodeResourceType, IBaseJson } from '@teable/openapi';
import archiver from 'archiver';
import { stringify } from 'csv-stringify/sync';
import { Knex } from 'knex';
import { omit, pick } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import type { I18nPath } from '../../types/i18n.generated';
import { second } from '../../utils/second';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { NotificationService } from '../notification/notification.service';
import { createViewVoByRaw } from '../view/model/factory';
import { EXCLUDE_SYSTEM_FIELDS } from './constant';
@Injectable()
export class BaseExportService {
  public static CSV_CHUNK = 500;
  public static FILE_SUFFIX = 'tea';
  public static EXPORT_FIELD_COLUMNS = [
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
  private logger = new Logger(BaseExportService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly notificationService: NotificationService,
    private readonly eventEmitterService: EventEmitterService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @StorageConfig() private readonly storageConfig: IStorageConfig
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

  /**
   * Download a single file and append it to archive with timeout and error handling
   * @returns true on success, false on failure
   */
  async appendFileToArchive(
    archive: archiver.Archiver,
    bucket: string,
    s3Path: string,
    archivePath: string,
    timeoutMs: number = 10 * 60 * 1000,
    chatId?: string
  ): Promise<boolean> {
    try {
      const stream = await this.storageAdapter.downloadFile(bucket, s3Path);

      await new Promise<void>((resolve, reject) => {
        archive.append(stream, { name: archivePath });

        const timeout = setTimeout(() => {
          stream.destroy();
          reject(new Error(`File stream timeout after ${timeoutMs}ms: ${archivePath}`));
        }, timeoutMs);

        stream.on('error', (err) => {
          clearTimeout(timeout);
          stream.destroy();
          reject(err);
        });

        stream.on('end', () => {
          clearTimeout(timeout);
          stream.destroy();
          resolve();
        });
      });

      return true;
    } catch (err) {
      this.logger.error(
        `Failed to export file ${s3Path} to ${archivePath}: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }

  async exportBaseZip(baseId: string, includeData = true) {
    let baseName: string | undefined;
    try {
      ({ name: baseName } = await this.prismaService.base.findFirstOrThrow({
        where: {
          id: baseId,
        },
        select: {
          name: true,
        },
      }));
    } catch (error) {
      this.captureExportError(error, {
        stage: 'fetchBase',
        baseId,
        includeData,
      });
      throw error;
    }

    // create a stream pass through, ready to fill data
    const passThrough = new PassThrough();

    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    archive.on('warning', function (err) {
      if (err.code === 'ENOENT') {
        // log warning
      } else {
        // throw error
        throw err;
      }
    });

    archive.on('error', function (err) {
      passThrough.emit('error', err);
      throw err;
    });

    archive.pipe(passThrough);

    const token = this.generateExportFolderId();
    const bucket = StorageAdapter.getBucket(UploadType.ExportBase);
    const pathDir = StorageAdapter.getDir(UploadType.ExportBase);

    // Critical: Start upload first to ensure passThrough has a consumer, preventing backpressure blocking
    // If uploadFileStream is called after finalize(), large files will hang in append
    // Note: This occupies sockets, recommend setting BACKEND_STORAGE_S3_UPLOAD_QUEUE_SIZE=1 to control upload concurrency to 1
    const uploadPromise = this.storageAdapter.uploadFileStream(
      bucket,
      `${pathDir}/${token}.${BaseExportService.FILE_SUFFIX}`,
      passThrough,
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/zip',
      }
    );

    try {
      await this.pipeArchive(archive, baseId, includeData);
      archive.finalize();
      const uploadResult = await uploadPromise;
      const { path } = uploadResult;
      const name = `${baseName}.${BaseExportService.FILE_SUFFIX}`;
      const previewUrl = await this.storageAdapter.getPreviewUrl(
        StorageAdapter.getBucket(UploadType.ExportBase),
        path,
        second(this.storageConfig.tokenExpireIn),
        {
          // eslint-disable-next-line
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        }
      );
      const message: ILocalization<I18nPath> = {
        i18nKey: 'common.email.templates.notify.exportBase.success.message',
        context: {
          baseName,
          previewUrl,
          name,
        },
      };
      this.notifyExportResult(baseId, message, previewUrl);
    } catch (e) {
      this.captureExportError(e, {
        stage: 'processExport',
        baseId,
        baseName,
        includeData,
      });
      if (e instanceof Error) {
        const message: ILocalization<I18nPath> = {
          i18nKey: 'common.email.templates.notify.exportBase.failed.message',
          context: {
            baseName,
            errorMessage: e.message,
          },
        };
        this.notifyExportResult(baseId, message);
      }
    }
  }

  async pipeArchive(archive: archiver.Archiver, baseId: string, includeData: boolean) {
    await this.processExportBaseZip(baseId, includeData, archive);
  }

  async processExportBaseZip(baseId: string, includeData: boolean, archive: archiver.Archiver) {
    const prisma = this.prismaService.txClient();
    //  1. get all raw info
    const baseRaw = await prisma.base.findUniqueOrThrow({
      where: {
        id: baseId,
        deletedTime: null,
      },
    });
    const tableRaws = await prisma.tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });
    const tableIds = tableRaws.map(({ id }) => id);
    const fieldRaws = await prisma.field.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
        deletedTime: null,
      },
    });
    const viewRaws = await prisma.view.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });

    // 2. generate base structure json
    const structure = await this.generateBaseStructConfig({
      baseRaw,
      tableRaws,
      fieldRaws,
      viewRaws,
    });
    const jsonString = JSON.stringify(structure, null, 2);
    const jsonStream = Readable.from(jsonString);

    // 3. export structure json
    archive.append(jsonStream, { name: 'structure.json' });

    // 4 export data
    if (includeData) {
      this.logger.log(`export base ${baseRaw.id}/${baseRaw.name}: Start exporting attachments`);
      // 4.0 export attachments
      await this.appendAttachments('attachments', tableRaws, archive);
      this.logger.log(
        `export base ${baseRaw.id}/${baseRaw.name}: End exporting attachments data csv`
      );

      // 4.1 export attachments data .csv
      this.logger.log(
        `export base ${baseRaw.id}/${baseRaw.name}: Start exporting attachments data csv`
      );
      await this.appendAttachmentsDataCsv('attachments', tableRaws, archive);
      this.logger.log(
        `export base ${baseRaw.id}/${baseRaw.name}: End exporting attachments data csv`
      );

      this.logger.log(`export base ${baseRaw.id}/${baseRaw.name}: Start exporting table data csv`);

      // 4.2 export table data csv
      const crossBaseRelativeFields = this.getCrossBaseFields(fieldRaws, false);
      const crossBaseRelativeFieldIds = new Set(crossBaseRelativeFields.map(({ id }) => id));
      const crossBaseRelativeFieldsRaws = fieldRaws.filter(({ id }) =>
        crossBaseRelativeFieldIds.has(id)
      );

      for (const tableRaw of tableRaws) {
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
          excludeDbFieldNames
        );
      }

      const linkFieldInstances = fieldRaws
        .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
        .filter(({ id }) => !crossBaseRelativeFieldIds.has(id))
        .map((f) => createFieldInstanceByRaw(f));

      // 5. export junction csv for link fields
      const junctionTableName = [] as string[];
      for (const linkField of linkFieldInstances) {
        const { options } = linkField;
        const { fkHostTableName, selfKeyName, foreignKeyName } = options as ILinkFieldOptions;
        if (fkHostTableName.includes('junction_') && !junctionTableName.includes(fkHostTableName)) {
          await this.appendJunctionCsv(
            'tables',
            fkHostTableName,
            selfKeyName,
            foreignKeyName,
            archive
          );
        }
      }

      this.logger.log(`export base ${baseRaw.id}/${baseRaw.name}: End exporting table data csv`);
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
    excludedTableIds?: string[];
  }) {
    const { name: baseName, icon: baseIcon, id: baseId } = baseRaw;
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
      const currentTableFields = fieldRaws.filter(({ tableId }) => tableId === id);
      tableObject.fields = this.generateFieldConfig(
        currentTableFields,
        allowCrossBase,
        excludedTableIds
      );
      tableObject.views = this.generateViewConfig(viewRaws.filter(({ tableId }) => tableId === id));
      tables.push(tableObject);
    }

    const plugins = await this.generatePluginConfig(baseId, includedDashboardIds);
    const folders = await this.generateFolderConfig(baseId, includedFolderIds);
    const nodes = await this.generateNodeConfig(baseId, includeNodes);

    return {
      id: baseId,
      name: baseName,
      icon: baseIcon,
      version: process.env.NEXT_PUBLIC_BUILD_VERSION!,
      tables,
      plugins,
      folders,
      nodes,
    };
  }

  private async appendAttachments(
    filePath: string,
    tableRaws: TableMeta[],
    archive: archiver.Archiver
  ) {
    const tableIds = tableRaws.map(({ id }) => id);
    const prisma = this.prismaService.txClient();
    const attachmentTokenRaws = await prisma.attachmentsTable.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
      },
      select: {
        token: true,
        name: true,
      },
    });
    const attachments = (
      await prisma.attachments.findMany({
        where: {
          token: {
            in: attachmentTokenRaws.map(({ token }) => token),
          },
        },
        select: {
          token: true,
          path: true,
          mimetype: true,
          thumbnailPath: true,
        },
      })
    ).map((att) => ({
      ...att,
      name: attachmentTokenRaws.find(({ token }) => token === att.token)?.name,
    }));
    const bucket = StorageAdapter.getBucket(UploadType.Table);
    for (const { token, path, name } of attachments) {
      const archivePath = `${filePath}/${token}.${name?.split('.').pop()}`;
      await this.appendFileToArchive(archive, bucket, path, archivePath);
    }

    const thumbnailAttachments = attachments.filter(({ thumbnailPath }) => thumbnailPath);
    const prefix = `${filePath}/thumbnail__`;

    for (const { thumbnailPath, name } of thumbnailAttachments) {
      const suffix = name?.split('.').pop() || 'jpg';
      const {
        lg: thumbnailLgPath,
        md: thumbnailMdPath,
        sm: thumbnailSmPath,
      } = JSON.parse(thumbnailPath as string);

      if (thumbnailLgPath) {
        const fileName = thumbnailLgPath.split('/').pop();
        await this.appendFileToArchive(
          archive,
          bucket,
          thumbnailLgPath,
          `${prefix}${fileName}.${suffix}`
        );
      }

      if (thumbnailMdPath) {
        const fileName = thumbnailMdPath.split('/').pop();
        await this.appendFileToArchive(
          archive,
          bucket,
          thumbnailMdPath,
          `${prefix}${fileName}.${suffix}`
        );
      }

      if (thumbnailSmPath) {
        const fileName = thumbnailSmPath.split('/').pop();
        await this.appendFileToArchive(
          archive,
          bucket,
          thumbnailSmPath,
          `${prefix}${fileName}.${suffix}`
        );
      }
    }
  }

  private async appendTableDataCsv(
    archive: archiver.Archiver,
    filePath: string,
    tableRaw: TableMeta,
    crossBaseRelativeFields: Field[],
    excludeDbFieldNames: string[]
  ) {
    const { dbTableName, id } = tableRaw;
    const csvStream = new PassThrough();
    const prisma = this.prismaService.txClient();
    const columnInfoQuery = this.dbProvider.columnInfo(dbTableName);
    const columnInfo = await prisma.$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);

    // 1. set csv header
    const convertLinkFields = crossBaseRelativeFields.filter(({ type }) => type === FieldType.Link);
    const fkNames = convertLinkFields
      .filter(({ type }) => type === FieldType.Link)
      .map(({ id }) => `__fk_${id}`);
    const columnHeader = columnInfo
      .map(({ name }) => name)
      // exclude system fields
      .filter((name) => !excludeDbFieldNames.includes(name))
      // exclude fk fields which are cross base link fields
      .filter((name) => !fkNames.includes(name));
    // write the column header
    const headerRow = columnHeader.join(',');
    csvStream.write(`${headerRow}\n`);

    let offset = 0;
    let hasMoreData = true;
    archive.append(csvStream, { name: `${filePath}/${id}.csv` });

    csvStream.on('error', (err) => {
      this.logger.error(`CSV Stream error: ${err.message}`, err.stack);
      throw err;
    });

    csvStream.on('end', () => {
      console.log('CSV Stream ended');
    });

    csvStream.on('finish', () => {
      console.log('CSV Stream finished');
    });

    archive.on('error', (err) => {
      this.logger.error(`CSV Stream archive error: ${err.message}`, err.stack);
      throw err;
    });

    // 2. write csv content
    while (hasMoreData) {
      const csvChunk = await this.getCsvChunk(
        dbTableName,
        offset,
        crossBaseRelativeFields,
        excludeDbFieldNames
      );
      if (csvChunk.length === 0) {
        hasMoreData = false;
        break;
      }
      const csvString = stringify(csvChunk, {
        columns: columnHeader,
      });
      csvStream.write(csvString);
      offset += BaseExportService.CSV_CHUNK;
    }
    csvStream.end();
  }

  private async appendAttachmentsDataCsv(
    filePath: string,
    tableRaws: TableMeta[],
    archive: archiver.Archiver
  ) {
    const csvStream = new PassThrough();
    const prisma = this.prismaService.txClient();

    const tokens = await prisma.attachmentsTable.findMany({
      where: {
        tableId: {
          in: tableRaws.map(({ id }) => id),
        },
      },
      select: {
        token: true,
      },
    });

    const attachments = await prisma.attachments.findMany({
      where: {
        token: {
          in: tokens.map(({ token }) => token),
        },
        deletedTime: null,
      },
    });

    if (!attachments.length) {
      return;
    }

    const columnInfo = Object.keys(attachments[0]);

    // 1. set csv header
    const columnHeader = columnInfo
      // exclude system fields
      .filter((name) => !EXCLUDE_SYSTEM_FIELDS.includes(name));

    const headerRow = columnHeader.join(',');
    csvStream.write(`${headerRow}\n`);

    archive.append(csvStream, { name: `${filePath}/attachments.csv` });

    csvStream.on('error', (err) => {
      this.logger.error(`CSV Stream error: ${err.message}`, err.stack);
      throw err;
    });

    csvStream.on('end', () => {
      console.log('CSV Stream ended');
    });

    csvStream.on('finish', () => {
      console.log('CSV Stream finished');
    });

    archive.on('error', (err) => {
      this.logger.error(`CSV Stream archive error: ${err.message}`, err.stack);
      throw err;
    });

    const csvString = stringify(
      attachments.map((att) => pick(att, columnHeader)),
      {
        columns: columnHeader,
      }
    );
    csvStream.write(csvString);

    csvStream.end();
  }

  private async appendJunctionCsv(
    filePath: string,
    fkHostTableName: string,
    selfKeyName: string,
    foreignKeyName: string,
    archive: archiver.Archiver
  ) {
    const csvStream = new PassThrough();
    const prisma = this.prismaService.txClient();
    const columnInfoQuery = this.dbProvider.columnInfo(fkHostTableName);
    const columnInfo = await prisma.$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);

    // 1. set csv header
    const columnHeader = columnInfo
      .map(({ name }) => name)
      // exclude id column
      .filter((name) => name !== '__id');
    // write the column header
    const headerRow = columnHeader.join(',');
    csvStream.write(`${headerRow}\n`);

    let offset = 0;
    let hasMoreData = true;
    archive.append(csvStream, { name: `${filePath}/${fkHostTableName}.csv` });

    csvStream.on('error', (err) => {
      this.logger.error(`CSV Stream error: ${err.message}`, err.stack);
      throw err;
    });

    csvStream.on('end', () => {
      console.log('CSV Stream ended');
    });

    csvStream.on('finish', () => {
      console.log('CSV Stream finished');
    });

    archive.on('error', (err) => {
      this.logger.error(`CSV Stream archive error: ${err.message}`, err.stack);
      throw err;
    });

    // 2. write csv content
    while (hasMoreData) {
      const csvChunk = await this.getJunctionChunk(
        fkHostTableName,
        offset,
        [selfKeyName, foreignKeyName],
        ['__id']
      );
      if (csvChunk.length === 0) {
        hasMoreData = false;
        break;
      }
      const csvString = stringify(csvChunk, {
        columns: columnHeader,
      });
      csvStream.write(csvString);
      offset += BaseExportService.CSV_CHUNK;
    }
    csvStream.end();
  }

  private async getCsvChunk(
    dbTableName: string,
    offset: number,
    crossBaseRelativeFields: Field[],
    excludeFieldNames: string[]
  ) {
    const rawRecords = await this.getChunkRecords(dbTableName, offset);
    // 1. clear unless fields
    const records = rawRecords.map((record) => omit(record, excludeFieldNames));
    // 2. convert to csv value
    return records.map((record) =>
      this.transformConvertFieldsCellValue(record, crossBaseRelativeFields)
    );
  }

  private async getJunctionChunk(
    fkHostTableName: string,
    offset: number,
    convertFields: [string, string],
    excludeFieldNames: string[]
  ) {
    const prisma = this.prismaService.txClient();
    const recordsQuery = await this.knex(fkHostTableName)
      .select('*')
      .limit(BaseExportService.CSV_CHUNK)
      .offset(offset)
      .toQuery();
    const rawRecords = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(recordsQuery);
    // 1. clear unless fields
    const records = rawRecords.map((record) => omit(record, excludeFieldNames));

    return records.map((record) => {
      if (!record) {
        return record;
      }

      const newRecord = {} as Record<string, unknown>;

      Object.entries(record).forEach(([key, value]) => {
        newRecord[key] = value;
      });

      return newRecord;
    });
  }

  private async getChunkRecords(dbTableName: string, offset: number) {
    const prisma = this.prismaService.txClient();
    const recordsQuery = await this.knex(dbTableName)
      .select('*')
      .limit(BaseExportService.CSV_CHUNK)
      .offset(offset)
      .orderBy('__auto_number', 'asc')
      .toQuery();
    return await prisma.$queryRawUnsafe<Record<string, unknown>[]>(recordsQuery);
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
    excludedTableIds?: string[]
  ) {
    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const createdTimeMap = fieldRaws.reduce(
      (acc, field) => {
        acc[field.id] = field.createdTime.toISOString();
        return acc;
      },
      {} as Record<string, string>
    );

    const crossBaseRelativeFields = this.getCrossBaseFields(fieldRaws, allowCrossBase);

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

    // fields which rely on the cross base link fields
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

    return [
      ...disconnectedLinkFields,
      ...disconnectedRelativeFields,
    ] as IBaseJson['tables'][number]['fields'];
  }

  private getCrossBaseFields(fieldRaws: Field[], allowCrossBase = false) {
    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const createdTimeMap = fieldRaws.reduce(
      (acc, field) => {
        acc[field.id] = field.createdTime.toISOString();
        return acc;
      },
      {} as Record<string, string>
    );
    const crossBaseLinkFields = fields
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .filter(({ options }) => Boolean((options as ILinkFieldOptions)?.baseId))
      .map((field, index) => {
        const res = {
          ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
          type: allowCrossBase ? field.type : FieldType.SingleLineText,
          createdTime: createdTimeMap[field.id],
          order: fieldRaws[index].order,
        };

        return allowCrossBase
          ? res
          : omit(res, [
              'options',
              'lookupOptions',
              'isLookup',
              'isConditionalLookup',
              'isMultipleCellValue',
            ]);
      });

    // fields which rely on the cross base link fields
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
        const res = {
          ...pick(field, BaseExportService.EXPORT_FIELD_COLUMNS),
          type: allowCrossBase ? field.type : FieldType.SingleLineText,
          createdTime: createdTimeMap[field.id],
          order: fieldRaws[index].order,
          dbFieldType: allowCrossBase ? field.dbFieldType : 'TEXT',
          cellValueType: allowCrossBase ? field.cellValueType : 'string',
        };

        return allowCrossBase
          ? res
          : omit(res, [
              'options',
              'lookupOptions',
              'isLookup',
              'isConditionalLookup',
              'isMultipleCellValue',
            ]);
      });

    return [...crossBaseLinkFields, ...relativeFields] as IBaseJson['tables'][number]['fields'];
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
    includedFolderIds?: string[]
  ): Promise<IBaseJson['folders']> {
    // If includedFolderIds is an empty array, return empty array (user filtered but no folders selected)
    if (includedFolderIds !== undefined && includedFolderIds.length === 0) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const folderRaws = await prisma.baseNodeFolder.findMany({
      where: {
        baseId,
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

    return folderRaws.map((folderRaw) => ({
      id: folderRaw.id,
      name: folderRaw.name,
    }));
  }

  async generateNodeConfig(baseId: string, includeNodes?: string[]): Promise<IBaseJson['nodes']> {
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

    return nodeRaws.map((nodeRaw) => ({
      id: nodeRaw.id,
      parentId: nodeRaw.parentId,
      resourceId: nodeRaw.resourceId,
      resourceType: nodeRaw.resourceType as BaseNodeResourceType,
      order: nodeRaw.order,
    }));
  }

  async generatePluginConfig(baseId: string, includedDashboardIds?: string[]) {
    const pluginJson = {} as IBaseJson['plugins'];

    pluginJson[PluginPosition.Dashboard] = await this.generateDashboard(
      baseId,
      includedDashboardIds
    );

    pluginJson[PluginPosition.Panel] = await this.generatePluginPanel(baseId);

    pluginJson[PluginPosition.View] = await this.generatePluginView(baseId);

    return pluginJson;
  }

  private async generatePluginView(baseId: string) {
    const tableIds = await this.prismaService.txClient().tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
    });

    const prisma = this.prismaService.txClient();

    const viewPluginRaws = await prisma.view.findMany({
      where: {
        tableId: {
          in: tableIds.map(({ id }) => id),
        },
        type: ViewType.Plugin,
        deletedTime: null,
      },
      orderBy: {
        createdTime: 'asc',
      },
    });

    const viewPluginInstallRaws = await prisma.pluginInstall.findMany({
      where: {
        positionId: {
          in: viewPluginRaws.map(({ id }) => id),
        },
      },
    });

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

  private async generatePluginPanel(baseId: string) {
    const prisma = this.prismaService.txClient();
    const tableIds = await prisma.tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });

    const pluginPanelRaws = await prisma.pluginPanel.findMany({
      where: {
        tableId: {
          in: tableIds.map(({ id }) => id),
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

  private async generateDashboard(baseId: string, includedDashboardIds?: string[]) {
    // If includedDashboardIds is an empty array, return empty array (user filtered but no dashboards selected)
    if (includedDashboardIds !== undefined && includedDashboardIds.length === 0) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const dashboardRaws = await prisma.dashboard.findMany({
      where: {
        baseId,
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
    previewUrl?: string
  ) {
    const userId = this.cls.get('user.id');
    await this.eventEmitterService.emit(Events.BASE_EXPORT_COMPLETE, {
      previewUrl,
    });
    await this.notificationService.sendExportBaseResultNotify({
      baseId: baseId,
      toUserId: userId,
      message: message,
    });
  }
}
