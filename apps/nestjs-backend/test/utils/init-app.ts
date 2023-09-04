import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IFieldRo, IFieldVo, IRecord, IRecordsVo, IUpdateRecordRo } from '@teable-group/core';
import { FieldKeyType } from '@teable-group/core';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { NextService } from '../../src/features/next/next.service';
import { WsGateway } from '../../src/ws/ws.gateway';
import { DevWsGateway } from '../../src/ws/ws.gateway.dev';

export async function initApp() {
  process.env.LOG_LEVEL = 'error';

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

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  await app.listen(0);

  console.log(`> Jest Test NODE_ENV is ${process.env.NODE_ENV}`);
  console.log(`> Jest Test Ready on ${await app.getUrl()}`);
  return app;
}

export async function updateRecordByApi(
  app: INestApplication,
  tableId: string,
  recordId: string,
  fieldId: string,
  newValues: unknown
): Promise<IRecord> {
  return (
    await request(app.getHttpServer())
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
  ).body.data;
}

export async function getRecords(app: INestApplication, tableId: string): Promise<IRecordsVo> {
  return (
    await request(app.getHttpServer())
      .get(`/api/table/${tableId}/record`)
      .query({
        fieldKeyType: FieldKeyType.Id,
      })
      .expect(200)
  ).body.data;
}

export async function getRecord(
  app: INestApplication,
  tableId: string,
  recordId: string
): Promise<IRecord> {
  return (
    await request(app.getHttpServer())
      .get(`/api/table/${tableId}/record/${recordId}`)
      .query({
        fieldKeyType: FieldKeyType.Id,
      })
      .expect(200)
  ).body.data;
}

export async function createField(
  app: INestApplication,
  tableId: string,
  fieldRo: IFieldRo
): Promise<IFieldVo> {
  const result = await request(app.getHttpServer())
    .post(`/api/table/${tableId}/field`)
    .send(fieldRo);
  if (result.status !== 201) {
    console.error(result.body);
  }
  expect(result.status).toEqual(201);
  return result.body.data;
}

export async function updateField(
  app: INestApplication,
  tableId: string,
  fieldId: string,
  fieldRo: IFieldRo
): Promise<IFieldVo> {
  const result = await request(app.getHttpServer())
    .put(`/api/table/${tableId}/field/${fieldId}`)
    .send(fieldRo);
  if (result.status !== 200) {
    console.error(result.body);
  }
  expect(result.status).toEqual(200);
  return result.body.data;
}

export async function getField(
  app: INestApplication,
  tableId: string,
  fieldId: string
): Promise<IFieldVo> {
  const result = await request(app.getHttpServer())
    .get(`/api/table/${tableId}/field/${fieldId}`)
    .expect(200);
  return result.body.data;
}
