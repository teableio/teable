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

  it('should response calculate record after create', async () => {
    const numberFieldRo: CreateFieldRo & { id: string } = {
      id: 'fldNumber' + generateFieldId(),
      name: 'Number field',
      description: 'the number field',
      type: FieldType.Number,
      options: {
        precision: 1,
      },
    };

    const textFieldRo: CreateFieldRo & { id: string } = {
      id: 'fldText' + generateFieldId(),
      name: 'text field',
      description: 'the text field',
      type: FieldType.SingleLineText,
    };

    const formulaFieldRo: CreateFieldRo & { id: string } = {
      id: 'fldFormula' + generateFieldId(),
      name: 'New field',
      description: 'the new field',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}} & {${textFieldRo.id}}`,
      },
    };

    await request(app.getHttpServer())
      .post(`/api/table/${table1Id}/field`)
      .send(numberFieldRo)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/table/${table1Id}/field`)
      .send(textFieldRo)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/table/${table1Id}/field`)
      .send(formulaFieldRo)
      .expect(201);

    const recordResult = await request(app.getHttpServer())
      .post(`/api/table/${table1Id}/record`)
      .send({
        records: [
          {
            fields: {
              [numberFieldRo.name]: 1,
              [textFieldRo.name]: 'x',
            },
          },
        ],
      })
      .expect(201);

    const record = recordResult.body.data.records[0];
    expect(record.fields[numberFieldRo.id]).toEqual(1);
    expect(record.fields[textFieldRo.id]).toEqual('x');
    expect(record.fields[formulaFieldRo.id]).toEqual('1x');
  });
});
