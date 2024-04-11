import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IAnalyzeRo,
  IImportOptionRo,
  IInplaceImportOptionRo,
  ITableFullVo,
  IImportColumn,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { NotificationService } from '../../notification/notification.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { DEFAULT_VIEWS } from '../../table/constant';
import { TableOpenApiService } from '../../table/open-api/table-open-api.service';
import { importerFactory } from './import.class';
import type { CsvImporter, ExcelImporter } from './import.class';

@Injectable()
export class ImportOpenApiService {
  private logger = new Logger(ImportOpenApiService.name);
  constructor(
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly notificationService: NotificationService
  ) {}

  async analyze(analyzeRo: IAnalyzeRo) {
    const { attachmentUrl, fileType } = analyzeRo;

    const importer = importerFactory(fileType, {
      url: attachmentUrl,
      type: fileType,
    });

    return await importer.genColumns();
  }

  async createTableFromImport(baseId: string, importRo: IImportOptionRo) {
    const userId = this.cls.get('user.id');
    const { attachmentUrl, fileType, worksheets, notification = false } = importRo;

    const importer = importerFactory(fileType, {
      url: attachmentUrl,
      type: fileType,
    });

    const tableResult = [];

    for (const [sheetKey, value] of Object.entries(worksheets)) {
      const { importData, useFirstRowAsHeader, columns: columnInfo, name } = value;
      const fieldsRo = columnInfo.map((col, index) => {
        return {
          ...col,
          isPrimary: index === 0 ? true : null,
        };
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

      importData &&
        this.importRecords(
          baseId,
          table,
          userId,
          importer,
          { skipFirstNLines: useFirstRowAsHeader ? 1 : 0, sheetKey, notification },
          {
            columnInfo,
            fields,
          }
        );
    }
    return tableResult;
  }

  async inplaceImportTable(
    baseId: string,
    tableId: string,
    inplaceImportRo: IInplaceImportOptionRo
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

    if (!tableRaw) {
      return;
    }

    const importer = importerFactory(fileType, {
      url: attachmentUrl,
      type: fileType,
    });

    this.importRecords(
      baseId,
      { id: tableId, name: tableRaw.name },
      userId,
      importer,
      { skipFirstNLines: excludeFirstRow ? 1 : 0, sheetKey: sourceWorkSheetKey, notification },
      {
        sourceColumnMap,
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
      fields?: ITableFullVo['fields'];
      sourceColumnMap?: Record<string, number | null>;
    }
  ) {
    const { skipFirstNLines, sheetKey, notification } = options;
    const { columnInfo, fields, sourceColumnMap } = recordsCal;
    importer.parse(
      {
        skipFirstNLines,
        key: sheetKey,
      },
      async (result) => {
        const currentResult = result[sheetKey];
        // fill data
        const records = currentResult.map((row) => {
          const res: { fields: Record<string, unknown> } = {
            fields: {},
          };
          // import new table
          if (columnInfo && fields) {
            columnInfo.forEach((col, index) => {
              res.fields[fields[index].id] = row[col.sourceColumnIndex];
            });
          }
          // inplace records
          if (sourceColumnMap) {
            for (const [key, value] of Object.entries(sourceColumnMap)) {
              if (value !== null) {
                res.fields[key] = row[value];
              }
            }
          }
          return res;
        });
        if (records.length === 0) {
          return;
        }
        try {
          await this.recordOpenApiService.multipleCreateRecords(table.id, {
            fieldKeyType: FieldKeyType.Id,
            typecast: true,
            records,
          });
        } catch (e) {
          this.logger.error((e as Error)?.message, (e as Error)?.stack);
          throw e;
        }
      },
      () => {
        notification &&
          this.notificationService.sendImportResultNotify({
            baseId,
            tableId: table.id,
            toUserId: userId,
            message: `<em>${table.name}</em> import successfully🎉`,
          });
      },
      (error) => {
        notification &&
          this.notificationService.sendImportResultNotify({
            baseId,
            tableId: table.id,
            toUserId: userId,
            message: `<em>${table.name}</em> import abort: \n <code>${error}</code>`,
          });
      }
    );
  }
}
