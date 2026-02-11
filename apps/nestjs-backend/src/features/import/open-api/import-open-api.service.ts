import { Injectable, Logger, Optional } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import {
  FieldType,
  generateLogId,
  getRandomString,
  HttpErrorCode,
  TimeFormatting,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IAnalyzeRo,
  IImportOptionRo,
  IInplaceImportOptionRo,
  ITableFullVo,
} from '@teable/openapi';
import { chunk, difference } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { IClsStore } from '../../../types/cls';
import { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import { NotificationService } from '../../notification/notification.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { DEFAULT_VIEWS, DEFAULT_FIELDS } from '../../table/constant';
import { TableOpenApiService } from '../../table/open-api/table-open-api.service';
import { ImportMetricsService } from '../metrics/import-metrics.service';
import {
  ImportTableCsvChunkQueueProcessor,
  TABLE_IMPORT_CSV_CHUNK_QUEUE,
} from './import-csv-chunk.processor';
import { importerFactory } from './import.class';

const maxFieldsLength = 500;
const maxFieldsChunkSize = 30;

@Injectable()
export class ImportOpenApiService {
  private logger = new Logger(ImportOpenApiService.name);
  constructor(
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly notificationService: NotificationService,
    private readonly shareDbService: ShareDbService,
    private readonly importTableCsvChunkQueueProcessor: ImportTableCsvChunkQueueProcessor,
    private readonly fieldOpenApiService: FieldOpenApiService,
    @Optional() private readonly importMetrics?: ImportMetricsService
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
    const origin = this.cls.get('origin');
    const { worksheets, notification = false, tz, fileType, attachmentUrl } = importRo;

    this.importMetrics?.recordImportQueued({ fileType, operationType: 'create_table' });

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
              time: TimeFormatting.None,
            },
          };
        }

        return result;
      });

      let table: ITableFullVo;

      try {
        table = await this.createSingleTable(baseId, name, fieldsRo);
        tableResult.push(table);
      } catch (e) {
        this.logger.error(e);
        throw e;
      }

      const { fields } = table;

      const jobId = `${ImportTableCsvChunkQueueProcessor.JOB_ID_PREFIX}:${table.id}:${getRandomString(6)}`;

      const logId = generateLogId();

      if (importData && columns.length) {
        await this.importTableCsvChunkQueueProcessor.queue.add(
          `${TABLE_IMPORT_CSV_CHUNK_QUEUE}_job`,
          {
            baseId,
            table: {
              id: table.id,
              name: table.name,
            },
            userId,
            origin,
            importerParams: {
              attachmentUrl,
              fileType,
              maxRowCount,
            },
            options: {
              skipFirstNLines: useFirstRowAsHeader ? 1 : 0,
              sheetKey,
              notification,
            },
            recordsCal: {
              fields: fields.map((f) => ({ id: f.id, type: f.type })),
              columnInfo: columns,
            },
            ro: importRo,
            logId,
          },
          {
            jobId,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          }
        );
      }
    }
    return tableResult;
  }

  async createSingleTable(baseId: string, name: string, fieldsRo: IFieldRo[]) {
    const length = fieldsRo.length;

    if (length > maxFieldsLength) {
      throw new CustomHttpException(
        `The number of fields in the table cannot exceed ${maxFieldsLength}, current is ${length}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.import.exceedMaxFieldsLength',
            context: {
              length,
              maxFieldsLength,
            },
          },
        }
      );
    }

    const chunkFields = chunk(fieldsRo, maxFieldsChunkSize) as IFieldRo[][];

    let tableId: string | undefined;

    for (const chunk of chunkFields) {
      if (!tableId) {
        const table = await this.tableOpenApiService.createTable(baseId, {
          name,
          fields: chunk,
          views: DEFAULT_VIEWS,
          records: [],
        });
        tableId = table.id;
        continue;
      }

      await this.fieldOpenApiService.createFieldsByRo(tableId, chunk);
    }

    const table = (await this.tableOpenApiService.getTable(baseId, tableId!)) as ITableFullVo;
    const fields = await this.fieldOpenApiService.getFields(tableId!, {});

    table.fields = fields;

    return table;
  }

  async inplaceImportTable(
    baseId: string,
    tableId: string,
    inplaceImportRo: IInplaceImportOptionRo,
    maxRowCount?: number,
    projection?: string[]
  ) {
    const userId = this.cls.get('user.id');
    const origin = this.cls.get('origin');
    const { attachmentUrl, fileType, insertConfig, notification = false } = inplaceImportRo;

    this.importMetrics?.recordImportQueued({ fileType, operationType: 'inplace' });

    const { sourceColumnMap, sourceWorkSheetKey, excludeFirstRow } = insertConfig;

    const tableRaw = await this.prismaService.tableMeta
      .findUnique({
        where: { id: tableId, deletedTime: null },
        select: { name: true },
      })
      .catch(() => {
        throw new CustomHttpException('Table not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.table.notFound',
          },
        });
      });

    const fieldRaws = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null, hasError: null },
      select: {
        id: true,
        type: true,
      },
    });

    if (projection) {
      const inplaceFieldIds = Object.keys(sourceColumnMap);
      const noUpdateFields = difference(inplaceFieldIds, projection);
      if (noUpdateFields.length !== 0) {
        const tips = noUpdateFields.join(',');
        throw new CustomHttpException(
          `There is no permission to update there field ${tips}`,
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
    }

    if (!tableRaw || !fieldRaws) {
      return;
    }

    const jobId = await this.generateChunkJobId(tableId);

    const logId = generateLogId();

    await this.importTableCsvChunkQueueProcessor.queue.add(
      `${TABLE_IMPORT_CSV_CHUNK_QUEUE}_job`,
      {
        baseId,
        table: {
          id: tableId,
          name: tableRaw.name,
        },
        userId,
        origin,
        importerParams: {
          attachmentUrl,
          fileType,
          maxRowCount,
        },
        options: {
          skipFirstNLines: excludeFirstRow ? 1 : 0,
          sheetKey: sourceWorkSheetKey,
          notification,
        },
        recordsCal: {
          sourceColumnMap,
          fields: fieldRaws as { id: string; type: FieldType }[],
        },
        ro: inplaceImportRo,
        logId,
      },
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      }
    );
  }

  async generateChunkJobId(tableId: string) {
    return `${ImportTableCsvChunkQueueProcessor.JOB_ID_PREFIX}:${tableId}:${getRandomString(6)}`;
  }
}
