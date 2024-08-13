import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import { getRecord, getRecords, updateRecord, type ITableFullVo } from '@teable/openapi';
import { createField, createTable, deleteTable, initApp } from './utils/init-app';

describe('OpenAPI FieldController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const userName = globalThis.testConfig.userName;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CRUD', () => {
    let table1: ITableFullVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await deleteTable(baseId, table1.id);
    });

    it('should create a created by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.CreatedBy,
      };

      const createdByField = await createField(table1.id, fieldRo);
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      records.data.records.forEach((record) => {
        expect(record.fields[createdByField.id]).toMatchObject({
          title: userName,
        });
      });
    });

    it('should create a last modified by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedBy,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedByField = await createField(table1.id, fieldRo);
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      expect(records.data.records[1].fields[lastModifiedByField.id]).toBeUndefined();

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, records.data.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });
    });

    it('should update formula result depends on a last modified by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedBy,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedByField = await createField(table1.id, fieldRo);

      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${lastModifiedByField.id}}`,
        },
      };

      const formulaField = await createField(table1.id, formulaFieldRo);

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      expect(records.data.records[0].fields[formulaField.id]).toMatchObject(userName);

      expect(records.data.records[1].fields[lastModifiedByField.id]).toBeUndefined();

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, table1.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      expect(updatedRecord.data.fields[formulaField.id]).toMatchObject(userName);
    });

    it('should update formula result depends on a last modified time field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedTime,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedTimeField = await createField(table1.id, fieldRo);

      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${lastModifiedTimeField.id}}`,
        },
      };

      const formulaField = await createField(table1.id, formulaFieldRo);

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedTimeField.id]).toEqual(
        records.data.records[0].lastModifiedTime
      );

      expect(records.data.records[0].fields[formulaField.id]).toEqual(
        records.data.records[0].lastModifiedTime
      );

      expect(records.data.records[1].fields[lastModifiedTimeField.id]).toBeUndefined();

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, table1.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedTimeField.id]).toEqual(
        updatedRecord.data.lastModifiedTime
      );

      expect(updatedRecord.data.fields[formulaField.id]).toEqual(
        updatedRecord.data.lastModifiedTime
      );
    });
  });
});
