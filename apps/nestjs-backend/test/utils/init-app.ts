import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IFieldRo, IFieldVo, IRecord, IRecordsVo, IUpdateRecordRo } from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import type { AuthSchema } from '@teable-group/openapi';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import isCI from 'is-ci';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { NextService } from '../../src/features/next/next.service';
import { WsGateway } from '../../src/ws/ws.gateway';
import { DevWsGateway } from '../../src/ws/ws.gateway.dev';

export async function initApp() {
  isCI && (process.env.LOG_LEVEL = 'error');

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
  return { app, request: newRequest };
}

export async function signin(app: INestApplication, email: string, password: string) {
  const sessionResponse = await request(app.getHttpServer())
    .post('/api/auth/signin')
    .send({
      email,
      password,
    } as AuthSchema.Signin)
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
  newValues: unknown
): Promise<IRecord> {
  return (
    await request
      .put(`/api/table/${tableId}/record/${recordId}`)
      .send({
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [fieldId]: newValues,
          },
        },
      } as IUpdateRecordRo)
      .expect(200)
  ).body;
}

export async function getRecords(
  request: request.SuperAgentTest,
  tableId: string
): Promise<IRecordsVo> {
  return (
    await request
      .get(`/api/table/${tableId}/record`)
      .query({
        fieldKeyType: FieldKeyType.Id,
      })
      .expect(200)
  ).body;
}

export async function getRecord(
  request: request.SuperAgentTest,
  tableId: string,
  recordId: string
): Promise<IRecord> {
  return (
    await request
      .get(`/api/table/${tableId}/record/${recordId}`)
      .query({
        fieldKeyType: FieldKeyType.Id,
      })
      .expect(200)
  ).body;
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
  const result = await request.put(`/api/table/${tableId}/field/${fieldId}`).send(fieldRo);
  if (result.status !== 200) {
    console.error(JSON.stringify(result.body, null, 2));
  }
  expect(result.status).toEqual(200);
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
