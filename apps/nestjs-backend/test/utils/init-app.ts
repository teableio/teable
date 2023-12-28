/* eslint-disable sonarjs/no-duplicate-string */
import fs from 'fs';
import path from 'path';
import { ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type {
  ICreateRecordsRo,
  ICreateRecordsVo,
  IFieldRo,
  IFieldVo,
  IRecord,
  CellFormat,
  HttpError,
  IColumnMetaRo,
  IViewVo,
  ICreateTableRo,
  IFilterRo,
  IViewRo,
  IGetRecordsQuery,
  IRecordsVo,
  IUpdateRecordRo,
  ITableFullVo,
  IGetTableQuery,
  ITableVo,
} from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import {
  axios,
  signin as apiSignin,
  getRecord as apiGetRecord,
  deleteRecord as apiDeleteRecord,
  deleteRecords as apiDeleteRecords,
  updateRecord as apiUpdateRecord,
  getRecords as apiGetRecords,
  createRecords as apiCreateRecords,
  createField as apiCreateField,
  deleteField as apiDeleteField,
  updateField as apiUpdateField,
  getFields as apiGetFields,
  getField as apiGetField,
  getViewList as apiGetViewList,
  getViewById as apiGetViewById,
  setViewColumnMeta as apiSetViewColumnMeta,
  createTable as apiCreateTable,
  deleteTable as apiDeleteTable,
  getTableById as apiGetTableById,
  setViewFilter as apiSetViewFilter,
  createView as apiCreateView,
} from '@teable-group/openapi';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from '../../src/app.module';
import { NextService } from '../../src/features/next/next.service';
import { GlobalExceptionFilter } from '../../src/filter/global-exception.filter';
import { WsGateway } from '../../src/ws/ws.gateway';
import { DevWsGateway } from '../../src/ws/ws.gateway.dev';

function prepareSqliteEnv() {
  if (!process.env.PRISMA_DATABASE_URL?.startsWith('file:')) {
    return;
  }
  const prevFilePath = process.env.PRISMA_DATABASE_URL.substring(5);
  const prevDir = path.dirname(prevFilePath);
  const baseName = path.basename(prevFilePath);

  const newFileName = 'test-' + Date.now() + '-' + baseName;
  const newFilePath = path.join(prevDir, 'test', newFileName);

  process.env.PRISMA_DATABASE_URL = 'file:' + newFilePath;
  console.log('TEST PRISMA_DATABASE_URL:', process.env.PRISMA_DATABASE_URL);

  const dbPath = '../../packages/db-main-prisma/db/';
  const testDbPath = path.join(dbPath, 'test');
  if (!fs.existsSync(testDbPath)) {
    fs.mkdirSync(testDbPath, { recursive: true });
  }
  fs.copyFileSync(path.join(dbPath, baseName), path.join(testDbPath, newFileName));
}

export async function initApp() {
  prepareSqliteEnv();
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(NextService)
    .useValue({
      onModuleInit: () => {
        return;
      },
    })
    .overrideProvider(DevWsGateway)
    .useClass(WsGateway)
    .compile();
  const app = moduleFixture.createNestApplication();
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, stopAtFirstError: true, forbidUnknownValues: false })
  );
  app.use(cookieParser());

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  await app.listen(0);
  const nestUrl = await app.getUrl();
  const url = `http://127.0.0.1:${new URL(nestUrl).port}`;

  console.log('url', url);

  axios.interceptors.request.use((config) => {
    config.baseURL = url + '/api';
    return config;
  });
  const { cookie } = await getCookie(globalThis.testConfig.email, globalThis.testConfig.password);

  axios.interceptors.request.use((config) => {
    config.headers.Cookie = cookie.join(';');
    return config;
  });

  console.log(`> Test NODE_ENV is ${process.env.NODE_ENV}`);
  console.log(`> Test Ready on ${url}`);

  return { app, appUrl: url, cookie: cookie.join(';') };
}

export async function createTable(baseId: string, tableVo: ICreateTableRo, expectStatus = 201) {
  try {
    const res = await apiCreateTable(baseId, tableVo);
    expect(res.status).toEqual(expectStatus);

    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as ITableFullVo;
  }
}

