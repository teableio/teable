/* eslint-disable sonarjs/no-duplicate-string */
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type {
  IFieldRo,
  IFieldVo,
  IRecord,
  CellFormat,
  HttpError,
  IColumnMetaRo,
  IViewVo,
  IFilterRo,
  IViewRo,
} from '@teable/core';
import { FieldKeyType } from '@teable/core';
import type {
  ICreateRecordsRo,
  ICreateRecordsVo,
  ICreateTableRo,
  IGetRecordsRo,
  IRecordsVo,
  IUpdateRecordRo,
  ITableFullVo,
  ICreateSpaceRo,
  ICreateBaseRo,
  IRecordInsertOrderRo,
} from '@teable/openapi';
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
  convertField as apiConvertField,
  duplicateRecord as apiDuplicateRecord,
  getFields as apiGetFields,
  getField as apiGetField,
  getViewList as apiGetViewList,
  getView as apiGetViewById,
  updateViewColumnMeta as apiSetViewColumnMeta,
  createTable as apiCreateTable,
  deleteTable as apiDeleteTable,
  permanentDeleteTable as apiPermanentDeleteTable,
  getTableById as apiGetTableById,
  updateViewFilter as apiSetViewFilter,
  createView as apiCreateView,
  createSpace as apiCreateSpace,
  deleteSpace as apiDeleteSpace,
  createBase as apiCreateBase,
  deleteBase as apiDeleteBase,
  permanentDeleteSpace as apiPermanentDeleteSpace,
  permanentDeleteBase as apiPermanentDeleteBase,
} from '@teable/openapi';
import { json, urlencoded } from 'express';
import { AppModule } from '../../src/app.module';
import type { IBaseConfig } from '../../src/configs/base.config';
import { baseConfig } from '../../src/configs/base.config';
import { SessionHandleService } from '../../src/features/auth/session/session-handle.service';
import { NextService } from '../../src/features/next/next.service';
import { GlobalExceptionFilter } from '../../src/filter/global-exception.filter';
import { WsGateway } from '../../src/ws/ws.gateway';
import { DevWsGateway } from '../../src/ws/ws.gateway.dev';
import { TestingLogger } from './testing-logger';

export async function initApp() {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  if (globalThis.initApp) return await globalThis.initApp();

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

  const app = moduleFixture.createNestApplication({
    logger: new TestingLogger(),
  });

  const configService = app.get(ConfigService);

  app.useGlobalFilters(new GlobalExceptionFilter(configService));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, stopAtFirstError: true, forbidUnknownValues: false })
  );

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  await app.listen(0);
  const nestUrl = await app.getUrl();
  const port = new URL(nestUrl).port;
  const url = `http://127.0.0.1:${port}`;

  process.env.PORT = port;
  // for attachment origin set
  process.env.STORAGE_PREFIX = url;
  const baseConfigService = app.get(baseConfig.KEY) as IBaseConfig;
  baseConfigService.storagePrefix = url;
  baseConfigService.recordHistoryDisabled = true;

  axios.defaults.baseURL = url + '/api';

  const cookie = (
    await getCookie(globalThis.testConfig.email, globalThis.testConfig.password)
  ).cookie.join(';');

  axios.interceptors.request.use((config) => {
    config.headers.Cookie = cookie;
    return config;
  });

  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`> Test NODE_ENV is ${process.env.NODE_ENV}`);
  console.log(`> Test Ready on ${url}`);
  console.log('> Test System Time Zone:', timeZone);
  console.log('> Test Current System Time:', now.toString());

  const sessionHandleService = app.get<SessionHandleService>(SessionHandleService);
  return {
    app,
    appUrl: url,
    cookie,
    sessionID: await sessionHandleService.getSessionIdFromRequest({
      headers: { cookie },
      url: `${url}/socket`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  };
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

export async function permanentDeleteTable(baseId: string, tableId: string, expectStatus?: number) {
  try {
    const res = await apiPermanentDeleteTable(baseId, tableId);
    expectStatus && expect(res.status).toEqual(expectStatus);

    return res.data;
  } catch (e: unknown) {
    if (expectStatus && (e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as IRecord;
  }
}

type IMakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export async function getTable(
  baseId: string,
  tableId: string,
  query?: { includeContent?: boolean; viewId?: string }
): Promise<IMakeOptional<ITableFullVo, 'records' | 'views' | 'fields'>> {
  const result = await apiGetTableById(baseId, tableId);
  if (query?.includeContent) {
    const { records } = await getRecords(tableId);
    const fields = await getFields(tableId, query.viewId);
    const views = await getViews(tableId);
    return {
      ...result.data,
      records,
      views,
      fields,
    };
  }
  return result.data;
}

export async function getCookie(email: string, password: string) {
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

export async function getRecords(tableId: string, query?: IGetRecordsRo): Promise<IRecordsVo> {
  const result = await apiGetRecords(tableId, query);

  return result.data;
}

export async function duplicateRecord(
  tableId: string,
  recordId: string,
  order: IRecordInsertOrderRo,
  expectStatus = 201
) {
  try {
    const res = await apiDuplicateRecord(tableId, recordId, order);

    expect(res.status).toEqual(expectStatus);
    return res.data;
  } catch (e: unknown) {
    if ((e as HttpError).status !== expectStatus) {
      throw e;
    }
    return {} as ICreateRecordsVo;
  }
}

export async function createRecords(
  tableId: string,
  recordsRo: ICreateRecordsRo,
  expectStatus = 201
): Promise<ICreateRecordsVo> {
  try {
    const res = await apiCreateRecords(tableId, {
      ...recordsRo,
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

export async function convertField(
  tableId: string,
  fieldId: string,
  fieldRo: IFieldRo,
  expectStatus = 200
): Promise<IFieldVo> {
  try {
    const res = await apiConvertField(tableId, fieldId, fieldRo);

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

export async function updateViewFilter(tableId: string, viewId: string, filterRo: IFilterRo) {
  const result = await apiSetViewFilter(tableId, viewId, filterRo);
  return result.data;
}

export async function createSpace(spaceRo: ICreateSpaceRo) {
  const result = await apiCreateSpace(spaceRo);
  return result.data;
}

export async function deleteSpace(spaceId: string) {
  const result = await apiDeleteSpace(spaceId);
  return result.data;
}

export async function permanentDeleteSpace(spaceId: string) {
  const result = await apiPermanentDeleteSpace(spaceId);
  return result.data;
}

export async function createBase(baseRo: ICreateBaseRo) {
  const result = await apiCreateBase(baseRo);
  return result.data;
}

export async function deleteBase(baseId: string) {
  const result = await apiDeleteBase(baseId);
  return result.data;
}

export async function permanentDeleteBase(baseId: string) {
  const result = await apiPermanentDeleteBase(baseId);
  return result.data;
}
