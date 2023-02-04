import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType } from '@teable-group/core';
import request from 'supertest';
import type { FieldVo } from '../src/features/field/open-api/field.vo';
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
    await app.init();

    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1',
    });
    tableId = result.body.id;

    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/field`);
    fields = fieldsResult.body;
    console.log('fields: ', fields);
  });

  afterAll(async () => {
    const result = await request(app.getHttpServer()).delete(`/api/table/arbitrary/${tableId}`);
    console.log('clear table: ', result.body);
  });

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
  });
});
