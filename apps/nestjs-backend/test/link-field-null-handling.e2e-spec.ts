/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getRecords,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

describe('Link Field Null Handling (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Link field with OneMany relationship', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField: IFieldVo;

    beforeEach(async () => {
      // Create table1 with text field
      const textFieldRo: IFieldRo = {
        name: 'Title',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Table1',
        fields: [textFieldRo],
        records: [
          { fields: { Title: 'Record 1' } },
          { fields: { Title: 'Record 2' } },
          { fields: { Title: 'Record 3' } },
        ],
      });

      // Create table2 with text field
      table2 = await createTable(baseId, {
        name: 'Table2',
        fields: [textFieldRo],
        records: [
          { fields: { Title: 'A' } },
          { fields: { Title: 'B' } },
          { fields: { Title: 'C' } },
        ],
      });

      // Create link field from table1 to table2 (OneMany relationship)
      const linkFieldRo: IFieldRo = {
        name: 'Link Field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      linkField = await createField(table1.id, linkFieldRo);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should return empty array for records with no links instead of null objects', async () => {
      // Get records without any links established
      const records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      expect(records.records).toHaveLength(3);

      // All records should have empty arrays for the link field, not [{"id": null, "title": null}]
      for (const record of records.records) {
        const linkValue = record.fields[linkField.name];
        expect(linkValue).toBeUndefined();
        expect(linkValue).not.toEqual([{ id: null, title: null }]);
      }
    });
  });

  describe('Link field with ManyOne relationship', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField: IFieldVo;

    beforeEach(async () => {
      // Create table1 with text field
      const textFieldRo: IFieldRo = {
        name: 'Title',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Table1',
        fields: [textFieldRo],
        records: [
          { fields: { Title: 'Record 1' } },
          { fields: { Title: 'Record 2' } },
          { fields: { Title: 'Record 3' } },
        ],
      });

      // Create table2 with text field
      table2 = await createTable(baseId, {
        name: 'Table2',
        fields: [textFieldRo],
        records: [
          { fields: { Title: 'A' } },
          { fields: { Title: 'B' } },
          { fields: { Title: 'C' } },
        ],
      });

      // Create link field from table1 to table2 (ManyOne relationship)
      const linkFieldRo: IFieldRo = {
        name: 'Link Field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      linkField = await createField(table1.id, linkFieldRo);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should return null for records with no links instead of null objects', async () => {
      // Get records without any links established
      const records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      expect(records.records).toHaveLength(3);

      // All records should have null or undefined for the link field, not [{"id": null, "title": null}]
      for (const record of records.records) {
        const linkValue = record.fields[linkField.name];
        expect(linkValue == null).toBe(true); // null or undefined
        expect(linkValue).not.toEqual([{ id: null, title: null }]);
      }
    });

    it('should return proper single link object when link is established', async () => {
      // Link first record to first target record (ManyOne only allows single link)
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      // Get records after establishing link
      const records = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      expect(records.records).toHaveLength(3);

      // First record should have single link object (not array)
      const firstRecord = records.records.find((r) => r.fields.Title === 'Record 1');
      expect(firstRecord?.fields[linkField.name]).toEqual({
        id: table2.records[0].id,
        title: 'A',
      });

      // Other records should have null (not empty array)
      const secondRecord = records.records.find((r) => r.fields.Title === 'Record 2');
      const thirdRecord = records.records.find((r) => r.fields.Title === 'Record 3');

      expect(secondRecord?.fields[linkField.name] == null).toBe(true); // null or undefined
      expect(thirdRecord?.fields[linkField.name] == null).toBe(true); // null or undefined
    });
  });
});
