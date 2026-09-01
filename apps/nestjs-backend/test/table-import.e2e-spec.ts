import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import { FieldType, TimeFormatting, defaultDatetimeFormatting } from '@teable/core';
import type { IInplaceImportOptionRo, IImportStreamEvent } from '@teable/openapi';
import {
  getSignature as apiGetSignature,
  uploadFile as apiUploadFile,
  notify as apiNotify,
  analyzeFile as apiAnalyzeFile,
  importTableFromFile as apiImportTableFromFile,
  getImportStatus as apiGetImportStatus,
  createBase as apiCreateBase,
  createSpace as apiCreateSpace,
  deleteBase as apiDeleteBase,
  createTable as apiCreateTable,
  inplaceImportTableFromFile as apiInplaceImportTableFromFile,
  createBaseNode as apiCreateBaseNode,
  getBaseNodeList as apiGetBaseNodeList,
  BaseNodeResourceType,
  SUPPORTEDTYPE,
  UploadType,
  axios,
  urlBuilder,
  IMPORT_TABLE_STREAM,
  INPLACE_IMPORT_TABLE_STREAM,
  X_CANARY_HEADER,
} from '@teable/openapi';
import dayjs, { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import { noop } from 'lodash';
import * as XLSX from 'xlsx';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { CsvImporter } from '../src/features/import/open-api/import.class';
import { createAwaitWithEventWithResult } from './utils/event-promise';
import { initApp, permanentDeleteTable, getTable as apiGetTableById } from './utils/init-app';

extend(timezone);

const importTimeZone = 'Asia/Shanghai';

enum TestFileFormat {
  'CSV' = 'csv',
  'TSV' = 'tsv',
  'TXT' = 'txt',
  'XLSX' = 'xlsx',
}

const defaultTestSheetKey = 'Sheet1';
const xTeableV2Header = 'x-teable-v2';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
2,string_2,"false",2022-11-11 16:00:00,,`;
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
let cookie: string;
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

const bannerExcelHeaders = [
  { type: 'number', name: 'Item' },
  { type: 'singleLineText', name: 'Lane' },
  { type: 'singleLineText', name: 'Origin' },
];

const uploadImportFile = async (
  contents: string | Buffer,
  fileName: string,
  contentType: string
): Promise<string> => {
  const tmpPath = path.resolve(path.join(StorageAdapter.TEMPORARY_DIR, fileName));
  fs.writeFileSync(tmpPath, contents);
  const stats = fs.statSync(tmpPath);
  const { token, requestHeaders } = (
    await apiGetSignature(
      {
        type: UploadType.Import,
        contentLength: stats.size,
        contentType,
      },
      undefined
    )
  ).data;
  await apiUploadFile(token, fs.createReadStream(tmpPath), requestHeaders);
  const {
    data: { presignedUrl },
  } = await apiNotify(token, undefined, fileName);
  return presignedUrl;
};

const uploadCsv = (contents: string | Buffer, fileName: string): Promise<string> =>
  uploadImportFile(contents, fileName, 'text/csv');

const uploadBannerExcel = async (): Promise<string> => {
  const bannerWorkbook = XLSX.utils.book_new();
  const bannerSheet = XLSX.utils.aoa_to_sheet(
    [
      ['Template title'],
      [],
      ['Legend'],
      [],
      ['Item', 'Lane', 'Origin'],
      [1, 'Shanghai-Hamburg', 'APAC'],
      [2, 'Ningbo-Antwerp', 'APAC'],
    ],
    { origin: 'A2' }
  );
  XLSX.utils.book_append_sheet(bannerWorkbook, bannerSheet, defaultTestSheetKey);
  const bannerBytes = await XLSX.write(bannerWorkbook, { type: 'buffer', bookType: 'xlsx' });
  return uploadImportFile(
    bannerBytes,
    'template.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
};

const withForceV2All = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previousForceV2All = process.env.FORCE_V2_ALL;
  process.env.FORCE_V2_ALL = 'true';
  try {
    return await fn();
  } finally {
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  }
};

const consumeImportStream = async (
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown
): Promise<{
  progressEvents: Array<{
    phase: string;
    processedCount: number;
    totalCount: number;
    sheetIndex: number;
  }>;
  doneEvent?: Extract<IImportStreamEvent, { id: 'done' }>;
  errorEvents: Array<{ message: string }>;
  headers: Headers;
}> => {
  const streamUrl = axios.getUri({
    baseURL: axios.defaults.baseURL,
    url,
  });
  const response = await fetch(streamUrl, {
    method,
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Cookie: cookie,
      [X_CANARY_HEADER]: 'true',
    },
    body: JSON.stringify(body),
  });

  expect(response.ok).toBe(true);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const progressEvents: Array<{
    phase: string;
    processedCount: number;
    totalCount: number;
    sheetIndex: number;
  }> = [];
  let doneEvent: Extract<IImportStreamEvent, { id: 'done' }> | undefined;
  const errorEvents: Array<{ message: string }> = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      const event = JSON.parse(jsonStr) as IImportStreamEvent;
      if (event.id === 'progress') {
        progressEvents.push({
          phase: event.phase,
          processedCount: event.processedCount,
          totalCount: event.totalCount,
          sheetIndex: event.sheetIndex,
        });
      } else if (event.id === 'done') {
        doneEvent = event;
      } else if (event.id === 'error') {
        errorEvents.push({ message: event.message });
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const line = buffer;
    if (line.startsWith('data:')) {
      const jsonStr = line.slice(5).trim();
      if (jsonStr && jsonStr !== '[DONE]') {
        const event = JSON.parse(jsonStr) as IImportStreamEvent;
        if (event.id === 'progress') {
          progressEvents.push({
            phase: event.phase,
            processedCount: event.processedCount,
            totalCount: event.totalCount,
            sheetIndex: event.sheetIndex,
          });
        } else if (event.id === 'done') {
          doneEvent = event;
        } else if (event.id === 'error') {
          errorEvents.push({ message: event.message });
        }
      }
    }
  }

  return { progressEvents, doneEvent, errorEvents, headers: response.headers };
};

describe('OpenAPI ImportController (e2e)', () => {
  const bases: [string, string][] = [];
  let eventEmitterService: EventEmitterService;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    eventEmitterService = app.get(EventEmitterService);
    testFiles = await genTestFiles();
  });

  afterAll(async () => {
    testFileFormats.forEach((type) => {
      fs.unlink(testFiles[type].path, (err) => {
        if (err) throw err;
        console.log(`delete ${type} test file success!`);
      });
    });
    const deletedBases = new Set<string>();
    for (const [baseId, tableId] of bases) {
      await permanentDeleteTable(baseId, tableId).catch(noop);
      deletedBases.add(baseId);
    }
    for (const baseId of deletedBases) {
      await apiDeleteBase(baseId).catch(noop);
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

    it(`should keep a non-ASCII file name intact as the sheet name`, async () => {
      const csvPath = testFiles[TestFileFormat.CSV].path;
      const stats = fs.statSync(csvPath);
      const { token, requestHeaders } = (
        await apiGetSignature(
          { type: UploadType.Import, contentLength: stats.size, contentType: 'text/csv' },
          undefined
        )
      ).data;
      await apiUploadFile(token, fs.createReadStream(csvPath), requestHeaders);
      const {
        data: { presignedUrl },
      } = await apiNotify(token, undefined, '表格 3 (2).csv');

      const {
        data: { worksheets },
      } = await apiAnalyzeFile({
        attachmentUrl: presignedUrl,
        fileType: SUPPORTEDTYPE.CSV,
      });
      // Regression: the read endpoint double-encoded the file name, so the
      // analyzed sheet name (and the table created from it) showed up as
      // a percent-encoded string like %E8%A1%A8%E6%A0%BC%203%20(2).
      expect(worksheets[CsvImporter.DEFAULT_SHEETKEY].name).toBe('表格 3 (2)');
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

    it('should detect excel headers below a title banner when the used range starts at A2', async () => {
      const attachmentUrl = await uploadBannerExcel();
      const {
        data: { worksheets },
      } = await apiAnalyzeFile({
        attachmentUrl,
        fileType: SUPPORTEDTYPE.EXCEL,
      });
      expect(worksheets['Sheet1'].columns).toEqual(bannerExcelHeaders);
    });

    it('should parse CSV headers and quoted values that contain commas', async () => {
      const attachmentUrl = await uploadCsv(
        'Name,Note,Amount\n"Product A","hello, world",100\nJane,,\n',
        'quoted.csv'
      );
      const {
        data: { worksheets },
      } = await apiAnalyzeFile({
        attachmentUrl,
        fileType: SUPPORTEDTYPE.CSV,
      });
      expect(worksheets[CsvImporter.DEFAULT_SHEETKEY].columns).toEqual([
        { type: 'singleLineText', name: 'Name' },
        { type: 'singleLineText', name: 'Note' },
        { type: 'number', name: 'Amount' },
      ]);
    });

    it('should strip a UTF-8 BOM from CSV headers', async () => {
      const attachmentUrl = await uploadCsv(
        Buffer.from('\uFEFFName,City\nAlice,Beijing\n'),
        'bom.csv'
      );
      const {
        data: { worksheets },
      } = await apiAnalyzeFile({
        attachmentUrl,
        fileType: SUPPORTEDTYPE.CSV,
      });
      expect(worksheets[CsvImporter.DEFAULT_SHEETKEY].columns.map((column) => column.name)).toEqual(
        ['Name', 'City']
      );
    });
  });

  describe('/import/{baseId} OpenAPI ImportController (e2e) (Post)', () => {
    let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<void>;

    it.each(testFileFormats.filter((format) => format !== TestFileFormat.TXT))(
      'should create a new Table from %s file',
      async (format) => {
        awaitWithEvent = createAwaitWithEventWithResult<void>(
          eventEmitterService,
          Events.TABLE_IMPORT_FINISH
        );
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
          tz: importTimeZone,
        });

        const { fields, id } = table.data[0];

        const createdFields = fields.map((field) => ({
          type: field.type,
          name: field.name,
        }));

        if (table.headers[xTeableV2Header] !== 'true') {
          await awaitWithEvent(async () => {
            noop();
          });
        }

        const { records } = await apiGetTableById(baseId, table.data[0].id, {
          includeContent: true,
        });

        bases.push([baseId, id]);

        expect(records?.length).toBe(2);
        expect(createdFields).toEqual(assertHeaders);
      }
    );

    it('should import an excel template whose used range starts below A1', async () => {
      awaitWithEvent = createAwaitWithEventWithResult<void>(
        eventEmitterService,
        Events.TABLE_IMPORT_FINISH
      );
      const spaceRes = await apiCreateSpace({ name: 'excel-banner-import' });
      const spaceId = spaceRes?.data?.id;
      const baseRes = await apiCreateBase({ spaceId });
      const baseId = baseRes.data.id;
      const attachmentUrl = await uploadBannerExcel();

      const {
        data: { worksheets },
      } = await apiAnalyzeFile({
        attachmentUrl,
        fileType: SUPPORTEDTYPE.EXCEL,
      });
      const calculatedColumnHeaders = worksheets[defaultTestSheetKey].columns;
      expect(calculatedColumnHeaders).toEqual(bannerExcelHeaders);

      const table = await apiImportTableFromFile(baseId, {
        attachmentUrl,
        fileType: SUPPORTEDTYPE.EXCEL,
        worksheets: {
          [defaultTestSheetKey]: {
            name: defaultTestSheetKey,
            columns: calculatedColumnHeaders.map((column, index) => ({
              ...column,
              sourceColumnIndex: index,
            })),
            useFirstRowAsHeader: true,
            importData: true,
          },
        },
        tz: importTimeZone,
      });

      const { fields, id } = table.data[0];
      if (table.headers[xTeableV2Header] !== 'true') {
        await awaitWithEvent(async () => {
          noop();
        });
      }

      const { records } = await apiGetTableById(baseId, id, {
        includeContent: true,
      });
      bases.push([baseId, id]);

      expect(fields.map((field) => ({ type: field.type, name: field.name }))).toEqual(
        bannerExcelHeaders
      );
      expect(records?.length).toBe(2);
    });

    it.each([TestFileFormat.CSV, TestFileFormat.XLSX] as const)(
      'should route %s new-table import through V2 when V2 is forced',
      async (format) => {
        await withForceV2All(async () => {
          const spaceRes = await apiCreateSpace({ name: `v2-import-${format}` });
          const spaceId = spaceRes?.data?.id;
          const baseRes = await apiCreateBase({ spaceId });
          const baseId = baseRes.data.id;

          const fileType = testSupportTypeMap[format].fileType;
          const attachmentUrl = testFiles[format].url;
          const sheetKey = testSupportTypeMap[format].defaultSheetKey;

          const {
            data: { worksheets },
          } = await apiAnalyzeFile({
            attachmentUrl,
            fileType,
          });
          const columns = worksheets[sheetKey].columns.map((column, index) => ({
            ...column,
            sourceColumnIndex: index,
          }));

          const importRes = await apiImportTableFromFile(baseId, {
            attachmentUrl,
            fileType,
            worksheets: {
              [sheetKey]: {
                name: sheetKey,
                columns,
                useFirstRowAsHeader: true,
                importData: true,
              },
            },
            tz: importTimeZone,
          });

          expect(importRes.headers[xTeableV2Header]).toBe('true');
          expect(importRes.headers['x-teable-v2-feature']).toBe('importCsv');
          expect(importRes.headers['x-teable-v2-reason']).not.toBe('unsupported_feature');
          expect(['env_force_v2_all', 'new_base']).toContain(
            importRes.headers['x-teable-v2-reason']
          );

          const { fields, id } = importRes.data[0];
          const createdFields = fields.map((field) => ({
            type: field.type,
            name: field.name,
          }));

          const { records } = await apiGetTableById(baseId, id, {
            includeContent: true,
          });

          bases.push([baseId, id]);

          expect(records?.length).toBe(2);
          expect(createdFields).toEqual(assertHeaders);
        });
      }
    );

    it('should uniquify duplicate Excel column names when creating a table through V2', async () => {
      await withForceV2All(async () => {
        const duplicateWorkbook = XLSX.utils.book_new();
        const duplicateSheet = XLSX.utils.aoa_to_sheet([
          ['Name', 'Name'],
          ['Alice', 'Bob'],
        ]);
        XLSX.utils.book_append_sheet(duplicateWorkbook, duplicateSheet, defaultTestSheetKey);
        const duplicateBuffer = await XLSX.write(duplicateWorkbook, {
          type: 'buffer',
          bookType: 'xlsx',
        });
        const presignedUrl = await uploadImportFile(
          duplicateBuffer,
          'duplicate-headers.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );

        const spaceRes = await apiCreateSpace({ name: 'v2-import-excel-duplicate' });
        const spaceId = spaceRes?.data?.id;
        const baseRes = await apiCreateBase({ spaceId });
        const baseId = baseRes.data.id;

        const fileType = SUPPORTEDTYPE.EXCEL;
        const {
          data: { worksheets },
        } = await apiAnalyzeFile({
          attachmentUrl: presignedUrl,
          fileType,
        });
        const sheetKey = defaultTestSheetKey;
        const columns = worksheets[sheetKey].columns.map((column, index) => ({
          ...column,
          sourceColumnIndex: index,
        }));

        const importRes = await apiImportTableFromFile(baseId, {
          attachmentUrl: presignedUrl,
          fileType,
          worksheets: {
            [sheetKey]: {
              name: sheetKey,
              columns,
              useFirstRowAsHeader: true,
              importData: true,
            },
          },
          tz: importTimeZone,
        });

        expect(importRes.headers[xTeableV2Header]).toBe('true');
        expect(importRes.headers['x-teable-v2-reason']).not.toBe('unsupported_feature');

        const { fields, id } = importRes.data[0];
        expect(fields.map((field) => field.name)).toEqual(['Name', 'Name 2']);

        const { records } = await apiGetTableById(baseId, id, {
          includeContent: true,
        });
        bases.push([baseId, id]);
        expect(records?.length).toBe(1);
      });
    });

    it('should import an excel template whose used range starts below A1 through V2', async () => {
      await withForceV2All(async () => {
        const spaceRes = await apiCreateSpace({ name: 'v2-excel-banner-import' });
        const baseRes = await apiCreateBase({ spaceId: spaceRes.data.id });
        const baseId = baseRes.data.id;
        const attachmentUrl = await uploadBannerExcel();

        const {
          data: { worksheets },
        } = await apiAnalyzeFile({
          attachmentUrl,
          fileType: SUPPORTEDTYPE.EXCEL,
        });
        const columns = worksheets[defaultTestSheetKey].columns.map((column, index) => ({
          ...column,
          sourceColumnIndex: index,
        }));

        const importRes = await apiImportTableFromFile(baseId, {
          attachmentUrl,
          fileType: SUPPORTEDTYPE.EXCEL,
          worksheets: {
            [defaultTestSheetKey]: {
              name: defaultTestSheetKey,
              columns,
              useFirstRowAsHeader: true,
              importData: true,
            },
          },
          tz: importTimeZone,
        });

        expect(importRes.headers[xTeableV2Header]).toBe('true');
        expect(importRes.headers['x-teable-v2-reason']).not.toBe('unsupported_feature');

        const { fields, id } = importRes.data[0];
        const { records } = await apiGetTableById(baseId, id, {
          includeContent: true,
        });
        bases.push([baseId, id]);

        expect(fields.map((field) => ({ type: field.type, name: field.name }))).toEqual(
          bannerExcelHeaders
        );
        expect(records?.length).toBe(2);
        expect(records?.[0].fields).toMatchObject({
          Item: 1,
          Lane: 'Shanghai-Hamburg',
          Origin: 'APAC',
        });
      });
    });

    it('should import CSV quoted commas, empty cells, and duplicate headers through V2', async () => {
      await withForceV2All(async () => {
        const attachmentUrl = await uploadCsv(
          'Name,Note,Name\n"Product A","hello, world",Alice\nJane,,Bob\n',
          'quoted-empty-duplicate.csv'
        );
        const spaceRes = await apiCreateSpace({ name: 'v2-csv-quoted-empty' });
        const baseRes = await apiCreateBase({ spaceId: spaceRes.data.id });
        const baseId = baseRes.data.id;

        const {
          data: { worksheets },
        } = await apiAnalyzeFile({
          attachmentUrl,
          fileType: SUPPORTEDTYPE.CSV,
        });
        const sheetKey = CsvImporter.DEFAULT_SHEETKEY;
        const columns = worksheets[sheetKey].columns.map((column, index) => ({
          ...column,
          sourceColumnIndex: index,
        }));

        const importRes = await apiImportTableFromFile(baseId, {
          attachmentUrl,
          fileType: SUPPORTEDTYPE.CSV,
          worksheets: {
            [sheetKey]: {
              name: sheetKey,
              columns,
              useFirstRowAsHeader: true,
              importData: true,
            },
          },
          tz: importTimeZone,
        });

        expect(importRes.headers[xTeableV2Header]).toBe('true');

        const { fields, id } = importRes.data[0];
        const { records } = await apiGetTableById(baseId, id, {
          includeContent: true,
        });
        bases.push([baseId, id]);

        expect(fields.map((field) => field.name)).toEqual(['Name', 'Note', 'Name 2']);
        expect(records?.length).toBe(2);
        expect(records?.[0].fields).toMatchObject({
          Name: 'Product A',
          Note: 'hello, world',
          'Name 2': 'Alice',
        });
        expect(records?.[1].fields).toMatchObject({
          Name: 'Jane',
          'Name 2': 'Bob',
        });
        expect(records?.[1].fields.Note).toBeUndefined();
      });
    });

    it('should import a UTF-8 BOM CSV through V2 without leaking the BOM into the header', async () => {
      await withForceV2All(async () => {
        const attachmentUrl = await uploadCsv(
          Buffer.from('\uFEFFName,City\nAlice,Beijing\n'),
          'bom.csv'
        );
        const spaceRes = await apiCreateSpace({ name: 'v2-csv-bom' });
        const baseRes = await apiCreateBase({ spaceId: spaceRes.data.id });
        const baseId = baseRes.data.id;

        const {
          data: { worksheets },
        } = await apiAnalyzeFile({
          attachmentUrl,
          fileType: SUPPORTEDTYPE.CSV,
        });
        const sheetKey = CsvImporter.DEFAULT_SHEETKEY;
        const columns = worksheets[sheetKey].columns.map((column, index) => ({
          ...column,
          sourceColumnIndex: index,
        }));

        const importRes = await apiImportTableFromFile(baseId, {
          attachmentUrl,
          fileType: SUPPORTEDTYPE.CSV,
          worksheets: {
            [sheetKey]: {
              name: sheetKey,
              columns,
              useFirstRowAsHeader: true,
              importData: true,
            },
          },
          tz: importTimeZone,
        });

        const { fields, id } = importRes.data[0];
        const { records } = await apiGetTableById(baseId, id, {
          includeContent: true,
        });
        bases.push([baseId, id]);

        expect(fields.map((field) => field.name)).toEqual(['Name', 'City']);
        expect(records?.length).toBe(1);
        expect(records?.[0].fields).toMatchObject({
          Name: 'Alice',
          City: 'Beijing',
        });
      });
    });

    const buildCsvImportRo = () => {
      const format = TestFileFormat.CSV;
      const fileType = testSupportTypeMap[format].fileType;
      const sheetKey = testSupportTypeMap[format].defaultSheetKey;
      return {
        attachmentUrl: testFiles[format].url,
        fileType,
        worksheets: {
          [sheetKey]: {
            name: sheetKey,
            columns: assertHeaders.map((column, index) => ({
              ...column,
              type: column.type as FieldType,
              sourceColumnIndex: index,
            })),
            useFirstRowAsHeader: true,
            importData: false,
          },
        },
        tz: importTimeZone,
      };
    };

    it('should place the imported table under the given folder node', async () => {
      const spaceRes = await apiCreateSpace({ name: 'import-into-folder' });
      const baseRes = await apiCreateBase({ spaceId: spaceRes.data.id });
      const baseId = baseRes.data.id;

      const folderNode = await apiCreateBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Import Folder',
      });

      const importRes = await apiImportTableFromFile(baseId, {
        ...buildCsvImportRo(),
        folderId: folderNode.data.id,
      });
      const [table] = importRes.data;
      bases.push([baseId, table.id]);

      const nodes = (await apiGetBaseNodeList(baseId)).data;
      const tableNode = nodes.find((node) => node.resourceId === table.id);
      expect(tableNode?.parentId).toBe(folderNode.data.id);
    });

    it('should accept the folder resource id as folderId', async () => {
      const spaceRes = await apiCreateSpace({ name: 'import-into-folder-by-resource-id' });
      const baseRes = await apiCreateBase({ spaceId: spaceRes.data.id });
      const baseId = baseRes.data.id;

      const folderNode = await apiCreateBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Resource Id Folder',
      });
      expect(folderNode.data.resourceId).not.toBe(folderNode.data.id);

      const importRes = await apiImportTableFromFile(baseId, {
        ...buildCsvImportRo(),
        folderId: folderNode.data.resourceId,
      });
      const [table] = importRes.data;
      bases.push([baseId, table.id]);

      const nodes = (await apiGetBaseNodeList(baseId)).data;
      const tableNode = nodes.find((node) => node.resourceId === table.id);
      expect(tableNode?.parentId).toBe(folderNode.data.id);
    });

    it('should place the V2 imported table under the given folder node', async () => {
      const previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';

      try {
        const spaceRes = await apiCreateSpace({ name: 'v2-import-into-folder' });
        const baseRes = await apiCreateBase({ spaceId: spaceRes.data.id });
        const baseId = baseRes.data.id;

        const folderNode = await apiCreateBaseNode(baseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: 'V2 Import Folder',
        });

        const importRes = await apiImportTableFromFile(baseId, {
          ...buildCsvImportRo(),
          folderId: folderNode.data.id,
        });
        expect(importRes.headers[xTeableV2Header]).toBe('true');
        const [table] = importRes.data;
        bases.push([baseId, table.id]);

        const nodes = (await apiGetBaseNodeList(baseId)).data;
        const tableNode = nodes.find((node) => node.resourceId === table.id);
        expect(tableNode?.parentId).toBe(folderNode.data.id);
      } finally {
        if (previousForceV2All === undefined) {
          delete process.env.FORCE_V2_ALL;
        } else {
          process.env.FORCE_V2_ALL = previousForceV2All;
        }
      }
    });

    it('should reject folder import when the folder is missing or not a folder', async () => {
      const spaceRes = await apiCreateSpace({ name: 'import-bad-parent' });
      const baseRes = await apiCreateBase({ spaceId: spaceRes.data.id });
      const baseId = baseRes.data.id;

      try {
        await expect(
          apiImportTableFromFile(baseId, {
            ...buildCsvImportRo(),
            folderId: 'non-existent-node-id',
          })
        ).rejects.toMatchObject({ status: 404 });

        const tableRes = await apiCreateTable(baseId, { name: 'not-a-folder' });
        const nodes = (await apiGetBaseNodeList(baseId)).data;
        const tableNode = nodes.find((node) => node.resourceId === tableRes.data.id);

        await expect(
          apiImportTableFromFile(baseId, { ...buildCsvImportRo(), folderId: tableNode!.id })
        ).rejects.toMatchObject({ status: 400 });
      } finally {
        await apiDeleteBase(baseId);
      }
    });

    it('should query import status until completed for imported table', async () => {
      const spaceRes = await apiCreateSpace({ name: 'status-check' });
      const spaceId = spaceRes?.data?.id;
      const baseRes = await apiCreateBase({ spaceId });
      const baseId = baseRes.data.id;

      const format = TestFileFormat.XLSX;
      const fileType = testSupportTypeMap[format].fileType;
      const attachmentUrl = testFiles[format].url;
      const sheetKey = testSupportTypeMap[format].defaultSheetKey;

      const {
        data: { worksheets },
      } = await apiAnalyzeFile({
        attachmentUrl,
        fileType,
      });
      const columns = worksheets[sheetKey].columns.map((column, index) => ({
        ...column,
        sourceColumnIndex: index,
      }));

      const importRes = await apiImportTableFromFile(baseId, {
        attachmentUrl,
        fileType,
        worksheets: {
          [sheetKey]: {
            name: sheetKey,
            columns,
            useFirstRowAsHeader: true,
            importData: true,
          },
        },
        tz: importTimeZone,
      });

      const tableId = importRes.data[0].id;
      bases.push([baseId, tableId]);

      if (importRes.headers[xTeableV2Header] === 'true') {
        expect(importRes.headers['x-teable-v2-reason']).not.toBe('unsupported_feature');
        const { records } = await apiGetTableById(baseId, tableId, {
          includeContent: true,
        });
        expect(records?.length).toBe(2);
        return;
      }

      const timeoutMs = 30000;
      const intervalMs = 1000;
      const start = Date.now();
      let latestStatus: string | undefined;

      while (Date.now() - start < timeoutMs) {
        const { data } = await apiGetImportStatus(tableId);
        latestStatus = data.status;
        if (data.status === 'completed' || data.status === 'failed') {
          expect(data.successCount).toBeDefined();
          expect(data.failedCount).toBeDefined();
          expect((data.successCount ?? 0) + (data.failedCount ?? 0)).toBeGreaterThan(0);
          expect(data.status).toBe('completed');
          return;
        }
        expect(data.status).not.toBe('not_found');
        await sleep(intervalMs);
      }

      throw new Error(
        `Import status polling timed out, latest status: ${latestStatus ?? 'unknown'}`
      );
    });
  });

  describe('/import/{baseId}/stream OpenAPI ImportController (e2e) (Post SSE)', () => {
    it('streams real Excel row progress and creates tables for every sheet', async () => {
      await withForceV2All(async () => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.aoa_to_sheet([
            ['Name', 'Age'],
            ['Alice', 30],
            ['Bob', 40],
            ['Cara', 50],
            ['Dan', 60],
          ]),
          'People'
        );
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.aoa_to_sheet([['City'], ['Beijing'], ['Shanghai'], ['Shenzhen']]),
          'Places'
        );
        const attachmentUrl = await uploadImportFile(
          await XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
          'stream-progress.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        const spaceRes = await apiCreateSpace({ name: 'v2-import-stream-excel' });
        const baseId = (await apiCreateBase({ spaceId: spaceRes.data.id })).data.id;
        const {
          data: { worksheets },
        } = await apiAnalyzeFile({
          attachmentUrl,
          fileType: SUPPORTEDTYPE.EXCEL,
        });

        const importWorksheets = Object.fromEntries(
          Object.entries(worksheets).map(([key, value]) => [
            key,
            {
              name: value.name,
              columns: value.columns.map((column, index) => ({
                ...column,
                sourceColumnIndex: index,
              })),
              useFirstRowAsHeader: true,
              importData: true,
            },
          ])
        );

        const { progressEvents, doneEvent, errorEvents, headers } = await consumeImportStream(
          urlBuilder(IMPORT_TABLE_STREAM, { baseId }),
          'POST',
          {
            attachmentUrl,
            fileType: SUPPORTEDTYPE.EXCEL,
            worksheets: importWorksheets,
            tz: importTimeZone,
          }
        );

        expect(headers.get(xTeableV2Header)).toBe('true');
        expect(errorEvents).toEqual([]);
        expect(doneEvent?.id).toBe('done');
        expect(doneEvent?.totalCount).toBe(7);
        expect(doneEvent?.processedCount).toBe(7);
        expect(doneEvent?.importedCount).toBe(7);
        expect(doneEvent?.data.tables).toHaveLength(2);

        const totals = progressEvents.map((event) => event.totalCount);
        expect(totals.some((total) => total === 7)).toBe(true);
        const processed = progressEvents.map((event) => event.processedCount);
        expect(Math.max(...processed)).toBe(7);
        expect(processed.some((count, index) => index > 0 && count > processed[0])).toBe(true);

        const tableId = doneEvent!.data.tableId as string;
        const { records } = await apiGetTableById(baseId, tableId, { includeContent: true });
        bases.push([baseId, tableId]);
        for (const table of doneEvent!.data.tables ?? []) {
          const id = (table as { id: string }).id;
          if (id !== tableId) {
            bases.push([baseId, id]);
          }
        }
        expect(records?.length).toBeGreaterThan(0);
      });
    });
  });

  describe('/import/{baseId}/{tableId} OpenAPI ImportController (e2e) (Patch)', () => {
    let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<void>;

    it('should import data into Table from file', async () => {
      awaitWithEvent = createAwaitWithEventWithResult<void>(
        eventEmitterService,
        Events.TABLE_IMPORT_FINISH
      );
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
                time: TimeFormatting.Hour24,
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
      const importRes = await apiInplaceImportTableFromFile(baseId, tableId, {
        attachmentUrl,
        fileType,
        insertConfig: {
          sourceWorkSheetKey: CsvImporter.DEFAULT_SHEETKEY,
          excludeFirstRow: true,
          sourceColumnMap,
        },
      });
      if (importRes.headers[xTeableV2Header] !== 'true') {
        await awaitWithEvent(async () => {
          noop();
        });
      }

      const { records } = await apiGetTableById(baseId, tableId, {
        includeContent: true,
      });

      bases.push([baseId, tableId]);

      const tableRecords = records?.map((r) => {
        const newFields = { ...r.fields };
        if (newFields['field_4']) {
          newFields['field_4'] = new Date(newFields['field_4'] as string).getTime();
        }
        return newFields;
      });

      const assertRecords = [
        {
          field_1: 1,
          field_2: 'string_1',
          field_3: true,
          field_4: dayjs
            .tz('2022-11-10 16:00:00', defaultDatetimeFormatting.timeZone)
            .toDate()
            .getTime(),
          field_6: 'long\ntext',
        },
        {
          field_1: 2,
          field_2: 'string_2',
          field_4: dayjs
            .tz('2022-11-11 16:00:00', defaultDatetimeFormatting.timeZone)
            .toDate()
            .getTime(),
        },
      ];

      expect(records?.length).toBe(2);
      expect(tableRecords).toEqual(assertRecords);
    });

    it('streams real inplace CSV row progress when V2 is forced', async () => {
      await withForceV2All(async () => {
        const spaceRes = await apiCreateSpace({ name: 'v2-inplace-import-stream' });
        const baseId = (await apiCreateBase({ spaceId: spaceRes.data.id })).data.id;
        const tableRes = await apiCreateTable(baseId, {
          fields: [
            { type: FieldType.Number, name: 'field_1' },
            { type: FieldType.SingleLineText, name: 'field_2' },
            { type: FieldType.Checkbox, name: 'field_3' },
            {
              type: FieldType.Date,
              name: 'field_4',
              options: {
                formatting: {
                  date: 'YYYY-MM-DD',
                  time: TimeFormatting.Hour24,
                  timeZone: defaultDatetimeFormatting.timeZone,
                },
              },
            },
            { type: FieldType.SingleLineText, name: 'field_5' },
            { type: FieldType.LongText, name: 'field_6' },
          ],
          records: [],
        });
        const tableId = tableRes.data.id;
        const sourceColumnMap: IInplaceImportOptionRo['insertConfig']['sourceColumnMap'] = {};
        tableRes.data.fields.forEach((field, index) => {
          sourceColumnMap[field.id] = index;
        });

        const { progressEvents, doneEvent, errorEvents } = await consumeImportStream(
          urlBuilder(INPLACE_IMPORT_TABLE_STREAM, { baseId, tableId }),
          'PATCH',
          {
            attachmentUrl: testFiles[TestFileFormat.CSV].url,
            fileType: SUPPORTEDTYPE.CSV,
            insertConfig: {
              sourceWorkSheetKey: CsvImporter.DEFAULT_SHEETKEY,
              excludeFirstRow: true,
              sourceColumnMap,
            },
          }
        );

        expect(errorEvents).toEqual([]);
        expect(doneEvent?.id).toBe('done');
        expect(doneEvent?.importedCount).toBe(2);
        expect(doneEvent?.processedCount).toBe(2);
        expect(progressEvents.some((event) => event.totalCount === 2)).toBe(true);
        expect(Math.max(...progressEvents.map((event) => event.processedCount))).toBe(2);

        const { records } = await apiGetTableById(baseId, tableId, { includeContent: true });
        bases.push([baseId, tableId]);
        expect(records?.length).toBe(2);
      });
    });
  });
});
