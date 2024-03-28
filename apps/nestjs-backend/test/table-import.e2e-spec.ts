import fs from 'fs';
import os from 'node:os';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { IInplaceImportOptionRo } from '@teable/openapi';
import {
  getSignature as apiGetSignature,
  uploadFile as apiUploadFile,
  notify as apiNotify,
  analyzeFile as apiAnalyzeFile,
  importTableFromFile as apiImportTableFromFile,
  getTableById as apiGetTableById,
  createBase as apiCreateBase,
  createSpace as apiCreateSpace,
  deleteBase as apiDeleteBase,
  createTable as apiCreateTable,
  inplaceImportTableFromFile as apiInplaceImportTableFromFile,
  SUPPORTEDTYPE,
} from '@teable/openapi';
import * as XLSX from 'xlsx';
import { CsvImporter } from '../src/features/import/open-api/import.class';

import { initApp, deleteTable } from './utils/init-app';

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
  const tmpDir = os.tmpdir();
  for (let i = 0; i < testFileFormats.length; i++) {
    const format = testFileFormats[i];
    const tmpPath = path.resolve(path.join(tmpDir, `test.${format}`));
    const data = fileDataMap[format];
    const contentType = contentTypeMap[format];

    fs.writeFileSync(tmpPath, data);

    const file = fs.readFileSync(tmpPath);
    const stats = fs.statSync(tmpPath);

    const { token, requestHeaders } = (
      await apiGetSignature(
        {
          type: 1,
          contentLength: stats.size,
          contentType: contentType,
        },
        undefined
      )
    ).data;

    await apiUploadFile(token, file, requestHeaders);

    const {
      data: { presignedUrl },
    } = await apiNotify(token);

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
    await deleteTable(baseId, id);
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
      });

      const { fields, id } = table.data[0];

      const createdFields = fields.map((field) => ({
        type: field.type,
        name: field.name,
      }));

      const res = await apiGetTableById(baseId, table.data[0].id, {
        includeContent: true,
      });

      bases.push([baseId, id]);

      expect(createdFields).toEqual(assertHeaders);
      expect(res).toMatchObject({
        status: 200,
        statusText: 'OK',
      });
    }
  );
});

describe('/import/{tableId} OpenAPI ImportController (e2e) (Patch)', () => {
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
    });
    const tableId = tableRes.data.id;
    const fields = tableRes?.data?.fields;
    const sourceColumnMap: IInplaceImportOptionRo['insertConfig']['sourceColumnMap'] = {};
    fields.forEach((field, index) => {
      sourceColumnMap[field.id] = index;
    });

    // import data into table
    await apiInplaceImportTableFromFile(tableId, {
      attachmentUrl,
      fileType,
      insertConfig: {
        sourceWorkSheetKey: CsvImporter.DEFAULT_SHEETKEY,
        excludeFirstRow: true,
        sourceColumnMap,
      },
    });

    await delay(1000);

    const {
      data: { records },
    } = await apiGetTableById(baseId, tableId, {
      includeContent: true,
    });

    bases.push([baseId, tableId]);

    expect(records?.length).toBe(5);
  });
});
