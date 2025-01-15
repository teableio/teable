import { Worker } from 'worker_threads';
import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import {
  FieldType,
  FieldKeyType,
  getRandomString,
  getActionTriggerChannel,
  getTableImportChannel,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IAnalyzeRo,
  IImportOptionRo,
  IInplaceImportOptionRo,
  IImportColumn,
} from '@teable/openapi';
import { difference, toString } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { CreateOp } from 'sharedb';
import type { LocalPresence } from 'sharedb/lib/client';

import { ShareDbService } from '../../../share-db/share-db.service';
import type { IClsStore } from '../../../types/cls';
import { NotificationService } from '../../notification/notification.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { DEFAULT_VIEWS, DEFAULT_FIELDS } from '../../table/constant';
import { TableOpenApiService } from '../../table/open-api/table-open-api.service';
import { importerFactory, getWorkerPath } from './import.class';
import type { CsvImporter, ExcelImporter } from './import.class';

@Injectable()
export class ImportOpenApiService {
  private logger = new Logger(ImportOpenApiService.name);
  constructor(
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly notificationService: NotificationService,
    private readonly shareDbService: ShareDbService
  ) {}

  async analyze(analyzeRo: IAnalyzeRo) {
    const { attachmentUrl, fileType } = analyzeRo;

    const importer = importerFactory(fileType, {
      url: attachmentUrl,
      type: fileType,
    });

    return await importer.genColumns();
  }

  async createTableFromImport(baseId: string, importRo: IImportOptionRo, maxRowCount?: number) {
    const userId = this.cls.get('user.id');
    const { attachmentUrl, fileType, worksheets, notification = false, tz } = importRo;

    const importer = importerFactory(fileType, {
      url: attachmentUrl,
      type: fileType,
      maxRowCount,
    });

    // only record base table info, not include records
    const tableResult = [];

    for (const [sheetKey, value] of Object.entries(worksheets)) {
      const { importData, useFirstRowAsHeader, columns, name } = value;

      const columnInfo = columns.length ? columns : [...DEFAULT_FIELDS];
      const fieldsRo = columnInfo.map((col, index) => {
        const result: IFieldRo & {
          isPrimary?: boolean;
        } = {
          ...col,
        };

        if (index === 0) {
          result.isPrimary = true;
        }

        // Date Field should have default tz
        if (col.type === FieldType.Date) {
          result.options = {
            formatting: {
              timeZone: tz,
              date: 'YYYY-MM-DD',
              time: 'None',
            },
          };
        }

        return result;
      });

      // create table with column
      const table = await this.tableOpenApiService.createTable(baseId, {
        name: name,
        fields: fieldsRo,
        views: DEFAULT_VIEWS,
        records: [],
      });

      tableResult.push(table);

      const { fields } = table;

      // if columns is empty, then skip import data
      importData &&
        columns.length &&
        this.importRecords(
          baseId,
          table,
          userId,
          importer,
          { skipFirstNLines: useFirstRowAsHeader ? 1 : 0, sheetKey, notification },
          {
            columnInfo: columns,
            fields: fields.map((f) => ({ id: f.id, type: f.type })),
          }
        );
    }
    return tableResult;
  }

