/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable-group/core';
import request from 'supertest';
import type { CreateFieldRo } from '../src/features/field/model/create-field.ro';
import type { UpdateRecordRo } from '../src/features/record/update-record.ro';
import { initApp } from './init-app';

describe('OpenAPI link (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let table2Id = '';
  jest.useRealTimers();
  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  beforeAll(async () => {
    app = await initApp();
  });

  afterAll(async () => {
    app.close();
  });

  afterEach(async () => {
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table1Id}`);
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table2Id}`);
  });

  describe('create table with link field', () => {
    it('should create foreign link field when create a new table with link field', async () => {
      const numberFieldRo: CreateFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          precision: 1,
        },
      };

      const textFieldRo: CreateFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const createTable1Result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table1',
          fields: [numberFieldRo, textFieldRo],
        })
        .expect(201);

      table1Id = createTable1Result.body.data.id;
      console.log('createTable1Result:', createTable1Result.body.data);

      const linkFieldRo: CreateFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1Id,
        },
      };

      const createTable2Result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table2',
          fields: [numberFieldRo, textFieldRo, linkFieldRo],
        })
        .expect(201);
      table2Id = createTable2Result.body.data.id;

      const getTable1FieldsResult = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/field`)
        .expect(200);

      expect(getTable1FieldsResult.body.data).toHaveLength(3);
      expect(getTable1FieldsResult.body.data[2]).toMatchObject({
        name: 'table1',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2Id,
          lookupFieldId: createTable2Result.body.data.fields[0].id,
          dbForeignKeyName: '__fk_' + createTable2Result.body.data.fields[2].id,
          symmetricFieldId: createTable2Result.body.data.fields[2].id,
        },
      });

      expect(createTable2Result.body.data.fields[2]).toMatchObject({
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1Id,
          lookupFieldId: getTable1FieldsResult.body.data[0].id,
          dbForeignKeyName: '__fk_' + createTable2Result.body.data.fields[2].id,
          symmetricFieldId: getTable1FieldsResult.body.data[2].id,
        },
      });
    });

    it('should auto create foreign manyOne link field when create oneMany link field', async () => {
      const numberFieldRo: CreateFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          precision: 1,
        },
      };

      const textFieldRo: CreateFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const createTable1Result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table1',
          fields: [numberFieldRo, textFieldRo],
        })
        .expect(201);
      table1Id = createTable1Result.body.data.id;
      console.log('createTable1Result:', createTable1Result.body.data);

      const linkFieldRo: CreateFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1Id,
        },
      };

      const createTable2Result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table2',
          fields: [numberFieldRo, textFieldRo, linkFieldRo],
        })
        .expect(201);
      table2Id = createTable2Result.body.data.id;

      const getTable1FieldsResult = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/field`)
        .expect(200);

      expect(getTable1FieldsResult.body.data).toHaveLength(3);
      expect(getTable1FieldsResult.body.data[2]).toMatchObject({
        name: 'table1',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2Id,
          lookupFieldId: createTable2Result.body.data.fields[0].id,
          dbForeignKeyName: '__fk_' + getTable1FieldsResult.body.data[2].id,
          symmetricFieldId: createTable2Result.body.data.fields[2].id,
        },
      });

      expect(createTable2Result.body.data.fields[2]).toMatchObject({
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1Id,
          lookupFieldId: getTable1FieldsResult.body.data[0].id,
          dbForeignKeyName: '__fk_' + getTable1FieldsResult.body.data[2].id,
          symmetricFieldId: getTable1FieldsResult.body.data[2].id,
        },
      });
    });
  });

  describe('link field cell update', () => {
    it('should update foreign link field when set a new link in to link field cell', async () => {
      const numberFieldRo: CreateFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          precision: 1,
        },
      };

      const textFieldRo: CreateFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const createTable1Result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table1',
          fields: [numberFieldRo, textFieldRo],
        })
        .expect(201);

      table1Id = createTable1Result.body.data.id;
      const table1Records = createTable1Result.body.data.data.records;

      const linkFieldRo: CreateFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1Id,
        },
      };

      const createTable2Result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table2',
          fields: [numberFieldRo, textFieldRo, linkFieldRo],
        })
        .expect(201);
      const linkToRecordId = table1Records[0].id;
      table2Id = createTable2Result.body.data.id;

      const getFields1Result = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/field`)
        .expect(200);

      const linkField = getFields1Result.body.data[2];
      const table2Records = createTable2Result.body.data.data.records;
      const table2RecordResult = await request(app.getHttpServer())
        .put(`/api/table/${table2Id}/record/${table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [linkFieldRo.name]: { title: 'test', id: linkToRecordId },
            },
          },
        } as UpdateRecordRo)
        .expect(200);

      // FIXME: wait transaction complete
      await sleep(100);
      console.log('linkToRecordId:', linkToRecordId);
      console.log('table2RecordResult:', table2RecordResult.body.data.record.fields);
      console.log(`/api/table/${table1Id}/record/${linkToRecordId}`);
      const table1RecordResult = await request(app.getHttpServer())
        .get(`/api/table/${table1Id}/record/${linkToRecordId}`)
        .expect(200);

      console.log('table1RecordResult:', table1RecordResult.body.data);
      console.log('linkField.name:', linkField.name);
      expect(table1RecordResult.body.data.record.fields[linkField.name]).toEqual([
        {
          id: table2Records[0].id,
        },
      ]);
    });
  });
});
