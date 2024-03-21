import { Injectable, Logger } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import type { IAnalyzeRo, IImportOptionRo, IInplaceImportOptionRo } from '@teable/core';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { DEFAULT_VIEWS } from '../../table/constant';
import { TableOpenApiService } from '../../table/open-api/table-open-api.service';
import { importerFactory } from './import.class';

@Injectable()
export class ImportOpenApiService {
  private logger = new Logger(ImportOpenApiService.name);
  constructor(
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly recordOpenApiService: RecordOpenApiService
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
    const { attachmentUrl, fileType, worksheets } = importRo;

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

      if (importData) {
        importer.parse(
          {
            skipFirstNLines: useFirstRowAsHeader ? 1 : 0,
            key: sheetKey,
          },
          async (result) => {
            const currentResult = result[sheetKey];
            // fill data
            const records = currentResult.map((row) => {
              const res: { fields: Record<string, unknown> } = {
                fields: {},
              };
              columnInfo.forEach((col, index) => {
                res.fields[fields[index].id] = row[col.sourceColumnIndex];
              });
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
              this.logger.error((e as Error)?.message, 'Import: Records');
            }
          }
        );
      }
    }
    return tableResult;
  }

  async inplaceImportTable(tableId: string, inplaceImportRo: IInplaceImportOptionRo) {
    const { attachmentUrl, fileType, insertConfig } = inplaceImportRo;

    const { sourceColumnMap, sourceWorkSheetKey, excludeFirstRow } = insertConfig;

    const importer = importerFactory(fileType, {
      url: attachmentUrl,
      type: fileType,
    });

    importer.parse(
      {
        skipFirstNLines: excludeFirstRow ? 1 : 0,
        key: sourceWorkSheetKey,
      },
      async (result) => {
        const currentResult = result[sourceWorkSheetKey];
        if (currentResult.length === 0) {
          return;
        }
        // fill data
        const records = currentResult.map((row) => {
          const res: { fields: Record<string, unknown> } = {
            fields: {},
          };
          for (const [key, value] of Object.entries(sourceColumnMap)) {
            if (value !== null) {
              res.fields[key] = row[value];
            }
          }
          return res;
        });
        try {
          await this.recordOpenApiService.multipleCreateRecords(tableId, {
            fieldKeyType: FieldKeyType.Id,
            typecast: true,
            records,
          });
        } catch (e) {
          this.logger.error((e as Error)?.message, 'Import: Records');
        }
      }
    );
  }
}
