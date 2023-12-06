/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
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
  IRecordsVo,
  IUpdateRecordRo,
  CellFormat,
} from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import type { ISignin } from '@teable-group/openapi';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { NextService } from '../../src/features/next/next.service';
import { GlobalExceptionFilter } from '../../src/filter/global-exception.filter';
import { WsGateway } from '../../src/ws/ws.gateway';
import { DevWsGateway } from '../../src/ws/ws.gateway.dev';

export async function initApp() {
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
  const { cookie } = await signin(app, globalThis.testConfig.email, globalThis.testConfig.password);

  console.log(`> Jest Test NODE_ENV is ${process.env.NODE_ENV}`);
  console.log(`> Jest Test Ready on ${await app.getUrl()}`);
  const newRequest = request.agent(app.getHttpServer());
  newRequest.set('Cookie', cookie);
  return { app, request: newRequest, cookie: cookie.join(';') };
}

export async function signin(app: INestApplication, email: string, password: string) {
  const sessionResponse = await request(app.getHttpServer())
    .post('/api/auth/signin')
    .send({
      email,
      password,
    } as ISignin)
    .expect(200);
  return {
    access_token: sessionResponse.body,
    cookie: sessionResponse.get('Set-Cookie'),
  };
}

export async function signup(app: INestApplication, email: string, password: string) {
  const sessionResponse = await request(app.getHttpServer())
    .post('/api/auth/signup')
    .send({
      email,
      password,
    } as ISignin)
    .expect(200);
  return {
    access_token: sessionResponse.body,
    cookie: sessionResponse.headers['set-cookie'],
  };
}

export async function updateRecordByApi(
  request: request.SuperAgentTest,
  tableId: string,
  recordId: string,
  fieldId: string,
  newValue: unknown,
  expectStatus = 200
): Promise<IRecord> {
  const result = await request.patch(`/api/table/${tableId}/record/${recordId}`).send({
    fieldKeyType: FieldKeyType.Id,
    record: {
      fields: {
        [fieldId]: newValue,
      },
    },
  } as IUpdateRecordRo);

  if (result.status !== 200 && result.status !== expectStatus) {
    console.error(result.body);
  }
  expect(result.status).toEqual(expectStatus);
  return result.body;
}

export async function getRecords(
  request: request.SuperAgentTest,
  tableId: string,
  cellFormat?: CellFormat
): Promise<IRecordsVo> {
  return (
    await request
      .get(`/api/table/${tableId}/record`)
      .query({
        fieldKeyType: FieldKeyType.Id,
        cellFormat,
      })
      .expect(200)
  ).body;
}

export async function getRecord(
  request: request.SuperAgentTest,
  tableId: string,
  recordId: string,
  cellFormat?: CellFormat
): Promise<IRecord> {
  return (
    await request
      .get(`/api/table/${tableId}/record/${recordId}`)
      .query({
        fieldKeyType: FieldKeyType.Id,
        cellFormat,
      })
      .expect(200)
  ).body;
}

export async function deleteRecords(
  request: request.SuperAgentTest,
  tableId: string,
  recordIds: string[]
): Promise<IRecordsVo> {
  return (
    await request
      .delete(`/api/table/${tableId}/record`)
      .query({
        recordIds,
      })
      .expect(200)
  ).body;
}

export async function createRecords(
  request: request.SuperAgentTest,
  tableId: string,
  records: ICreateRecordsRo['records'],
  typecast = false,
  expect = 201
): Promise<ICreateRecordsVo> {
  return (
    await request
      .post(`/api/table/${tableId}/record`)
      .send({
        records,
        fieldKeyType: FieldKeyType.Id,
        typecast: typecast,
      })
      .expect(expect)
  ).body;
}

export async function deleteRecord(
  request: request.SuperAgentTest,
  tableId: string,
  recordId: string
): Promise<IRecord> {
  return (await request.delete(`/api/table/${tableId}/record/${recordId}`).expect(200)).body;
}

export async function createField(
  request: request.SuperAgentTest,
  tableId: string,
  fieldRo: IFieldRo
): Promise<IFieldVo> {
  const result = await request.post(`/api/table/${tableId}/field`).send(fieldRo);
  if (result.status !== 201) {
    console.error(result.body);
  }
  expect(result.status).toEqual(201);
  return result.body;
}

export async function updateField(
  request: request.SuperAgentTest,
  tableId: string,
  fieldId: string,
  fieldRo: IFieldRo
): Promise<IFieldVo> {
  const result = await request.patch(`/api/table/${tableId}/field/${fieldId}`).send(fieldRo);
  if (result.status !== 200) {
    console.error(JSON.stringify(result.body, null, 2));
  }
  expect(result.status).toEqual(200);
  return result.body;
}

export async function getFields(
  request: request.SuperAgentTest,
  tableId: string,
  viewId?: string
): Promise<IFieldVo[]> {
  const result = await request
    .get(`/api/table/${tableId}/field`)
    .query({
      viewId,
    })
    .expect(200);
  return result.body;
}

export async function getField(
  request: request.SuperAgentTest,
  tableId: string,
  fieldId: string
): Promise<IFieldVo> {
  const result = await request.get(`/api/table/${tableId}/field/${fieldId}`).expect(200);
  return result.body;
}

export async function getUserRequest(
  app: INestApplication,
  user: { email: string; password: string }
) {
  const signupRes = await request(app.getHttpServer()).post('/api/auth/signup').send(user);
  let cookie = null;
  if (signupRes.status !== 201) {
    const signinRes = await request(app.getHttpServer())
      .post('/api/auth/signin')
      .send(user)
      .expect(200);
    cookie = signinRes.headers['set-cookie'];
  } else {
    cookie = signupRes.headers['set-cookie'];
  }
  const newRequest = request.agent(app.getHttpServer());
  newRequest.set('Cookie', cookie);
  return newRequest;
}