  async inplaceImportTable(
    baseId: string,
    tableId: string,
    inplaceImportRo: IInplaceImportOptionRo,
    maxRowCount?: number,
    projection?: string[]
  ) {
    const userId = this.cls.get('user.id');
    const { attachmentUrl, fileType, insertConfig, notification = false } = inplaceImportRo;

    const { sourceColumnMap, sourceWorkSheetKey, excludeFirstRow } = insertConfig;

    const tableRaw = await this.prismaService.tableMeta
      .findUnique({
        where: { id: tableId, deletedTime: null },
        select: { name: true },
      })
      .catch(() => {
        throw new BadRequestException('table is not found');
      });

    const fieldRaws = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null, hasError: null },
      select: {
        id: true,
        type: true,
      },
    });

    if (projection?.length) {
      const inplaceFieldIds = Object.keys(sourceColumnMap);
      const noUpdateFields = difference(projection, inplaceFieldIds);
      if (noUpdateFields.length !== 0) {
        const tips = noUpdateFields.join(',');
        throw new ForbiddenException(`There is no permission to update there field ${tips}`);
      }
    }

    if (!tableRaw || !fieldRaws) {
      return;
    }

    const importer = importerFactory(fileType, {
      url: attachmentUrl,
      type: fileType,
      maxRowCount,
    });

    this.importRecords(
      baseId,
      { id: tableId, name: tableRaw.name },
      userId,
      importer,
      { skipFirstNLines: excludeFirstRow ? 1 : 0, sheetKey: sourceWorkSheetKey, notification },
      {
        sourceColumnMap,
        fields: fieldRaws as { id: string; type: FieldType }[],
      }
    );
  }

  private importRecords(
    baseId: string,
    table: { id: string; name: string },
    userId: string,
    importer: CsvImporter | ExcelImporter,
    options: { skipFirstNLines: number; sheetKey: string; notification: boolean },
    recordsCal: {
      columnInfo?: IImportColumn[];
      fields: { id: string; type: FieldType }[];
      sourceColumnMap?: Record<string, number | null>;
    }
  ) {
    const { sheetKey, notification } = options;
    const { columnInfo, fields, sourceColumnMap } = recordsCal;
    const localPresence = this.createImportPresence(table.id);
    this.setImportStatus(localPresence, true);

    const workerId = `worker_${getRandomString(8)}`;
    const path = getWorkerPath('parse');

    const worker = new Worker(path, {
      workerData: {
        config: importer.getConfig(),
        options: {
          key: options.sheetKey,
          notification: options.notification,
          skipFirstNLines: options.skipFirstNLines,
        },
        id: workerId,
      },
    });
    // record count for error notification
    let recordCount = 1;
    worker.on('message', async (result) => {
      const { type, data, chunkId, id } = result;
      switch (type) {
        case 'chunk': {
          this.setImportStatus(localPresence, true);
          const currentResult = (data as Record<string, unknown[][]>)[sheetKey];
          // fill data
          const records = currentResult.map((row) => {
            const res: { fields: Record<string, unknown> } = {
              fields: {},
            };
            // import new table
            if (columnInfo) {
              columnInfo.forEach((col, index) => {
                const { sourceColumnIndex } = col;
                // empty row will be return void row value
                const value = Array.isArray(row) ? row[sourceColumnIndex] : null;
                res.fields[fields[index].id] = value?.toString();
              });
            }
            // inplace records
            if (sourceColumnMap) {
              for (const [key, value] of Object.entries(sourceColumnMap)) {
                if (value !== null) {
                  const { type } = fields.find((f) => f.id === key) || {};
                  // link value should be string
                  res.fields[key] = type === FieldType.Link ? toString(row[value]) : row[value];
                }
              }
            }
            return res;
          });
          recordCount += records.length;
          if (records.length === 0) {
            return;
          }
          try {
            const createFn = columnInfo
              ? this.recordOpenApiService.createRecordsOnlySql.bind(this.recordOpenApiService)
              : this.recordOpenApiService.multipleCreateRecords.bind(this.recordOpenApiService);
            workerId === id &&
              (await createFn(table.id, {
                fieldKeyType: FieldKeyType.Id,
                typecast: true,
                records,
              }));
            worker.postMessage({ type: 'done', chunkId });
            this.updateRowCount(table.id);
          } catch (e) {
            const error = e as Error;
            this.logger.error(error?.message, error?.stack);
            notification &&
              this.notificationService.sendImportResultNotify({
                baseId,
                tableId: table.id,
                toUserId: userId,
                message: `❌ ${table.name} import aborted: ${error.message} fail row range: [${recordCount - records.length}, ${recordCount - 1}]. Please check the data for this range and retry.
                `,
              });
            worker.terminate();
            throw e;
          }
          break;
        }
        case 'finished':
          workerId === id &&
            notification &&
            this.notificationService.sendImportResultNotify({
              baseId,
              tableId: table.id,
              toUserId: userId,
              message: `🎉 ${table.name} ${sourceColumnMap ? 'inplace' : ''} imported successfully`,
            });
          worker.terminate();
          break;
        case 'error':
          workerId === id &&
            notification &&
            this.notificationService.sendImportResultNotify({
              baseId,
              tableId: table.id,
              toUserId: userId,
              message: `❌ ${table.name} import failed: ${data}`,
            });
          worker.terminate();
          break;
      }
    });
    worker.on('error', (e) => {
      notification &&
        this.notificationService.sendImportResultNotify({
          baseId,
          tableId: table.id,
          toUserId: userId,
          message: `❌ ${table.name} import failed: ${e.message}`,
        });
      worker.terminate();
    });
    worker.on('exit', (code) => {
      this.logger.log(`Worker stopped with exit code ${code}`);
      this.setImportStatus(localPresence, false);
    });
  }

  private updateRowCount(tableId: string) {
    const channel = getActionTriggerChannel(tableId);
    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(tableId);
    localPresence.submit(['addRecord'], (error) => {
      error && this.logger.error(error);
    });

    const updateEmptyOps = {
      src: 'unknown',
      seq: 1,
      m: {
        ts: Date.now(),
      },
      create: {
        type: 'json0',
        data: undefined,
      },
      v: 0,
    } as CreateOp;
    this.shareDbService.publishRecordChannel(tableId, updateEmptyOps);
  }

  private setImportStatus(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    presence: LocalPresence<any>,
    loading: boolean
  ) {
    presence.submit(
      {
        loading,
      },
      (error) => {
        error && this.logger.error(error);
      }
    );
  }

  private createImportPresence(tableId: string) {
    const channel = getTableImportChannel(tableId);
    const presence = this.shareDbService.connect().getPresence(channel);
    return presence.create(channel);
  }
}
