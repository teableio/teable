import type { INestApplication } from '@nestjs/common';
import { FieldType, generateFieldId } from '@teable-group/core';
import request from 'supertest';
import type { CreateFieldRo } from '../src/features/field/model/create-field.ro';
import { initApp } from './init-app';

describe('OpenAPI formula (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';

  beforeAll(async () => {
    app = await initApp();

    const result1 = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1',
    });
    table1Id = result1.body.data.id;
  });

  afterAll(async () => {
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table1Id}`);
  });

  it('/api/table/{tableId}/field (POST)', async () => {
    const numberFieldRo: CreateFieldRo & { id: string } = {
      id: 'fldNumber' + generateFieldId(),
      name: 'Number field',
      description: 'the number field',
      type: FieldType.Number,
      options: {
        precision: 1,
      },
    };

    const formulaFieldRo: CreateFieldRo & { id: string } = {
      id: 'fldFormula' + generateFieldId(),
      name: 'New field',
      description: 'the new field',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}}`,
      },
    };

    const result1 = await request(app.getHttpServer())
      .post(`/api/table/${table1Id}/field`)
      .send(numberFieldRo)
      .expect(201);
    const field1 = result1.body.data;

    const result2 = await request(app.getHttpServer())
      .post(`/api/table/${table1Id}/field`)
      .send(formulaFieldRo)
      .expect(201);

    const field2 = result2.body.data;

    const recordResult = await request(app.getHttpServer())
      .post(`/api/table/${table1Id}/record`)
      .send({
        records: [
          {
            fields: {
              [field1.name]: 1,
            },
          },
        ],
      })
      .expect(201);

    const record = recordResult.body.data[0].record;
    expect(record.fields[field1.id]).toEqual(1);
    expect(record.fields[field2.id]).toEqual(1);
  });
});