export async function deleteTable(baseId: string, tableId: string, expectStatus?: number) {
  try {
    const res = await apiDeleteTable(baseId, tableId);
    expectStatus && expect(res.status).toEqual(expectStatus);

    return res.data;
  } catch (e: unknown) {
    if (expectStatus && (e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IRecord;
  }
}

export async function getTable(
  baseId: string,
  tableId: string,
  query: IGetTableQuery = {}
): Promise<ITableVo> {
  const result = await apiGetTableById(baseId, tableId, query);

  return result.data;
}

async function getCookie(email: string, password: string) {
  const sessionResponse = await apiSignin({ email, password });
  return {
    access_token: sessionResponse.data,
    cookie: sessionResponse.headers['set-cookie'] as string[],
  };
}

export async function updateRecordByApi(
  tableId: string,
  recordId: string,
  fieldId: string,
  newValue: unknown,
  expectStatus = 200,
  fieldKeyType = FieldKeyType.Id
) {
  try {
    const res = await apiUpdateRecord(tableId, recordId, {
      record: { fields: { [fieldId]: newValue } },
      fieldKeyType,
    });
    expect(res.status).toEqual(expectStatus);

    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IRecord;
  }
}

export async function updateRecord(
  tableId: string,
  recordId: string,
  recordRo: IUpdateRecordRo,
  expectStatus = 200
) {
  try {
    const res = await apiUpdateRecord(tableId, recordId, recordRo);
    expect(res.status).toEqual(expectStatus);

    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IRecord;
  }
}

export async function deleteRecord(tableId: string, recordId: string, expectStatus = 200) {
  try {
    const res = await apiDeleteRecord(tableId, recordId);
    expect(res.status).toEqual(expectStatus);

    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IRecord;
  }
}

export async function deleteRecords(tableId: string, recordIds: string[], expectStatus = 200) {
  try {
    const res = await apiDeleteRecords(tableId, recordIds);
    expect(res.status).toEqual(expectStatus);

    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IRecord;
  }
}

export async function getRecord(
  tableId: string,
  recordId: string,
  cellFormat?: CellFormat,
  expectStatus = 200
): Promise<IRecord> {
  try {
    const res = await apiGetRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
      cellFormat,
    });

    expect(res.status).toEqual(expectStatus);
    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IRecord;
  }
}

export async function getRecords(tableId: string, query?: IGetRecordsQuery): Promise<IRecordsVo> {
  const result = await apiGetRecords(tableId, query);

  return result.data;
}

export async function createRecords(
  tableId: string,
  recordsRo: ICreateRecordsRo,
  expectStatus = 201
): Promise<ICreateRecordsVo> {
  try {
    const res = await apiCreateRecords(tableId, {
      fieldKeyType: recordsRo.fieldKeyType ?? FieldKeyType.Id,
      records: recordsRo.records,
      typecast: recordsRo.typecast ?? false,
    });

    expect(res.status).toEqual(expectStatus);
    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as ICreateRecordsVo;
  }
}

export async function createField(
  tableId: string,
  fieldRo: IFieldRo,
  expectStatus = 201
): Promise<IFieldVo> {
  try {
    const res = await apiCreateField(tableId, fieldRo);

    expect(res.status).toEqual(expectStatus);
    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IFieldVo;
  }
}

export async function deleteField(tableId: string, fieldId: string) {
  const result = await apiDeleteField(tableId, fieldId);

  if (result.status !== 200) {
    console.error(result.data);
  }

  expect(result.status).toEqual(200);
  return result.data;
}

export async function updateField(
  tableId: string,
  fieldId: string,
  fieldRo: IFieldRo,
  expectStatus = 200
): Promise<IFieldVo> {
  try {
    const res = await apiUpdateField(tableId, fieldId, fieldRo);

    expect(res.status).toEqual(expectStatus);
    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IFieldVo;
  }
}

export async function getFields(
  tableId: string,
  viewId?: string,
  filterHidden?: boolean
): Promise<IFieldVo[]> {
  const result = await apiGetFields(tableId, { viewId, filterHidden });

  return result.data;
}

export async function getField(
  tableId: string,
  fieldId: string,
  expectStatus = 200
): Promise<IFieldVo> {
  try {
    const res = await apiGetField(tableId, fieldId);

    expect(res.status).toEqual(expectStatus);
    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IFieldVo;
  }
}

export async function getViews(tableId: string): Promise<IViewVo[]> {
  const result = await apiGetViewList(tableId);
  return result.data;
}

export async function getView(tableId: string, viewId: string): Promise<IViewVo> {
  const result = await apiGetViewById(tableId, viewId);
  return result.data;
}

export async function createView(tableId: string, viewRo: IViewRo) {
  const result = await apiCreateView(tableId, viewRo);
  return result.data;
}

export async function updateViewColumnMeta(
  tableId: string,
  viewId: string,
  columnMetaRo: IColumnMetaRo
) {
  const result = await apiSetViewColumnMeta(tableId, viewId, columnMetaRo);
  return result.data;
}

export async function setViewFilter(tableId: string, viewId: string, filterRo: IFilterRo) {
  const result = await apiSetViewFilter(tableId, viewId, filterRo);
  return result.data;
}
