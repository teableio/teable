import fs from 'fs';
import type { INestApplication } from '@nestjs/common';
import { SUPPORTEDTYPE } from '@teable/core';
import {
  getSignature as apiGetSignature,
  uploadFile as apiUploadFile,
  notify as apiNotify,
  analyzeFile as apiAnalyzeFile,
  importTableFromFile as apiImportTableFromFile,
  getTableById as apiGetTableById,
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
const defaultTestSheetKey = 'Sheet1';
const workbook = XLSX.utils.book_new();

const worksheet = XLSX.utils.aoa_to_sheet([
  ['field_1', 'field_2', 'field_3', 'field_4', 'field_5', 'field_6'],
  [1, 'string_1', true, '2022-11-10 16:00:00', '', `long\ntext`],
  [2, 'string_2', false, '2022-11-11 16:00:00', '', ''],
]);

XLSX.utils.book_append_sheet(workbook, worksheet, defaultTestSheetKey);

let app: INestApplication;
let testFiles: ITestFile = {};
const baseId = globalThis.testConfig.baseId;
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
    const path = `test.${format}`;
    const data = fileDataMap[format];
    const contentType = contentTypeMap[format];

    fs.writeFileSync(path, data);

    const file = fs.readFileSync(path);
    const stats = fs.statSync(path);

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
      path: `test.${format}`,
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

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
  testFiles = await genTestFiles();
});

afterAll(async () => {
  await app.close();
  testFileFormats.forEach((type) => {
    fs.unlink(testFiles[type].path, (err) => {
      if (err) throw err;
      console.log(`delete ${type} test file success!`);
    });
  });
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
  const tableIds: string[] = [];
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  afterAll(async () => {
    tableIds.forEach((tableId) => {
      deleteTable(baseId, tableId);
    });
  });
  // TODO fix sqlite error, cancel tmp delay
  it(`should create a new Table from csv/tsv/excel file`, async () => {
    const {
      data: { worksheets },
    } = await apiAnalyzeFile({
      attachmentUrl: testFiles[TestFileFormat.CSV].url,
      fileType: SUPPORTEDTYPE.CSV,
    });
    const calculatedColumnHeaders = worksheets[CsvImporter.DEFAULT_SHEETKEY].columns;

    const table = await apiImportTableFromFile(baseId, {
      attachmentUrl: testFiles[TestFileFormat.CSV].url,
      fileType: SUPPORTEDTYPE.CSV,
      worksheets: {
        [CsvImporter.DEFAULT_SHEETKEY]: {
          name: CsvImporter.DEFAULT_SHEETKEY,
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
    tableIds.push(id);

    const createdFields = fields.map((field) => ({
      type: field.type,
      name: field.name,
    }));

    const res = await apiGetTableById(baseId, table.data[0].id, {
      includeContent: true,
    });

    expect(createdFields).toEqual(assertHeaders);
    expect(res).toMatchObject({
      status: 200,
      statusText: 'OK',
    });

    await delay(1000);

    const {
      data: { worksheets: worksheets1 },
    } = await apiAnalyzeFile({
      attachmentUrl: testFiles[TestFileFormat.XLSX].url,
      fileType: SUPPORTEDTYPE.EXCEL,
    });
    const calculatedColumnHeaders1 = worksheets1[defaultTestSheetKey].columns;

    const table1 = await apiImportTableFromFile(baseId, {
      attachmentUrl: testFiles[TestFileFormat.XLSX].url,
      fileType: SUPPORTEDTYPE.EXCEL,
      worksheets: {
        [defaultTestSheetKey]: {
          name: defaultTestSheetKey,
          columns: calculatedColumnHeaders1.map((column, index) => ({
            ...column,
            sourceColumnIndex: index,
          })),
          useFirstRowAsHeader: true,
          importData: true,
        },
      },
    });

    const { fields: fields1, id: id1 } = table1.data[0];
    tableIds.push(id1);

    const createdFields1 = fields1.map((field) => ({
      type: field.type,
      name: field.name,
    }));

    const res1 = await apiGetTableById(baseId, table1.data[0].id, {
      includeContent: true,
    });

    expect(createdFields1).toEqual(assertHeaders);
    expect(res1).toMatchObject({
      status: 200,
      statusText: 'OK',
    });

    await delay(1000);

    const {
      data: { worksheets: worksheet2 },
    } = await apiAnalyzeFile({
      attachmentUrl: testFiles[TestFileFormat.TSV].url,
      fileType: SUPPORTEDTYPE.CSV,
    });
    const calculatedColumnHeaders2 = worksheet2[CsvImporter.DEFAULT_SHEETKEY].columns;

    const table2 = await apiImportTableFromFile(baseId, {
      attachmentUrl: testFiles[TestFileFormat.TSV].url,
      fileType: SUPPORTEDTYPE.CSV,
      worksheets: {
        [CsvImporter.DEFAULT_SHEETKEY]: {
          name: defaultTestSheetKey,
          columns: calculatedColumnHeaders2.map((column, index) => ({
            ...column,
            sourceColumnIndex: index,
          })),
          useFirstRowAsHeader: true,
          importData: true,
        },
      },
    });

    const { fields: fields2, id: id2 } = table2.data[0];
    tableIds.push(id2);

    const createdFields2 = fields2.map((field) => ({
      type: field.type,
      name: field.name,
    }));

    const res2 = await apiGetTableById(baseId, table2.data[0].id, {
      includeContent: true,
    });

    expect(createdFields2).toEqual(assertHeaders);
    expect(res2).toMatchObject({
      status: 200,
      statusText: 'OK',
    });
  });
});
