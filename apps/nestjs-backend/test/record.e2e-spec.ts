import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType } from '@teable-group/core';
import { json, urlencoded } from 'express';
import request from 'supertest';
import type { FieldVo } from '../src/features/field/model/field.vo';
import { TableModule } from '../src/features/table/table.module';

describe('OpenAPI RecordController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';
  let fields: FieldVo[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TableModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(json({ limit: '50mb' }));
    app.use(urlencoded({ limit: '50mb', extended: true }));
    await app.init();

    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1',
    });
    tableId = result.body.id;

    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/field`);
    fields = fieldsResult.body;
    console.log('fields: ', fields);
  });

  // afterAll(async () => {
  //   const result = await request(app.getHttpServer()).delete(`/api/table/arbitrary/${tableId}`);
  //   console.log('clear table: ', result.body);
  // });

  it('/api/table/{tableId}/record (GET)', async () => {
    const result = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/record`)
      .expect(200);
    expect(result.body).toBeInstanceOf(Array);
    console.log('result: ', result.body);
  });

  it('/api/table/{tableId}/record (POST)', async () => {
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText);
    if (!firstTextField) {
      throw new Error('can not find text field');
    }

    await request(app.getHttpServer())
      .post(`/api/table/${tableId}/record`)
      .send({
        records: [
          {
            fields: {
              [firstTextField.id]: 'New Record' + new Date(),
            },
          },
        ],
      })
      .expect(201)
      .expect({});

    const result = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/record`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);
    expect(result.body).toHaveLength(4);
    console.log('result: ', result.body);
  });

  it('/api/table/{tableId}/record (POST) (1000x)', async () => {
    const count = 1000;
    console.time(`create ${count} records`);
    const records = Array.from({ length: count }).map((_, i) => ({
      fields: {
        [fields[0].id]: 'New Record' + new Date(),
        [fields[1].id]: i,
        [fields[2].id]: 'light',
      },
    }));

    await request(app.getHttpServer())
      .post(`/api/table/${tableId}/record`)
      .send({
        records,
      })
      .expect(201)
      .expect({});
    console.timeEnd(`create ${count} records`);
  });
});
