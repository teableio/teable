/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  ILinkFieldOptions,
  ITableFullVo,
  IUpdateRecordRo,
} from '@teable-group/core';
import { FieldType, Relationship, NumberFormattingType } from '@teable-group/core';
import type request from 'supertest';
import {
  initApp,
  updateRecordByApi,
  createField,
  getRecords,
  getField,
  deleteRecord,
  getRecord,
} from './utils/init-app';

describe('OpenAPI link (e2e)', () => {
  let app: INestApplication;
  jest.useRealTimers();
  let request: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create table with link field', () => {
    let table1Id: string;
    let table2Id: string;

    afterEach(async () => {
      table1Id && (await request.delete(`/api/base/${baseId}/table/arbitrary/${table1Id}`));
      table2Id && (await request.delete(`/api/base/${baseId}/table/arbitrary/${table2Id}`));
    });

    it('should create foreign link field when create a new table with link field', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      const createTable1Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table1_1' } },
            { fields: { 'text field': 'table1_2' } },
            { fields: { 'text field': 'table1_3' } },
          ],
        })
        .expect(201);

      table1Id = createTable1Result.body.id;

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1Id,
        },
      };

      const createTable2Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table2',
          fields: [textFieldRo, numberFieldRo, linkFieldRo],
          records: [
            { fields: { 'text field': 'table2_1' } },
            { fields: { 'text field': 'table2_2' } },
            { fields: { 'text field': 'table2_3' } },
          ],
        })
        .expect(201);
      table2Id = createTable2Result.body.id;

      const getTable1FieldsResult = await request.get(`/api/table/${table1Id}/field`).expect(200);

      expect(getTable1FieldsResult.body).toHaveLength(3);
      expect(getTable1FieldsResult.body[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2Id,
          lookupFieldId: createTable2Result.body.fields[0].id,
          dbForeignKeyName: '__fk_' + createTable2Result.body.fields[2].id,
          symmetricFieldId: createTable2Result.body.fields[2].id,
        },
      });

      expect(createTable2Result.body.fields[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1Id,
          lookupFieldId: getTable1FieldsResult.body[0].id,
          dbForeignKeyName: '__fk_' + createTable2Result.body.fields[2].id,
          symmetricFieldId: getTable1FieldsResult.body[2].id,
        },
      });
    });

    it('should auto create foreign manyOne link field when create oneMany link field', async () => {
      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const createTable1Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
          fields: [numberFieldRo, textFieldRo],
        })
        .expect(201);
      table1Id = createTable1Result.body.id;

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1Id,
        },
      };

      const createTable2Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table2',
          fields: [numberFieldRo, textFieldRo, linkFieldRo],
        })
        .expect(201);
      table2Id = createTable2Result.body.id;

      const getTable1FieldsResult = await request.get(`/api/table/${table1Id}/field`).expect(200);

      expect(getTable1FieldsResult.body).toHaveLength(3);
      expect(getTable1FieldsResult.body[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2Id,
          lookupFieldId: createTable2Result.body.fields[0].id,
          dbForeignKeyName: '__fk_' + getTable1FieldsResult.body[2].id,
          symmetricFieldId: createTable2Result.body.fields[2].id,
        },
      });

      expect(createTable2Result.body.fields[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1Id,
          lookupFieldId: getTable1FieldsResult.body[0].id,
          dbForeignKeyName: '__fk_' + getTable1FieldsResult.body[2].id,
          symmetricFieldId: getTable1FieldsResult.body[2].id,
        },
      });
    });
  });

  describe('link field cell update', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      const createTable1Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table1_1' } },
            { fields: { 'text field': 'table1_2' } },
            { fields: { 'text field': 'table1_3' } },
          ],
        })
        .expect(201);

      table1 = createTable1Result.body;

      const createTable2Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table2',
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table2_1' } },
            { fields: { 'text field': 'table2_2' } },
            { fields: { 'text field': 'table2_3' } },
          ],
        })
        .expect(201);

      table2 = createTable2Result.body;

      // create link field
      const table2LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
        },
      };

      await createField(request, table2.id, table2LinkFieldRo);

      const getFields1Result = await request.get(`/api/table/${table1.id}/field`).expect(200);
      const getFields2Result = await request.get(`/api/table/${table2.id}/field`).expect(200);

      table1.fields = getFields1Result.body;
      table2.fields = getFields2Result.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table1.id}`);
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table2.id}`);
    });

    it('should update foreign link field when set a new link in to link field cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });

      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[2].id, {
        title: 'table1_2',
        id: table1.records[1].id,
      });

      const table1RecordResult2 = await request.get(`/api/table/${table1.id}/record`).expect(200);

      expect(table1RecordResult2.body.records[0].fields[table1.fields[2].name]).toBeUndefined();
      expect(table1RecordResult2.body.records[1].fields[table1.fields[2].name]).toEqual([
        {
          title: 'table2_1',
          id: table2.records[0].id,
        },
      ]);
    });

    it('should update foreign link field when change lookupField value', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });
      // set text for lookup field
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

      await updateRecordByApi(request, table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      // add an extra link for table1 record1
      await updateRecordByApi(request, table2.id, table2.records[1].id, table2.fields[2].id, {
        title: 'table1_1',
        id: table1.records[0].id,
      });

      const table1RecordResult2 = await request.get(`/api/table/${table1.id}/record`).expect(200);

      expect(table1RecordResult2.body.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: 'B1',
          id: table2.records[0].id,
        },
        {
          title: 'B2',
          id: table2.records[1].id,
        },
      ]);

      await updateRecordByApi(request, table1.id, table1.records[0].id, table1.fields[0].id, 'AX');

      const table2RecordResult2 = await request.get(`/api/table/${table2.id}/record`).expect(200);

      expect(table2RecordResult2.body.records[0].fields[table2.fields[2].name!]).toEqual({
        title: 'AX',
        id: table1.records[0].id,
      });
    });

    it('should update self foreign link with correct title', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });
      // set text for lookup field
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(request, table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      await updateRecordByApi(request, table1.id, table1.records[0].id, table1.fields[2].id, [
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);

      const table1RecordResult2 = await request.get(`/api/table/${table1.id}/record`).expect(200);

      expect(table1RecordResult2.body.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: 'B1',
          id: table2.records[0].id,
        },
        {
          title: 'B2',
          id: table2.records[1].id,
        },
      ]);
    });

    it('should update formula field when change manyOne link cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });

      const table2FormulaFieldRo: IFieldRo = {
        name: 'table2Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${table2.fields[2].id}}`,
        },
      };

      await request
        .post(`/api/table/${table2.id}/field`)
        .send(table2FormulaFieldRo as IFieldRo)
        .expect(201);

      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[2].id, {
        title: 'illegal title',
        id: table1.records[1].id,
      });

      const table1RecordResult = await request.get(`/api/table/${table1.id}/record`).expect(200);

      const table2RecordResult = await request.get(`/api/table/${table2.id}/record`).expect(200);

      expect(table1RecordResult.body.records[0].fields[table1.fields[2].name]).toBeUndefined();

      expect(table1RecordResult.body.records[1].fields[table1.fields[2].name]).toEqual([
        {
          title: 'table2_1',
          id: table2.records[0].id,
        },
      ]);

      expect(table2RecordResult.body.records[0].fields[table2FormulaFieldRo.name!]).toEqual(
        'table1_2'
      );
    });

    it('should update formula field when change oneMany link cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });

      const table1FormulaFieldRo: IFieldRo = {
        name: 'table1 formula field',
        type: FieldType.Formula,
        options: {
          expression: `{${table1.fields[2].id}}`,
        },
      };

      await request
        .post(`/api/table/${table1.id}/field`)
        .send(table1FormulaFieldRo as IFieldRo)
        .expect(201);

      await request
        .put(`/api/table/${table1.id}/record/${table1.records[0].id}`)
        .send({
          record: {
            fields: {
              [table1.fields[2].name]: [
                { title: 'illegal test1', id: table2.records[0].id },
                { title: 'illegal test2', id: table2.records[1].id },
              ],
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      const table1RecordResult = await request.get(`/api/table/${table1.id}/record`).expect(200);

      expect(table1RecordResult.body.records[0].fields[table1.fields[2].name]).toEqual([
        { title: 'table2_1', id: table2.records[0].id },
        { title: 'table2_2', id: table2.records[1].id },
      ]);

      expect(table1RecordResult.body.records[0].fields[table1FormulaFieldRo.name!]).toEqual([
        'table2_1',
        'table2_2',
      ]);
    });
  });

  describe('multi link with depends same field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      const result1 = await request.post(`/api/base/${baseId}/table`).send({
        name: 'table1',
      });
      table1 = result1.body;
      const result2 = await request.post(`/api/base/${baseId}/table`).send({
        name: 'table2',
      });
      table2 = result2.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table1.id}`);
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table2.id}`);
    });

    it('should update many-one record when add both many-one and many-one link', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const oneManyFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // get get a oneManyField involved
      const manyOneField = await createField(request, table1.id, manyOneFieldRo);
      await createField(request, table1.id, oneManyFieldRo);

      await updateRecordByApi(request, table1.id, table1.records[0].id, manyOneField.id, {
        id: table2.records[0].id,
      });

      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'y');

      const { records: table1Records } = await getRecords(request, table1.id);
      expect(table1Records[0].fields[manyOneField.id]).toEqual({
        title: 'y',
        id: table2.records[0].id,
      });
    });

    it('should update one-many record when add both many-one and many-one link', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const oneManyFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // get get a oneManyField involved
      const oneManyField = await createField(request, table1.id, oneManyFieldRo);
      const manyOneField = await createField(request, table1.id, manyOneFieldRo);

      const lookupOneManyField = await createField(request, table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: oneManyField.id,
        },
      });

      const rollupOneManyField = await createField(request, table1.id, {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: oneManyField.id,
        },
      });

      const lookupManyOneField = await createField(request, table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: manyOneField.id,
        },
      });

      const rollupManyOneField = await createField(request, table1.id, {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: manyOneField.id,
        },
      });

      await updateRecordByApi(request, table1.id, table1.records[0].id, oneManyField.id, [
        {
          id: table2.records[0].id,
        },
      ]);

      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'y');

      const { records: table1Records } = await getRecords(request, table1.id);
      expect(table1Records[0].fields[oneManyField.id]).toEqual([
        {
          title: 'y',
          id: table2.records[0].id,
        },
      ]);
      expect(table1Records[0].fields[lookupOneManyField.id]).toEqual(['y']);
      expect(table1Records[0].fields[rollupOneManyField.id]).toEqual(1);
      expect(table1Records[0].fields[lookupManyOneField.id]).toEqual(undefined);
      expect(table1Records[0].fields[rollupManyOneField.id]).toEqual(undefined);
    });
  });

  describe('update link when delete record', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      const result1 = await request.post(`/api/base/${baseId}/table`).send({
        name: 'table1',
      });
      table1 = result1.body;
      const result2 = await request.post(`/api/base/${baseId}/table`).send({
        name: 'table2',
      });
      table2 = result2.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table1.id}`);
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table2.id}`);
    });

    it('should clean single link record when delete a record', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // get get a oneManyField involved
      const manyOneField = await createField(request, table1.id, manyOneFieldRo);
      const symManyOneField = await getField(
        request,
        table2.id,
        (manyOneField.options as ILinkFieldOptions).symmetricFieldId
      );

      await updateRecordByApi(request, table1.id, table1.records[0].id, manyOneField.id, {
        id: table2.records[0].id,
      });

      await deleteRecord(request, table1.id, table1.records[0].id);

      const table2Record = await getRecord(request, table2.id, table2.records[0].id);
      expect(table2Record.fields[symManyOneField.id]).toBeUndefined();
    });

    it('should update single link record when delete a record', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      await updateRecordByApi(request, table1.id, table1.records[0].id, table1.fields[0].id, 'x1');
      await updateRecordByApi(request, table1.id, table1.records[1].id, table1.fields[0].id, 'x2');

      // get get a oneManyField involved
      const manyOneField = await createField(request, table1.id, manyOneFieldRo);
      const symManyOneField = await getField(
        request,
        table2.id,
        (manyOneField.options as ILinkFieldOptions).symmetricFieldId
      );

      await updateRecordByApi(request, table1.id, table1.records[0].id, manyOneField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(request, table1.id, table1.records[1].id, manyOneField.id, {
        id: table2.records[0].id,
      });

      await deleteRecord(request, table1.id, table1.records[0].id);

      const table2Record = await getRecord(request, table2.id, table2.records[0].id);
      expect(table2Record.fields[symManyOneField.id]).toEqual([
        {
          title: 'x2',
          id: table1.records[1].id,
        },
      ]);
    });

    it('should clean multi link record when delete a record', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const oneManyFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // get get a oneManyField involved
      const manyOneField = await createField(request, table1.id, manyOneFieldRo);
      const oneManyField = await createField(request, table1.id, oneManyFieldRo);

      const symManyOneField = await getField(
        request,
        table2.id,
        (manyOneField.options as ILinkFieldOptions).symmetricFieldId
      );
      const symOneManyField = await getField(
        request,
        table2.id,
        (oneManyField.options as ILinkFieldOptions).symmetricFieldId
      );

      await updateRecordByApi(request, table2.id, table2.records[0].id, symOneManyField.id, {
        id: table1.records[0].id,
      });
      await updateRecordByApi(request, table2.id, table2.records[0].id, symManyOneField.id, [
        {
          id: table1.records[0].id,
        },
      ]);

      await deleteRecord(request, table1.id, table1.records[0].id);

      const table2Record = await getRecord(request, table2.id, table2.records[0].id);
      expect(table2Record.fields[symManyOneField.id]).toBeUndefined();
      expect(table2Record.fields[symOneManyField.id]).toBeUndefined();
    });
  });
});
