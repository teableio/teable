/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  IRecord,
  ITableFullVo,
  IUpdateRecordRo,
} from '@teable-group/core';
import { FieldType, Relationship } from '@teable-group/core';
import type request from 'supertest';
import type { LinkFieldDto } from '../src/features/field/model/field-dto/link-field.dto';
import { initApp, updateRecordByApi, createField, getRecords } from './utils/init-app';

describe('OpenAPI link (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let table2Id = '';
  jest.useRealTimers();
  let request: request.SuperAgentTest;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    table1Id && (await request.delete(`/api/table/arbitrary/${table1Id}`));
    table2Id && (await request.delete(`/api/table/arbitrary/${table2Id}`));
  });

  describe('create table with link field', () => {
    it('should create foreign link field when create a new table with link field', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { precision: 1 },
        },
      };

      const createTable1Result = await request
        .post('/api/table')
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
        .post('/api/table')
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
          formatting: { precision: 1 },
        },
      };

      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const createTable1Result = await request
        .post('/api/table')
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
        .post('/api/table')
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
    let ctx: {
      numberFieldRo: IFieldRo;
      textFieldRo: IFieldRo;
      table1Records: IRecord[];
      table1Fields: IFieldVo[];
      table1linkField: LinkFieldDto;
      table2LinkFieldRo: IFieldRo;
      table2Id: string;
      table2Records: IRecord[];
      table2Fields: IFieldVo[];
    } = {} as any;
    beforeEach(async () => {
      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { precision: 1 },
        },
      };

      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const createTable1Result = await request
        .post('/api/table')
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
      const table1Records = createTable1Result.body.records;

      const table2LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1Id,
        },
      };

      // table2 link manyOne table1
      const createTable2Result = await request
        .post('/api/table')
        .send({
          name: 'table2',
          fields: [textFieldRo, numberFieldRo, table2LinkFieldRo],
          records: [
            { fields: { 'text field': 'table2_1' } },
            { fields: { 'text field': 'table2_2' } },
            { fields: { 'text field': 'table2_3' } },
          ],
        })
        .expect(201);

      const linkToRecordId = table1Records[0].id;
      table2Id = createTable2Result.body.id;

      const getFields1Result = await request.get(`/api/table/${table1Id}/field`).expect(200);

      const table1linkField = getFields1Result.body[2];
      const table1Fields = getFields1Result.body;

      const table2Records = createTable2Result.body.records;
      const table2Fields = createTable2Result.body.fields;
      // table2 link field first record link to table1 first record
      await request
        .put(`/api/table/${table2Id}/record/${table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [table2LinkFieldRo.name!]: { title: 'test', id: linkToRecordId },
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      const table1RecordResult = await request
        .get(`/api/table/${table1Id}/record/${linkToRecordId}`)
        .expect(200);

      expect(table1RecordResult.body.fields[table1linkField.name]).toEqual([
        {
          title: 'table2_1',
          id: table2Records[0].id,
        },
      ]);

      ctx = {
        numberFieldRo,
        textFieldRo,
        table2LinkFieldRo,
        table1linkField,
        table1Records,
        table1Fields,
        table2Id,
        table2Records,
        table2Fields,
      };
    });

    it('should update foreign link field when set a new link in to link field cell', async () => {
      await request
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.table2LinkFieldRo.name!]: { title: 'table1_2', id: ctx.table1Records[1].id },
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      const table1RecordResult2 = await request.get(`/api/table/${table1Id}/record`).expect(200);

      expect(table1RecordResult2.body.records[0].fields[ctx.table1linkField.name]).toBeUndefined();
      expect(table1RecordResult2.body.records[1].fields[ctx.table1linkField.name]).toEqual([
        {
          title: 'table2_1',
          id: ctx.table2Records[0].id,
        },
      ]);
    });

    it('should update foreign link field when change lookupField value', async () => {
      // set text for lookup field
      await request
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name!]: 'B1',
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      await request
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[1].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name!]: 'B2',
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      // add an extra link for table1 record1
      await request
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[1].id}`)
        .send({
          record: {
            fields: {
              [ctx.table2LinkFieldRo.name!]: { title: 'table1_1', id: ctx.table1Records[0].id },
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      const table1RecordResult2 = await request.get(`/api/table/${table1Id}/record`).expect(200);

      expect(table1RecordResult2.body.records[0].fields[ctx.table1linkField.name]).toEqual([
        {
          title: 'B1',
          id: ctx.table2Records[0].id,
        },
        {
          title: 'B2',
          id: ctx.table2Records[1].id,
        },
      ]);

      await request
        .put(`/api/table/${table1Id}/record/${ctx.table1Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name!]: 'AX',
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      const table2RecordResult2 = await request.get(`/api/table/${table2Id}/record`).expect(200);

      expect(table2RecordResult2.body.records[0].fields[ctx.table2LinkFieldRo.name!]).toEqual({
        title: 'AX',
        id: ctx.table1Records[0].id,
      });
    });

    it('should update self foreign link with correct title', async () => {
      // set text for lookup field
      await request
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name!]: 'B1',
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      await request
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[1].id}`)
        .send({
          record: {
            fields: {
              [ctx.textFieldRo.name!]: 'B2',
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      await request
        .put(`/api/table/${table1Id}/record/${ctx.table1Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.table1linkField.name]: [
                { title: 'B1', id: ctx.table2Records[0].id },
                { title: 'B2', id: ctx.table2Records[1].id },
              ],
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      const table1RecordResult2 = await request.get(`/api/table/${table1Id}/record`).expect(200);

      expect(table1RecordResult2.body.records[0].fields[ctx.table1linkField.name]).toEqual([
        {
          title: 'B1',
          id: ctx.table2Records[0].id,
        },
        {
          title: 'B2',
          id: ctx.table2Records[1].id,
        },
      ]);
    });

    it('should update formula field when change manyOne link cell', async () => {
      const table2FormulaFieldRo: IFieldRo = {
        name: 'table2Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${ctx.table2Fields[2].id}}`,
        },
      };

      await request
        .post(`/api/table/${table2Id}/field`)
        .send(table2FormulaFieldRo as IFieldRo)
        .expect(201);
      await request
        .put(`/api/table/${table2Id}/record/${ctx.table2Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.table2LinkFieldRo.name!]: {
                title: 'illegal title',
                id: ctx.table1Records[1].id,
              },
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      const table1RecordResult = await request.get(`/api/table/${table1Id}/record`).expect(200);

      const table2RecordResult = await request.get(`/api/table/${table2Id}/record`).expect(200);

      expect(table1RecordResult.body.records[0].fields[ctx.table1linkField.name]).toBeUndefined();

      expect(table1RecordResult.body.records[1].fields[ctx.table1linkField.name]).toEqual([
        {
          title: 'table2_1',
          id: ctx.table2Records[0].id,
        },
      ]);

      expect(table2RecordResult.body.records[0].fields[table2FormulaFieldRo.name!]).toEqual(
        'table1_2'
      );
    });

    it('should update formula field when change oneMany link cell', async () => {
      const table1FormulaFieldRo: IFieldRo = {
        name: 'table1 formula field',
        type: FieldType.Formula,
        options: {
          expression: `{${ctx.table1linkField.id}}`,
        },
      };

      await request
        .post(`/api/table/${table1Id}/field`)
        .send(table1FormulaFieldRo as IFieldRo)
        .expect(201);

      await request
        .put(`/api/table/${table1Id}/record/${ctx.table1Records[0].id}`)
        .send({
          record: {
            fields: {
              [ctx.table1linkField.name]: [
                { title: 'illegal test1', id: ctx.table2Records[0].id },
                { title: 'illegal test2', id: ctx.table2Records[1].id },
              ],
            },
          },
        } as IUpdateRecordRo)
        .expect(200);

      const table1RecordResult = await request.get(`/api/table/${table1Id}/record`).expect(200);

      expect(table1RecordResult.body.records[0].fields[ctx.table1linkField.name]).toEqual([
        { title: 'table2_1', id: ctx.table2Records[0].id },
        { title: 'table2_2', id: ctx.table2Records[1].id },
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
      const result1 = await request.post('/api/table').send({
        name: 'table1',
      });
      table1 = result1.body;
      table1Id = table1.id;
      const result2 = await request.post('/api/table').send({
        name: 'table2',
      });
      table2 = result2.body;
      table2Id = table2.id;
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
});
