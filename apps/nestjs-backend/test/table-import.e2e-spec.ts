import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import { FieldType, defaultDatetimeFormatting } from '@teable/core';
import type { IInplaceImportOptionRo } from '@teable/openapi';
import {
  getSignature as apiGetSignature,
  uploadFile as apiUploadFile,
  notify as apiNotify,
  analyzeFile as apiAnalyzeFile,
  importTableFromFile as apiImportTableFromFile,
  createBase as apiCreateBase,
  createSpace as apiCreateSpace,
  deleteBase as apiDeleteBase,
  createTable as apiCreateTable,
  inplaceImportTableFromFile as apiInplaceImportTableFromFile,
  SUPPORTEDTYPE,
  UploadType,
} from '@teable/openapi';
import * as XLSX from 'xlsx';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { CsvImporter } from '../src/features/import/open-api/import.class';

import { initApp, permanentDeleteTable, getTable as apiGetTableById } from './utils/init-app';

enum TestFileFormat {
  'CSV' = 'csv',
  'TSV' = 'tsv',
  'TXT' = 'txt',
  'XLSX' = 'xlsx',
}

const defaultTestSheetKey = 'Sheet1';

const testSupportTypeMap = {
  [TestFileFormat.CSV]: {
    fileType: SUPPORTEDTYPE.CSV,
    defaultSheetKey: CsvImporter.DEFAULT_SHEETKEY,
  },
  [TestFileFormat.TSV]: {
    fileType: SUPPORTEDTYPE.CSV,
    defaultSheetKey: CsvImporter.DEFAULT_SHEETKEY,
  },
  [TestFileFormat.TXT]: {
    fileType: SUPPORTEDTYPE.CSV,
    defaultSheetKey: CsvImporter.DEFAULT_SHEETKEY,
  },
  [TestFileFormat.XLSX]: {
    fileType: SUPPORTEDTYPE.EXCEL,
    defaultSheetKey: defaultTestSheetKey,
  },
};

const testFileFormats = [
  TestFileFormat.CSV,
  TestFileFormat.TSV,
  TestFileFormat.TXT,
  TestFileFormat.XLSX,
];

interface ITestFile {
  [key: string]: {
    path: string;
    url: string;
  };
}
const data = `field_1,field_2,field_3,field_4,field_5,field_6
1,string_1,true,2022-11-10 16:00:00,,"long
text"
2,string_2,false,2022-11-11 16:00:00,,`;
const tsvData = `field_1	field_2	field_3	field_4	field_5	field_6
1	string_1	true	2022-11-10 16:00:00		"long\ntext"
2	string_2	false	2022-11-11 16:00:00		`;
const workbook = XLSX.utils.book_new();

const worksheet = XLSX.utils.aoa_to_sheet([
  ['field_1', 'field_2', 'field_3', 'field_4', 'field_5', 'field_6'],
  [1, 'string_1', true, '2022-11-10 16:00:00', '', `long\ntext`],
  [2, 'string_2', false, '2022-11-11 16:00:00', '', ''],
]);

XLSX.utils.book_append_sheet(workbook, worksheet, defaultTestSheetKey);

