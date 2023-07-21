import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable-group/core';
import { SingleLineTextFieldCore, FieldType } from '@teable-group/core';
import request from 'supertest';
import { initApp } from './utils/init-app';

describe('OpenAPI FieldController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';

  beforeAll(async () => {
    app = await initApp();

    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1',
    });
    tableId = result.body.data.id;
  });

  afterAll(async () => {
    const result = await request(app.getHttpServer()).delete(`/api/table/arbitrary/${tableId}`);
    console.log('clear table: ', result.body);
  });

  it('/api/table/{tableId}/field (GET)', async () => {
    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/field`);
    expect(fieldsResult.body.data).toHaveLength(3);
  });

  it('/api/table/{tableId}/field (POST)', async () => {
    const fieldRo: IFieldRo = {
      name: 'New field',
      description: 'the new field',
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
    };

    await request(app.getHttpServer())
      .post(`/api/table/${tableId}/field`)
      .send(fieldRo)
      .expect(201);

    const result = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/field`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);

    const fields: IFieldVo[] = result.body.data;
    expect(fields).toHaveLength(4);
    // console.log('result: ', result.body);
  });
});
