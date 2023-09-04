/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  ICreateRecordsRo,
  IFieldVo,
  IUpdateRecordByIndexRo,
  IUpdateRecordRo,
  IRecord,
} from '@teable-group/core';
import { FieldKeyType, FieldType } from '@teable-group/core';
import qs from 'qs';
import type request from 'supertest';
import { initApp } from './utils/init-app';

describe('OpenAPI RecordController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';
  let fields: IFieldVo[] = [];
  let request: request.SuperAgentTest;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  beforeEach(async () => {
    const result = await request
      .post('/api/table')
      .send({
        name: 'table1',
      })
      .expect(201);
    tableId = result.body.id;

    const fieldsResult = await request.get(`/api/table/${tableId}/field`).expect(200);
    fields = fieldsResult.body;
  });

  afterEach(async () => {
    const result = await request.delete(`/api/table/arbitrary/${tableId}`);
    console.log('clear table: ', result.body);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/table/{tableId}/record (GET)', async () => {
    const result = await request.get(`/api/table/${tableId}/record`).expect(200);
    expect(result.body.records).toBeInstanceOf(Array);
    // console.log('result: ', result.body);
  });

  it('/api/table/{tableId}/record (POST)', async () => {
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText);
    if (!firstTextField) {
      throw new Error('can not find text field');
    }

    await request
      .post(`/api/table/${tableId}/record`)
      .send({
        records: [
          {
            fields: {
              [firstTextField.name]: 'New Record' + new Date(),
            },
          },
        ],
      })
      .expect(201);

    const result = await request
      .get(`/api/table/${tableId}/record`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);
    expect(result.body.records).toHaveLength(4);

    const newValue = 'New Record' + new Date();
    // test fieldKeyType is id
    const response = await request
      .post(`/api/table/${tableId}/record`)
      .send({
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [firstTextField.id]: newValue,
            },
          },
        ],
      } as ICreateRecordsRo)
      .expect(201);

    expect(response.body.records[0].fields[firstTextField.id]).toEqual(newValue);
  });

  it('/api/table/{tableId}/record/{recordId} (PUT)', async () => {
    const recordsResponse = await request.get(`/api/table/${tableId}/record`).expect(200);

    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText);
    if (!firstTextField) {
      throw new Error('can not find text field');
    }

    const response = await request
      .put(`/api/table/${tableId}/record/${recordsResponse.body.records[0].id}`)
      .send({
        record: {
          fields: {
            [firstTextField.name]: 'new value',
          },
        },
      } as IUpdateRecordRo)
      .expect(200);

    expect(response.body.fields[firstTextField.name]).toEqual('new value');

    const result = await request
      .get(`/api/table/${tableId}/record`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);
    expect(result.body.records).toHaveLength(3);
    expect(result.body.records[0].fields[firstTextField.name]).toEqual('new value');
  });

  it('/api/table/{tableId}/record by index (PUT)', async () => {
    const viewResponse = await request.get(`/api/table/${tableId}/view`).expect(200);

    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText);
    if (!firstTextField) {
      throw new Error('can not find text field');
    }

    await request
      .put(`/api/table/${tableId}/record`)
      .send({
        viewId: viewResponse.body[0].id,
        index: 1,
        record: {
          fields: {
            [firstTextField.name]: 'new value',
          },
        },
      } as IUpdateRecordByIndexRo)
      .expect(200);

    const result = await request
      .get(`/api/table/${tableId}/record`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);
    expect(result.body.records).toHaveLength(3);
    expect(result.body.records[1].fields[firstTextField.name]).toEqual('new value');
  });

  it('/api/table/{tableId}/record (POST) (100x)', async () => {
    const count = 100;
    console.time(`create ${count} records`);
    const records = Array.from({ length: count }).map((_, i) => ({
      fields: {
        [fields[0].name]: 'New Record' + new Date(),
        [fields[1].name]: i,
        [fields[2].name]: 'light',
      },
    }));

    await request
      .post(`/api/table/${tableId}/record`)
      .send({
        records,
      })
      .expect(201);

    console.timeEnd(`create ${count} records`);
  });
});