let app: INestApplication;
let testFiles: ITestFile = {};
const genTestFiles = async () => {
  const result: ITestFile = {};
  const fileDataMap = {
    [TestFileFormat.CSV]: data,
    [TestFileFormat.TSV]: tsvData,
    [TestFileFormat.TXT]: data,
    [TestFileFormat.XLSX]: await XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  };
  const contentTypeMap = {
    [TestFileFormat.CSV]: 'text/csv',
    [TestFileFormat.TSV]: 'text/tab-separated-values',
    [TestFileFormat.TXT]: 'text/plain',
    [TestFileFormat.XLSX]: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  for (let i = 0; i < testFileFormats.length; i++) {
    const format = testFileFormats[i];
    const tmpPath = path.resolve(path.join(StorageAdapter.TEMPORARY_DIR, `test.${format}`));
    const data = fileDataMap[format];
    const contentType = contentTypeMap[format];

    fs.writeFileSync(tmpPath, data);

    const file = fs.createReadStream(tmpPath);
    const stats = fs.statSync(tmpPath);

    const { token, requestHeaders } = (
      await apiGetSignature(
        {
          type: UploadType.Import,
          contentLength: stats.size,
          contentType: contentType,
        },
        undefined
      )
    ).data;

    await apiUploadFile(token, file, requestHeaders);

    const {
      data: { presignedUrl },
    } = await apiNotify(token, undefined, 'Import Table.csv');

    result[format] = {
      path: tmpPath,
      url: presignedUrl,
    };
  }
  return result;
};

const assertHeaders = [
  {
    type: 'number',
    name: 'field_1',
  },
  {
    type: 'singleLineText',
    name: 'field_2',
  },
  {
    type: 'checkbox',
    name: 'field_3',
  },
  {
    type: 'date',
    name: 'field_4',
  },
  {
    type: 'singleLineText',
    name: 'field_5',
  },
  {
    type: 'longText',
    name: 'field_6',
  },
];

describe('OpenAPI ImportController (e2e)', () => {
  const bases: [string, string][] = [];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    testFiles = await genTestFiles();
  });

  afterAll(async () => {
    testFileFormats.forEach((type) => {
      fs.unlink(testFiles[type].path, (err) => {
        if (err) throw err;
        console.log(`delete ${type} test file success!`);
      });
    });
    for (let i = 0; i < bases.length; i++) {
      const [baseId, id] = bases[i];
      await permanentDeleteTable(baseId, id);
      await apiDeleteBase(baseId);
    }
    await app.close();
  });

  describe('/import/analyze OpenAPI ImportController (e2e) Get a column info from analyze sheet (Get) ', () => {
    it(`should return column header info from csv file`, async () => {
      const {
        data: { worksheets },
      } = await apiAnalyzeFile({
        attachmentUrl: testFiles[TestFileFormat.CSV].url,
        fileType: SUPPORTEDTYPE.CSV,
      });
      const calculatedColumnHeaders = worksheets[CsvImporter.DEFAULT_SHEETKEY].columns;
      expect(calculatedColumnHeaders).toEqual(assertHeaders);
    });

    it(`should return 400, when url file type is not csv`, async () => {
      await expect(
        apiAnalyzeFile({
          attachmentUrl: testFiles[TestFileFormat.TXT].url,
          fileType: SUPPORTEDTYPE.CSV,
        })
      ).rejects.toMatchObject({
        status: 400,
        code: 'validation_error',
      });
    });

    it(`should return column header info from excel file`, async () => {
      const {
        data: { worksheets },
      } = await apiAnalyzeFile({
        attachmentUrl: testFiles[TestFileFormat.XLSX].url,
        fileType: SUPPORTEDTYPE.EXCEL,
      });
      const calculatedColumnHeaders = worksheets['Sheet1'].columns;
      expect(calculatedColumnHeaders).toEqual(assertHeaders);
    });
  });

  describe('/import/{baseId} OpenAPI ImportController (e2e) (Post)', () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it.each(testFileFormats.filter((format) => format !== TestFileFormat.TXT))(
      'should create a new Table from %s file',
      async (format) => {
        const spaceRes = await apiCreateSpace({ name: `test${format}` });
        const spaceId = spaceRes?.data?.id;
        const baseRes = await apiCreateBase({ spaceId });
        const baseId = baseRes.data.id;

        const fileType = testSupportTypeMap[format].fileType;
        const attachmentUrl = testFiles[format].url;
        const defaultSheetKey = testSupportTypeMap[format].defaultSheetKey;

        const {
          data: { worksheets },
        } = await apiAnalyzeFile({
          attachmentUrl,
          fileType,
        });
        const calculatedColumnHeaders = worksheets[defaultSheetKey].columns;

        const table = await apiImportTableFromFile(baseId, {
          attachmentUrl,
          fileType,
          worksheets: {
            [defaultSheetKey]: {
              name: defaultSheetKey,
              columns: calculatedColumnHeaders.map((column, index) => ({
                ...column,
                sourceColumnIndex: index,
              })),
              useFirstRowAsHeader: true,
              importData: true,
            },
          },
          tz: 'Asia/Shanghai',
        });

        const { fields, id } = table.data[0];

        const createdFields = fields.map((field) => ({
          type: field.type,
          name: field.name,
        }));

        await delay(1000);

        const { records } = await apiGetTableById(baseId, table.data[0].id, {
          includeContent: true,
        });

        bases.push([baseId, id]);

        expect(records?.length).toBe(2);
        expect(createdFields).toEqual(assertHeaders);
      }
    );
  });

  describe('/import/{baseId}/{tableId} OpenAPI ImportController (e2e) (Patch)', () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it('should import data into Table from file', async () => {
      const spaceRes = await apiCreateSpace({ name: 'test1' });
      const spaceId = spaceRes?.data?.id;
      const baseRes = await apiCreateBase({ spaceId });
      const baseId = baseRes.data.id;

      const format = SUPPORTEDTYPE.CSV;
      const attachmentUrl = testFiles[format].url;
      const fileType = testSupportTypeMap[format].fileType;

      // create a table
      const tableRes = await apiCreateTable(baseId, {
        fields: [
          {
            type: FieldType.Number,
            name: 'field_1',
          },
          {
            type: FieldType.SingleLineText,
            name: 'field_2',
          },
          {
            type: FieldType.Checkbox,
            name: 'field_3',
          },
          {
            type: FieldType.Date,
            name: 'field_4',
            options: {
              formatting: {
                ...defaultDatetimeFormatting,
                time: 'HH:mm',
              },
            },
          },
          {
            type: FieldType.SingleLineText,
            name: 'field_5',
          },
          {
            type: FieldType.LongText,
            name: 'field_6',
          },
        ],
        records: [],
      });
      const tableId = tableRes.data.id;
      const fields = tableRes?.data?.fields;
      const sourceColumnMap: IInplaceImportOptionRo['insertConfig']['sourceColumnMap'] = {};
      fields.forEach((field, index) => {
        sourceColumnMap[field.id] = index;
      });

      // import data into table
      await apiInplaceImportTableFromFile(baseId, tableId, {
        attachmentUrl,
        fileType,
        insertConfig: {
          sourceWorkSheetKey: CsvImporter.DEFAULT_SHEETKEY,
          excludeFirstRow: true,
          sourceColumnMap,
        },
      });

      await delay(1000);

      const { records } = await apiGetTableById(baseId, tableId, {
        includeContent: true,
      });

      bases.push([baseId, tableId]);

      const tableRecords = records?.map((r) => {
        const newFields = { ...r.fields };
        if (newFields['field_4']) {
          newFields['field_4'] = +new Date(newFields['field_4'] as string);
        }
        return newFields;
      });

      const assertRecords = [
        {
          field_1: 1,
          field_2: 'string_1',
          field_3: true,
          field_4: +new Date(new Date('2022-11-10 16:00:00').toUTCString()),
          field_6: 'long\ntext',
        },
        {
          field_1: 2,
          field_2: 'string_2',
          field_4: +new Date(new Date('2022-11-11 16:00:00').toUTCString()),
        },
      ];

      expect(records?.length).toBe(2);
      expect(tableRecords).toEqual(assertRecords);
    });
  });
});
