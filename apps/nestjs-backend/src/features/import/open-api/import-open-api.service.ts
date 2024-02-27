import { Injectable } from '@nestjs/common';

import { FieldKeyType, importerFactory } from '@teable/core';
import type { IAnalyzeRo, IImportOptionRo, ICreateRecordsVo } from '@teable/core';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { DEFAULT_VIEWS } from '../../table/constant';
import { TableOpenApiService } from '../../table/open-api/table-open-api.service';

@Injectable()
export class ImportOpenApiService {
  // private logger = new Logger(ImportOpenApiService.name);
  constructor(
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly recordOpenApiService: RecordOpenApiService
  ) {}

  async analyze(analyzeRo: IAnalyzeRo) {
    const { attachmentUrl, fileType } = analyzeRo;
    const importer = importerFactory(fileType, {
      url: attachmentUrl,
    });

    return await importer.generateColumnInfo();
  }

  async createTableFromImport(baseId: string, importRo: IImportOptionRo) {
    const {
      options: { importData, useFirstRowAsHeader },
      attachmentUrl,
      fileType,
      columnInfo,
    } = importRo;
    const importer = importerFactory(fileType, {
      url: attachmentUrl,
    });
    const fieldsRo = columnInfo.map((col, index) => {
      return {
        ...col,
        isPrimary: index === 0 ? true : null,
      };
    });

    // create table with column
    const table = await this.tableOpenApiService.createTable(baseId, {
      name: 'import table',
      fields: fieldsRo,
      views: DEFAULT_VIEWS,
      records: [],
    });
    const { fields } = table;

    const insertPromiseList: Array<() => Promise<ICreateRecordsVo>> = [];

    if (importData) {
      await importer.streamParse(
        {
          skipFirstNLines: useFirstRowAsHeader ? 1 : 0,
        },
        async (result) => {
          // fill data
          const records = result.map((row) => {
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
          insertPromiseList.push(() =>
            this.recordOpenApiService.multipleCreateRecords(table.id, {
              fieldKeyType: FieldKeyType.Id,
              typecast: true,
              records,
            })
          );
        }
      );

      for (let i = 0; i < insertPromiseList.length; i++) {
        await insertPromiseList[i]();
      }
    }

    return table;
  }
}
