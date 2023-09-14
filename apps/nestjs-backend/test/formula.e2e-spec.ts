import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptionsRo, ITableFullVo } from '@teable-group/core';
import { Relationship, FieldType, generateFieldId } from '@teable-group/core';
import type request from 'supertest';
import { initApp, createField } from './utils/init-app';

describe('OpenAPI formula (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let numberFieldRo: IFieldRo & { id: string; name: string };
  let textFieldRo: IFieldRo & { id: string; name: string };
  let formulaFieldRo: IFieldRo & { id: string; name: string };
  let request: request.SuperAgentTest;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    numberFieldRo = {
      id: generateFieldId(),
      name: 'Number field',
      description: 'the number field',
      type: FieldType.Number,
      options: {
        formatting: { precision: 1 },
      },
    };

    textFieldRo = {
      id: generateFieldId(),
      name: 'text field',
      description: 'the text field',
      type: FieldType.SingleLineText,
    };

    formulaFieldRo = {
      id: generateFieldId(),
      name: 'New field',
      description: 'the new field',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}} & {${textFieldRo.id}}`,
      },
    };

    const result1 = await request
      .post('/api/table')
      .send({
        name: 'table1',
        fields: [numberFieldRo, textFieldRo, formulaFieldRo],
      })
      .expect(201);
    table1Id = result1.body.id;
  });

  afterEach(async () => {
    await request.delete(`/api/table/arbitrary/${table1Id}`);
  });

  it('should response calculate record after create', async () => {
    const recordResult = await request
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

    const record = recordResult.body.records[0];
    expect(record.fields[numberFieldRo.name]).toEqual(1);
    expect(record.fields[textFieldRo.name]).toEqual('x');
    expect(record.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should response calculate record after update multi record field', async () => {
    const getResult = await request.get(`/api/table/${table1Id}/record`).expect(200);

    const existRecord = getResult.body.records[0];

    const updateResult = await request
      .put(`/api/table/${table1Id}/record/${existRecord.id}`)
      .send({
        record: {
          fields: {
            [numberFieldRo.name]: 1,
            [textFieldRo.name]: 'x',
          },
        },
      })
      .expect(200);

    const record = updateResult.body;

    expect(record.fields[numberFieldRo.name]).toEqual(1);
    expect(record.fields[textFieldRo.name]).toEqual('x');
    expect(record.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should response calculate record after update single record field', async () => {
    const getResult = await request.get(`/api/table/${table1Id}/record`).expect(200);

    const existRecord = getResult.body.records[0];

    const updateResult1 = await request
      .put(`/api/table/${table1Id}/record/${existRecord.id}`)
      .send({
        record: {
          fields: {
            [numberFieldRo.name]: 1,
          },
        },
      })
      .expect(200);

    const record1 = updateResult1.body;

    expect(record1.fields[numberFieldRo.name]).toEqual(1);
    expect(record1.fields[textFieldRo.name]).toBeUndefined();
    expect(record1.fields[formulaFieldRo.name]).toEqual('1');

    const updateResult2 = await request
      .put(`/api/table/${table1Id}/record/${existRecord.id}`)
      .send({
        record: {
          fields: {
            [textFieldRo.name]: 'x',
          },
        },
      })
      .expect(200);

    const record2 = updateResult2.body;

    expect(record2.fields[numberFieldRo.name]).toEqual(1);
    expect(record2.fields[textFieldRo.name]).toEqual('x');
    expect(record2.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should calculate primary field when have link relationship', async () => {
    const result2 = await request.post('/api/table').expect(201);
    const table2: ITableFullVo = result2.body;
    const linkFieldRo: IFieldRo = {
      type: FieldType.Link,
      options: {
        foreignTableId: table2.id,
        relationship: Relationship.ManyOne,
      } as ILinkFieldOptionsRo,
    };

    const formulaFieldRo: IFieldRo = {
      type: FieldType.Formula,
      options: {
        expression: `{${table2.fields[0].id}}`,
      },
    };

    await createField(request, table1Id, linkFieldRo);

    const formulaField = await createField(request, table2.id, formulaFieldRo);

    console.log('----------------------');
    const updateResult1 = await request
      .put(`/api/table/${table2.id}/record/${table2.records[0].id}`)
      .send({
        record: {
          fields: {
            [table2.fields[0].name]: 'text',
          },
        },
      })
      .expect(200);

    const record1 = updateResult1.body;
    expect(record1.fields[formulaField.name]).toEqual('text');
  });
});
