/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ISelectFieldOptions } from '@teable/core';
import { CellFormat, DriverClient, FieldKeyType, FieldType, Relationship } from '@teable/core';
import { updateRecords, type ITableFullVo } from '@teable/openapi';
import {
  convertField,
  createField,
  createRecords,
  createTable,
  deleteField,
  deleteRecord,
  deleteRecords,
  permanentDeleteTable,
  duplicateRecord,
  getField,
  getRecord,
  getRecords,
  initApp,
  updateRecord,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI RecordController (e2e)', () => {
  let app: INestApplication;

  const baseId = globalThis.testConfig.baseId;
  const userId = globalThis.testConfig.userId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('simple curd', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      table = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should get records', async () => {
      const result = await getRecords(table.id);
      expect(result.records).toBeInstanceOf(Array);
    });

    it('should get string records', async () => {
      const createdRecord = await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[0].id]: 'text value',
              [table.fields[1].id]: 123,
            },
          },
        ],
      });

      const { records } = await getRecords(table.id, {
        cellFormat: CellFormat.Text,
        fieldKeyType: FieldKeyType.Id,
      });
      expect(records[3].fields[table.fields[0].id]).toEqual('text value');
      expect(records[3].fields[table.fields[1].id]).toEqual('123.00');

      const record = await getRecord(table.id, createdRecord.records[0].id, CellFormat.Text);

      expect(record.fields[table.fields[0].id]).toEqual('text value');
      expect(record.fields[table.fields[1].id]).toEqual('123.00');
    });

    it('should get records with projections', async () => {
      await updateRecord(table.id, table.records[0].id, {
        record: {
          fields: {
            [table.fields[0].name]: 'text',
            [table.fields[1].name]: 1,
          },
        },
      });

      const result = await getRecords(table.id, {
        projection: [table.fields[0].name],
      });

      expect(Object.keys(result.records[0].fields).length).toEqual(1);
    });

    it('should create a record', async () => {
      const value1 = 'New Record' + new Date();
      const res1 = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [table.fields[0].name]: value1,
            },
          },
        ],
      });
      expect(res1.records[0].fields[table.fields[0].name]).toEqual(value1);

      const result = await getRecords(table.id, { skip: 0, take: 1000 });
      expect(result.records).toHaveLength(4);

      const value2 = 'New Record' + new Date();
      // test fieldKeyType is id
      const res2 = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [table.fields[0].id]: value2,
            },
          },
        ],
      });

      expect(res2.records[0].fields[table.fields[0].id]).toEqual(value2);
    });

    it('should update record', async () => {
      const record = await updateRecordByApi(
        table.id,
        table.records[0].id,
        table.fields[0].id,
        'new value'
      );

      expect(record.fields[table.fields[0].id]).toEqual('new value');

      const result = await getRecords(table.id, { skip: 0, take: 1000 });

      expect(result.records).toHaveLength(3);
      expect(result.records[0].fields[table.fields[0].name]).toEqual('new value');
    });

    it('should update and typecast record', async () => {
      const singleUserField = await createField(table.id, {
        type: FieldType.User,
        options: {
          isMultiple: false,
        },
      });

      const multiUserField = await createField(table.id, {
        type: FieldType.User,
        options: {
          isMultiple: true,
        },
      });

      const dateField = await createField(table.id, {
        type: FieldType.Date,
      });

      const res1 = await updateRecord(table.id, table.records[0].id, {
        record: { fields: { [singleUserField.id]: 'test' } },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      });

      const res2 = await updateRecord(table.id, table.records[0].id, {
        record: { fields: { [multiUserField.id]: 'test@e2e.com' } },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      });

      const res3 = await updateRecord(table.id, table.records[0].id, {
        record: { fields: { [dateField.id]: 'now' } },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      });

      expect(res1.fields[singleUserField.id]).toMatchObject({
        email: 'test@e2e.com',
        title: 'test',
      });
      expect(res2.fields[multiUserField.id]).toMatchObject([
        {
          email: 'test@e2e.com',
          title: 'test',
        },
      ]);

      expect(res3.fields[dateField.id]).toBeDefined();
      expect(new Date(res3.fields[dateField.id] as string).toISOString().slice(0, -7)).toEqual(
        new Date().toISOString().slice(0, -7)
      );
    });

    it('should not auto create options when preventAutoNewOptions is true', async () => {
      const singleSelectField = await createField(table.id, {
        type: FieldType.SingleSelect,
        options: {
          choices: [{ name: 'red' }],
          preventAutoNewOptions: true,
        },
      });

      const multiSelectField = await createField(table.id, {
        type: FieldType.MultipleSelect,
        options: {
          choices: [{ name: 'red' }],
          preventAutoNewOptions: true,
        },
      });

      const records1 = (
        await updateRecords(table.id, {
          records: [
            {
              id: table.records[0].id,
              fields: { [singleSelectField.id]: 'red' },
            },
            {
              id: table.records[1].id,
              fields: { [singleSelectField.id]: 'blue' },
            },
          ],
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
        })
      ).data;

      expect(records1[0].fields[singleSelectField.id]).toEqual('red');
      expect(records1[1].fields[singleSelectField.id]).toBeUndefined();

      const records2 = (
        await updateRecords(table.id, {
          records: [
            {
              id: table.records[0].id,
              fields: { [multiSelectField.id]: ['red', 'blue'] },
            },
          ],
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
        })
      ).data;

      expect(records2[0].fields[multiSelectField.id]).toEqual(['red']);
    });

    it('should batch create records', async () => {
      const count = 100;
      console.time(`create ${count} records`);
      const records = Array.from({ length: count }).map((_, i) => ({
        fields: {
          [table.fields[0].name]: 'New Record' + new Date(),
          [table.fields[1].name]: i,
          [table.fields[2].name]: 'light',
        },
      }));

      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records,
      });

      console.timeEnd(`create ${count} records`);
    });

    it('should delete a record', async () => {
      const value1 = 'New Record' + new Date();
      const addRecordRes = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [table.fields[0].name]: value1,
            },
          },
        ],
      });

      await getRecord(table.id, addRecordRes.records[0].id, undefined, 200);

      await deleteRecord(table.id, addRecordRes.records[0].id);

      await getRecord(table.id, addRecordRes.records[0].id, undefined, 404);
    });

    it('should batch delete records', async () => {
      const value1 = 'New Record' + new Date();
      const addRecordsRes = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [table.fields[0].name]: value1,
            },
          },
          {
            fields: {
              [table.fields[0].name]: value1,
            },
          },
        ],
      });
      const records = addRecordsRes.records;

      await getRecord(table.id, records[0].id, undefined, 200);
      await getRecord(table.id, records[1].id, undefined, 200);

      await deleteRecords(
        table.id,
        records.map((record) => record.id)
      );

      await getRecord(table.id, records[0].id, undefined, 404);
      await getRecord(table.id, records[1].id, undefined, 404);
    });

    it('should create a record after delete a record', async () => {
      const value1 = 'New Record' + new Date();
      await deleteRecord(table.id, table.records[0].id);

      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [table.fields[0].name]: value1,
            },
          },
        ],
      });
    });

    it('should duplicate a record', async () => {
      const value1 = 'New Record';
      const addRecordRes = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [table.fields[0].id]: value1,
            },
          },
        ],
      });
      const addRecord = await getRecord(table.id, addRecordRes.records[0].id, undefined, 200);
      expect(addRecord.fields[table.fields[0].id]).toEqual(value1);

      const viewId = table.views[0].id;
      const duplicateRes = await duplicateRecord(table.id, addRecord.id, {
        viewId,
        anchorId: addRecord.id,
        position: 'after',
      });
      const record = await getRecord(table.id, duplicateRes.records[0].id, undefined, 200);
      expect(record.fields[table.fields[0].id]).toEqual(value1);
    });
  });

  describe('validate record value by field validation', () => {
    let table: ITableFullVo;

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'table1',
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    const clearRecords = async () => {
      const table2Records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });

      await deleteRecords(
        table.id,
        table2Records.records.map((record) => record.id)
      );
    };

    it('should validate the unique values of the unique field', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
        unique: true,
      };

      await clearRecords();

      const sourceField = await createField(table.id, sourceFieldRo);

      await createRecords(table.id, {
        records: [
          {
            fields: {
              [sourceField.id]: '100',
            },
          },
        ],
      });

      await createRecords(
        table.id,
        {
          records: [
            {
              fields: {
                [sourceField.id]: '100',
              },
            },
          ],
        },
        400
      );

      await createRecords(table.id, {
        records: [
          {
            fields: {
              [sourceField.id]: '200',
            },
          },
        ],
      });
    });

    it.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
      'should validate the not null values of the not null field',
      async () => {
        const sourceFieldRo: IFieldRo = {
          name: 'TextField2',
          type: FieldType.SingleLineText,
        };
        const convertFieldRo: IFieldRo = {
          name: 'TextField2',
          type: FieldType.SingleLineText,
          notNull: true,
        };

        await clearRecords();

        const sourceField = await createField(table.id, sourceFieldRo);
        await convertField(table.id, sourceField.id, convertFieldRo);

        await createRecords(
          table.id,
          {
            records: [
              {
                fields: {},
              },
            ],
          },
          400
        );

        await createRecords(table.id, {
          records: [
            {
              fields: {
                [sourceField.id]: '100',
              },
            },
          ],
        });
      }
    );
  });

  describe('calculate', () => {
    let table: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'table1',
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should create a record and auto calculate computed field', async () => {
      const formulaFieldRo1: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `1 + 1`,
        },
      };

      const formulaFieldRo2: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${table.fields[0].id}} + 1`,
        },
      };

      const formulaField1 = await createField(table.id, formulaFieldRo1);
      const formulaField2 = await createField(table.id, formulaFieldRo2);

      const { records } = await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[0].id]: 'text value',
            },
          },
        ],
      });

      expect(records[0].fields[formulaField1.id]).toEqual(2);
      expect(records[0].fields[formulaField2.id]).toEqual('text value1');
    });

    it('should create a record with typecast', async () => {
      const selectFieldRo: IFieldRo = {
        type: FieldType.SingleSelect,
      };

      const selectField = await createField(table.id, selectFieldRo);

      // reject data when typecast is false
      await createRecords(
        table.id,
        {
          records: [
            {
              fields: {
                [selectField.id]: 'select value',
              },
            },
          ],
        },
        400
      );

      const { records } = await createRecords(table.id, {
        typecast: true,
        records: [
          {
            fields: {
              [selectField.id]: 'select value',
            },
          },
        ],
      });

      const fieldAfter = await getField(table.id, selectField.id);

      expect(records[0].fields[selectField.id]).toEqual('select value');
      expect((fieldAfter.options as ISelectFieldOptions).choices.length).toEqual(1);
      expect((fieldAfter.options as ISelectFieldOptions).choices).toMatchObject([
        { name: 'select value' },
      ]);
    });
  });

  describe('calculate when create', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      table1 = await createTable(baseId, {
        name: 'table1',
      });
      table2 = await createTable(baseId, {
        name: 'table2',
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create a record with error field formula', async () => {
      const fieldToDel = table1.fields[2];

      const formulaRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${fieldToDel.id}}`,
        },
      };

      const formulaField = await createField(table1.id, formulaRo);

      await deleteField(table1.id, fieldToDel.id);

      const data = await createRecords(table1.id, {
        records: [
          {
            fields: {},
          },
        ],
      });

      expect(data.records[0].fields[formulaField.id]).toBeUndefined();
    });

    it('should create a record with error lookup and rollup field', async () => {
      const fieldToDel = table2.fields[2];

      const linkFieldRo: IFieldRo = {
        name: 'linkField',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      const lookupFieldRo: IFieldRo = {
        type: fieldToDel.type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: fieldToDel.id,
          linkFieldId: linkField.id,
        },
      };

      const rollupFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: fieldToDel.id,
          linkFieldId: linkField.id,
        },
      };

      const lookupField = await createField(table1.id, lookupFieldRo);
      const rollup = await createField(table1.id, rollupFieldRo);

      await deleteField(table2.id, fieldToDel.id);

      const data = await createRecords(table1.id, {
        records: [
          {
            fields: {
              [linkField.id]: { id: table2.records[0].id },
            },
          },
        ],
      });

      expect(data.records[0].fields[lookupField.id]).toBeUndefined();
      expect(data.records[0].fields[rollup.id]).toBeUndefined();
    });
  });

  describe('create record with default value', () => {
    let table: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'table1',
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should create a record with default single select', async () => {
      const field = await createField(table.id, {
        type: FieldType.SingleSelect,
        options: {
          choices: [{ name: 'default value' }],
          defaultValue: 'default value',
        },
      });

      const { records } = await createRecords(table.id, {
        records: [
          {
            fields: {},
          },
        ],
      });

      expect(records[0].fields[field.id]).toEqual('default value');
    });

    it('should create a record with default multiple select', async () => {
      const field = await createField(table.id, {
        type: FieldType.MultipleSelect,
        options: {
          choices: [{ name: 'default value' }, { name: 'default value2' }],
          defaultValue: ['default value', 'default value2'],
        },
      });

      const { records } = await createRecords(table.id, {
        records: [
          {
            fields: {},
          },
        ],
      });

      expect(records[0].fields[field.id]).toEqual(['default value', 'default value2']);
    });

    it('should create a record with default number', async () => {
      const field = await createField(table.id, {
        type: FieldType.Number,
        options: {
          defaultValue: 1,
        },
      });

      const { records } = await createRecords(table.id, {
        records: [
          {
            fields: {},
          },
        ],
      });

      expect(records[0].fields[field.id]).toEqual(1);
    });

    it('should create a record with default user', async () => {
      const field = await createField(table.id, {
        type: FieldType.User,
        options: {
          defaultValue: userId,
        },
      });
      const field2 = await createField(table.id, {
        type: FieldType.User,
        options: {
          isMultiple: true,
          defaultValue: ['me'],
        },
      });
      const field3 = await createField(table.id, {
        type: FieldType.User,
        options: {
          isMultiple: true,
          defaultValue: [userId],
        },
      });

      const { records } = await createRecords(table.id, {
        records: [
          {
            fields: {},
          },
        ],
      });

      expect(records[0].fields[field.id]).toMatchObject({
        id: userId,
        title: expect.any(String),
        email: expect.any(String),
        avatarUrl: expect.any(String),
      });
      expect(records[0].fields[field2.id]).toMatchObject([
        {
          id: userId,
          title: expect.any(String),
          email: expect.any(String),
          avatarUrl: expect.any(String),
        },
      ]);
      expect(records[0].fields[field3.id]).toMatchObject([
        {
          id: userId,
          title: expect.any(String),
          email: expect.any(String),
          avatarUrl: expect.any(String),
        },
      ]);
    });
  });
});
