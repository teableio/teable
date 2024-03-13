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

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;
const csvTmpPath = 'test.csv';
const textTmpPath = 'test.txt';
const excelTmpPath = 'test.xlsx';
const data = `field_1,field_2,field_3,field_4,field_5,field_6
1,string_1,true,2022-11-10 16:00:00,,"long
text"
2,string_2,false,2022-11-11 16:00:00,,`;
const defaultTestSheetKey = 'Sheet1';
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
let csvUrl: string;
let textUrl: string;
let excelUrl: string;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;

  const workbook = XLSX.utils.book_new();

  const worksheet = XLSX.utils.aoa_to_sheet([
    ['field_1', 'field_2', 'field_3', 'field_4', 'field_5', 'field_6'],
    [1, 'string_1', true, '2022-11-10 16:00:00', '', `long\ntext`],
    [2, 'string_2', false, '2022-11-11 16:00:00', '', ''],
  ]);

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

  const excelBuffer = await XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  fs.writeFileSync(excelTmpPath, excelBuffer);

  fs.writeFileSync(csvTmpPath, data);
  const fileData = fs.readFileSync(csvTmpPath);
  const fileStats = fs.statSync(csvTmpPath);

  fs.writeFileSync(textTmpPath, data);
  const textFileData = fs.readFileSync(textTmpPath);
  const textStats = fs.statSync(textTmpPath);

  const excelFileData = fs.readFileSync(excelTmpPath);
  const excelStats = fs.statSync(excelTmpPath);

  const { token, requestHeaders } = (
    await apiGetSignature(
      {
        type: 1,
        contentLength: fileStats.size,
        contentType: 'text/csv',
      },
      undefined
    )
  ).data;

  const { token: txtToken, requestHeaders: txtRequestHeaders } = (
    await apiGetSignature(
      {
        type: 1,
        contentLength: textStats.size,
        contentType: 'text/plain',
      },
      undefined
    )
  ).data;

  const { token: excelToken, requestHeaders: excelRequestHeaders } = (
    await apiGetSignature(
      {
        type: 1,
        contentLength: excelStats.size,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      undefined
    )
  ).data;

  await apiUploadFile(token, fileData, requestHeaders);

  await apiUploadFile(txtToken, textFileData, txtRequestHeaders);

  await apiUploadFile(excelToken, excelFileData, excelRequestHeaders);

  const res = await apiNotify(token);
  const txtRes = await apiNotify(txtToken);
  const excelRes = await apiNotify(excelToken);
  csvUrl = res.data.presignedUrl;
  textUrl = txtRes.data.presignedUrl;
  excelUrl = excelRes.data.presignedUrl;
});

afterAll(async () => {
  await app.close();
  fs.unlink(csvTmpPath, (err) => {
    if (err) throw err;
    console.log('delete csv tmp file success!');
  });
  fs.unlink(textTmpPath, (err) => {
    if (err) throw err;
    console.log('delete csv tmp file success!');
  });
  fs.unlink(excelTmpPath, (err) => {
    if (err) throw err;
    console.log('delete excel tmp file success!');
  });
});

describe('/import/analyze OpenAPI ImportController (e2e) Get a column info from analyze sheet (Get) ', () => {
  it(`should return column header info from csv file`, async () => {
    const {
      data: { worksheets },
    } = await apiAnalyzeFile({
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
    });
    const calculatedColumnHeaders = worksheets[CsvImporter.DEFAULT_SHEETKEY].columns;
    expect(calculatedColumnHeaders).toEqual(assertHeaders);
  });

  it(`should return 400, when url file type is not csv`, async () => {
    await expect(
      apiAnalyzeFile({
        attachmentUrl: textUrl,
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
      attachmentUrl: excelUrl,
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
  it(`should create a new Table from csv/excel file`, async () => {
    const {
      data: { worksheets },
    } = await apiAnalyzeFile({
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
    });
    const calculatedColumnHeaders = worksheets[CsvImporter.DEFAULT_SHEETKEY].columns;

    const table = await apiImportTableFromFile(baseId, {
      attachmentUrl: csvUrl,
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

    await delay(0);

    const {
      data: { worksheets: worksheets1 },
    } = await apiAnalyzeFile({
      attachmentUrl: excelUrl,
      fileType: SUPPORTEDTYPE.EXCEL,
    });
    const calculatedColumnHeaders1 = worksheets1[defaultTestSheetKey].columns;

    const table1 = await apiImportTableFromFile(baseId, {
      attachmentUrl: excelUrl,
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
  });
});
