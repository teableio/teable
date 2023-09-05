import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable-group/core';
import { FieldType, Relationship } from '@teable-group/core';
import type request from 'supertest';
import { initApp } from './utils/init-app';

describe('OpenAPI link field reference (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let table2Id = '';
  let request: request.SuperAgentTest;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;

    const result1 = await request.post('/api/table').send({
      name: 'table1',
    });
    table1Id = result1.body.id;
    const result2 = await request.post('/api/table').send({
      name: 'table2',
    });
    table2Id = result2.body.id;
  });

  afterAll(async () => {
    await request.delete(`/api/table/arbitrary/${table1Id}`);
    await request.delete(`/api/table/arbitrary/${table2Id}`);

    await app.close();
  });

  it('/api/table/{tableId}/field (POST) create ManyOne', async () => {
    const fieldRo: IFieldRo = {
      name: 'New field',
      description: 'the new field',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: table2Id,
      },
    };

    const result1 = await request.post(`/api/table/${table1Id}/field`).send(fieldRo).expect(201);
    const field1 = result1.body;

    const result2 = await request
      .get(`/api/table/${table2Id}/field/${field1.options.symmetricFieldId}`)
      .expect(200);

    const field2 = result2.body;
    expect(field1.options.foreignTableId).toBe(table2Id);
    expect(field1.options.symmetricFieldId).toBe(field2.id);
    expect(field2.options.relationship).toBe(Relationship.OneMany);
    expect(field2.options.foreignTableId).toBe(table1Id);
    expect(field2.options.symmetricFieldId).toBe(field1.id);
    expect(field1.options.dbForeignKeyName).toBe(`__fk_${field1.id}`);
    expect(field2.options.dbForeignKeyName).toBe(`__fk_${field1.id}`);
  });

  it('/api/table/{tableId}/field (POST) create OneMany', async () => {
    const fieldRo: IFieldRo = {
      name: 'New field',
      description: 'the new field',
      type: FieldType.Link,
      options: {
        relationship: Relationship.OneMany,
        foreignTableId: table2Id,
      },
    };

    const result1 = await request.post(`/api/table/${table1Id}/field`).send(fieldRo).expect(201);
    const field1 = result1.body;

    const result2 = await request
      .get(`/api/table/${table2Id}/field/${field1.options.symmetricFieldId}`)
      .expect(200);

    const field2 = result2.body;
    expect(field1.options.foreignTableId).toBe(table2Id);
    expect(field1.options.symmetricFieldId).toBe(field2.id);
    expect(field2.options.relationship).toBe(Relationship.ManyOne);
    expect(field2.options.foreignTableId).toBe(table1Id);
    expect(field2.options.symmetricFieldId).toBe(field1.id);
    expect(field1.options.dbForeignKeyName).toBe(`__fk_${field2.id}`);
    expect(field2.options.dbForeignKeyName).toBe(`__fk_${field2.id}`);
  });
});
