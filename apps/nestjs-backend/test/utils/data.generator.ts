import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable-group/core';
import { cloneDeep } from 'lodash';
import request from 'supertest';
import type { CreateFieldRo } from '../../src/features/field/model/create-field.ro';
import type { FieldVo } from '../../src/features/field/model/field.vo';
import { FIELD_MOCK_DATA } from './field-mock';
import { initApp } from './init-app';

jest.setTimeout(1000000);

describe('Performance test data generator', () => {
  let app: INestApplication;
  let tableId = '';
  let fields: FieldVo[] = [];

  beforeAll(async () => {
    app = await initApp();

    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1',
    });
    tableId = result.body.data.id;
    console.log('createTable', result.body);
  });

  function addRecords(count: number) {
    const records = Array.from({ length: count }).map((_, i) => {
      const value = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
        switch (field.type) {
          case FieldType.SingleLineText:
            acc[field.id] = 'New Record' + new Date();
            break;
          case FieldType.Number:
            acc[field.id] = i;
            break;
          case FieldType.SingleSelect:
            acc[field.id] = ['light', 'medium', 'heavy'][i % 3];
            break;
        }
        return acc;
      }, {});
      return { fields: value };
    });

    return request(app.getHttpServer()).post(`/api/table/${tableId}/record`).send({
      fieldKeyType: FieldKeyType.Id,
      records,
    });
  }

  it('/api/table/{tableId}/record (POST) (1000x)', async () => {
    const fieldCount = 20;
    const batchCount = 100;
    const count = 1000;

    for (let i = 0; i < fieldCount; i++) {
      const fieldRo: CreateFieldRo = cloneDeep(FIELD_MOCK_DATA[i % 3]);
      fieldRo.name = 'field' + i;

      await request(app.getHttpServer())
        .post(`/api/table/${tableId}/field`)
        .send(fieldRo)
        .expect(201);
    }

    const fieldsResult = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/field`)
      .expect(200);
    fields = fieldsResult.body.data;

    // await addRecords(1).expect(201).expect({});

    console.time(`create ${count} records`);
    for (let i = 0; i < count / batchCount; i++) {
      await addRecords(batchCount).expect(201);
    }
    console.timeEnd(`create ${count} records`);
    console.log(`new table: ${tableId} created`);
  });
});
