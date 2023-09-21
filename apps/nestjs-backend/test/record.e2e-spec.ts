/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  ICreateRecordsRo,
  ITableFullVo,
  IUpdateRecordByIndexRo,
  IUpdateRecordRo,
} from '@teable-group/core';
import { FieldKeyType, FieldType } from '@teable-group/core';
import type request from 'supertest';
import { initApp, updateRecordByApi } from './utils/init-app';

describe('OpenAPI RecordController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let request: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  beforeEach(async () => {
    const result = await request
      .post(`/api/base/${baseId}/table`)
      .send({
        name: 'table1',
      })
      .expect(201);
    table = result.body;
  });

  afterEach(async () => {
    const result = await request.delete(`/api/base/${baseId}/table/arbitrary/${table.id}`);
    console.log('clear table: ', result.body);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/table/{tableId}/record (GET)', async () => {
    const result = await request.get(`/api/table/${table.id}/record`).expect(200);
    expect(result.body.records).toBeInstanceOf(Array);
    // console.log('result: ', result.body);
  });

  it('/api/table/{tableId}/record (POST)', async () => {
    const value1 = 'New Record' + new Date();
    const res1 = await request
      .post(`/api/table/${table.id}/record`)
      .send({
        records: [
          {
            fields: {
              [table.fields[0].name]: value1,
            },
          },
        ],
      })
      .expect(201);
    expect(res1.body.records[0].fields[table.fields[0].name]).toEqual(value1);

    const result = await request
      .get(`/api/table/${table.id}/record`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);
    expect(result.body.records).toHaveLength(4);

    const value2 = 'New Record' + new Date();
    // test fieldKeyType is id
    const res2 = await request
      .post(`/api/table/${table.id}/record`)
      .send({
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [table.fields[0].id]: value2,
            },
          },
        ],
      } as ICreateRecordsRo)
      .expect(201);

    expect(res2.body.records[0].fields[table.fields[0].id]).toEqual(value2);
  });

  it('/api/table/{tableId}/record/{recordId} (PUT)', async () => {
    const record = await updateRecordByApi(
      request,
      table.id,
      table.records[0].id,
      table.fields[0].id,
      'new value'
    );

    expect(record.fields[table.fields[0].id]).toEqual('new value');

    const result = await request
      .get(`/api/table/${table.id}/record`)
      .query({
        skip: 0,
        take: 1000,
      })
      .expect(200);
    expect(result.body.records).toHaveLength(3);
    expect(result.body.records[0].fields[table.fields[0].name]).toEqual('new value');
  });

  it('/api/table/{tableId}/record by index (PUT)', async () => {
    const viewResponse = await request.get(`/api/table/${table.id}/view`).expect(200);

    const firstTextField = table.fields.find((field) => field.type === FieldType.SingleLineText);
    if (!firstTextField) {
      throw new Error('can not find text field');
    }

    await request
      .put(`/api/table/${table.id}/record`)
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
      .get(`/api/table/${table.id}/record`)
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
        [table.fields[0].name]: 'New Record' + new Date(),
        [table.fields[1].name]: i,
        [table.fields[2].name]: 'light',
      },
    }));

    await request
      .post(`/api/table/${table.id}/record`)
      .send({
        records,
      })
      .expect(201);

    console.timeEnd(`create ${count} records`);
  });
});
