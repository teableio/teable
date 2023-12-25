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
  IFilter,
  IViewRo,
} from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import {
  axios,
  updateRecord,
  signin,
  getRecord as apiGetRecord,
  createRecords as apiCreateRecords,
  createField as apiCreateField,
  updateField as apiUpdateField,
  getFields as apiGetFields,
  getField as apiGetField,
  getViewById as apiGetViewById,
  setViewColumnMeta as apiSetViewColumnMeta,
  createTable as apiCreateTable,
  deleteTable as apiDeleteTable,
  setViewFilter as apiSetViewFilter,
  createView as apiCreateView,
} from '@teable-group/openapi';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import request from 'supertest';
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
  console.log('globalThis.testConfig', globalThis.testConfig);
  prepareSqliteEnv();
  console.log('x0');
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
  console.log('x1-');
  const app = moduleFixture.createNestApplication();
  console.log('x1');
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

  axios.interceptors.request.use((config) => {
    config.baseURL = url + '/api';
    return config;
  });
  const { cookie } = await getCookie(globalThis.testConfig.email, globalThis.testConfig.password);

  axios.interceptors.request.use((config) => {
    config.headers.Cookie = cookie.join(';');
    return config;
  });

  const newRequest = request.agent(app.getHttpServer());
  newRequest.set('Cookie', cookie);

  console.log(`> Jest Test NODE_ENV is ${process.env.NODE_ENV}`);
  console.log(`> Jest Test Ready on ${url}`);

  return { app, request: newRequest, cookie: cookie.join(';') };
}

export async function createTable(baseId: string, tableVo: ICreateTableRo) {
  const result = await apiCreateTable(baseId, tableVo);
  return result.data;
}

export async function deleteTable(baseId: string, tableId: string) {
  const result = await apiDeleteTable(baseId, tableId);
  return result.data;
}

async function getCookie(email: string, password: string) {
  const sessionResponse = await signin({ email, password });
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
  expectStatus = 200
) {
  try {
    const res = await updateRecord(tableId, recordId, {
      record: { fields: { [fieldId]: newValue } },
      fieldKeyType: FieldKeyType.Id,
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

export async function getRecord(
  tableId: string,
  recordId: string,
  cellFormat?: CellFormat
): Promise<IRecord> {
  return (await apiGetRecord(tableId, recordId, { fieldKeyType: FieldKeyType.Id, cellFormat }))
    .data;
}

export async function createRecords(
  tableId: string,
  records: ICreateRecordsRo['records'],
  typecast = false,
  status = 201
): Promise<ICreateRecordsVo> {
  try {
    const res = await apiCreateRecords(tableId, {
      records,
      fieldKeyType: FieldKeyType.Id,
      typecast: typecast,
    });

    expect(res.status).toEqual(status);
    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== status) {
      throw e;
    }
    return {} as ICreateRecordsVo;
  }
}

export async function createField(tableId: string, fieldRo: IFieldRo): Promise<IFieldVo> {
  const result = await apiCreateField(tableId, fieldRo);

  if (result.status !== 201) {
    console.error(result.data);
  }
  expect(result.status).toEqual(201);
  return result.data;
}

export async function updateField(
  tableId: string,
  fieldId: string,
  fieldRo: IFieldRo
): Promise<IFieldVo> {
  const result = await apiUpdateField(tableId, fieldId, fieldRo);
  if (result.status !== 200) {
    console.error(JSON.stringify(result.data, null, 2));
  }
  expect(result.status).toEqual(200);
  return result.data;
}

export async function getFields(
  tableId: string,
  viewId?: string,
  filterHidden?: boolean
): Promise<IFieldVo[]> {
  const result = await apiGetFields(tableId, { viewId, filterHidden });

  return result.data;
}

export async function getField(tableId: string, fieldId: string): Promise<IFieldVo> {
  const result = await apiGetField(tableId, fieldId);
  return result.data;
}

export async function getView(tableId: string, viewId: string): Promise<IViewVo> {
  const result = await apiGetViewById(tableId, viewId);
  return result.data;
}

export async function creteView(tableId: string, viewRo: IViewRo) {
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

export async function setViewFilter(tableId: string, viewId: string, filterRo: IFilter) {
  const result = await apiSetViewFilter(tableId, viewId, filterRo);
  return result.data;
}
