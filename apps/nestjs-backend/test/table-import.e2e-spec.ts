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

import { initApp, deleteTable } from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;
const csvTmpPath = 'test.csv';
const data = `field_1,field_2,field_3,field_4
1,string_1,true,2022-11-11
2,string_2,false,2022-11-12`;
let csvUrl: string;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
  fs.writeFileSync(csvTmpPath, data);
  const fileData = fs.readFileSync(csvTmpPath);
  const fileStats = fs.statSync(csvTmpPath);

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

  await apiUploadFile(token, fileData, requestHeaders);

  const res = await apiNotify(token);
  csvUrl = res.data.presignedUrl;
});

afterAll(async () => {
  await app.close();
  fs.unlink(csvTmpPath, (err) => {
    if (err) throw err;
    console.log('delete csv tmp file success!');
  });
});

describe('/import/analyze OpenAPI ImportController (e2e) Get a column info from analyze sheet (Get) ', () => {
  it(`should return column header info from csv file`, async () => {
    const {
      data: { calculatedColumnHeaders },
    } = await apiAnalyzeFile({
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
    });
    const assertHeaders = [
      {
        type: 'number',
        name: 'field_1',
      },
      {
        type: 'longText',
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
    ];
    expect(calculatedColumnHeaders).toEqual(assertHeaders);
  });
});

describe('/import/{baseId} OpenAPI ImportController (e2e) (Post)', () => {
  const tableIds: string[] = [];
  afterAll(async () => {
    tableIds.forEach((tableId) => {
      deleteTable(baseId, tableId);
    });
  });

  it(`should create a new Table from csv file`, async () => {
    const {
      data: { calculatedColumnHeaders },
    } = await apiAnalyzeFile({
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
    });

    const table = await apiImportTableFromFile(baseId, {
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
      columnInfo: calculatedColumnHeaders.map((column, index) => ({
        ...column,
        sourceColumnIndex: index,
      })),
      options: {
        useFirstRowAsHeader: true,
        importData: true,
      },
    });

    const { fields, id } = table.data;

    const createdFields = fields.map((field) => ({
      type: field.type,
      name: field.name,
    }));
    const assertHeaders = [
      {
        type: 'number',
        name: 'field_1',
      },
      {
        type: 'longText',
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
    ];

    const {
      data: { records },
    } = await apiGetTableById(baseId, table.data.id, {
      includeContent: true,
    });
    tableIds.push(id);
    const filledRecords = records?.map((rec) => ({ ...rec.fields }));
    const assertRecords = [
      {
        field_1: 1,
        field_2: 'string_1',
        field_3: true,
        field_4: '2022-11-10T16:00:00.000Z',
      },
      {
        field_1: 2,
        field_2: 'string_2',
        field_4: '2022-11-11T16:00:00.000Z',
      },
    ];
    expect(createdFields).toEqual(assertHeaders);
    expect(records?.length).toBe(2);
    expect(filledRecords).toEqual(assertRecords);
  });

  it(`should create a new Table from csv file only fields without data`, async () => {
    const {
      data: { calculatedColumnHeaders },
    } = await apiAnalyzeFile({
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
    });

    const table = await apiImportTableFromFile(baseId, {
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
      columnInfo: calculatedColumnHeaders.map((column, index) => ({
        ...column,
        sourceColumnIndex: index,
      })),
      options: {
        useFirstRowAsHeader: true,
        importData: false,
      },
    });

    const { fields, id } = table.data;

    const createdFields = fields.map((field) => ({
      type: field.type,
      name: field.name,
    }));
    const assertHeaders = [
      {
        type: 'number',
        name: 'field_1',
      },
      {
        type: 'longText',
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
    ];

    const {
      data: { records },
    } = await apiGetTableById(baseId, table.data.id, {
      includeContent: true,
    });
    tableIds.push(id);

    expect(createdFields).toEqual(assertHeaders);
    expect(records?.length).toBe(0);
  });

  it(`should create a new Table from csv file useFirstRowAsHeader: false`, async () => {
    const {
      data: { calculatedColumnHeaders },
    } = await apiAnalyzeFile({
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
    });

    const table = await apiImportTableFromFile(baseId, {
      attachmentUrl: csvUrl,
      fileType: SUPPORTEDTYPE.CSV,
      columnInfo: calculatedColumnHeaders.map((column, index) => ({
        ...column,
        sourceColumnIndex: index,
      })),
      options: {
        useFirstRowAsHeader: false,
        importData: true,
      },
    });

    const { fields, id } = table.data;

    const createdFields = fields.map((field) => ({
      type: field.type,
      name: field.name,
    }));
    const assertHeaders = [
      {
        type: 'number',
        name: 'field_1',
      },
      {
        type: 'longText',
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
    ];

    const {
      data: { records },
    } = await apiGetTableById(baseId, table.data.id, {
      includeContent: true,
    });
    tableIds.push(id);

    expect(createdFields).toEqual(assertHeaders);
    expect(records?.length).toBe(3);
  });
});
