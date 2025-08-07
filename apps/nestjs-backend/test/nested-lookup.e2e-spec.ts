/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILookupOptionsRo } from '@teable/core';
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

describe('Nested Lookup Field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Nested lookup field (lookup -> lookup -> number)', () => {
    let table1: ITableFullVo; // Final table
    let table2: ITableFullVo; // Intermediate table
    let table3: ITableFullVo; // Main table
    let linkField1: IFieldVo; // Link field from table2 to table1
    let linkField2: IFieldVo; // Link field from table3 to table2
    let lookupField1: IFieldVo; // Lookup field in table2 that looks up table1's number field
    let nestedLookupField: IFieldVo; // Nested lookup field in table3 that looks up table2's lookup field

    beforeEach(async () => {
      // Create table1 (final table) - contains a number field
      const numberFieldRo: IFieldRo = {
        name: 'Count',
        type: FieldType.Number,
        options: {
          formatting: { precision: 0, type: 'decimal' },
        },
      };

      table1 = await createTable(baseId, {
        name: 'Table1',
        fields: [numberFieldRo],
        records: [{ fields: { Count: 10 } }, { fields: { Count: 20 } }, { fields: { Count: 30 } }],
      });

      // Create table2 (intermediate table)
      table2 = await createTable(baseId, {
        name: 'Table2',
        fields: [],
        records: [{ fields: {} }, { fields: {} }],
      });

      // Create table3 (main table)
      table3 = await createTable(baseId, {
        name: 'Table3',
        fields: [],
        records: [{ fields: {} }],
      });

      // Create link field from table2 to table1
      const linkFieldRo1: IFieldRo = {
        name: 'Link to Table1',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
        },
      };

      linkField1 = await createField(table2.id, linkFieldRo1);

      // Create lookup field in table2 that looks up table1's number field
      const lookupFieldRo1: IFieldRo = {
        name: 'Lookup Count from Table1',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          linkFieldId: linkField1.id,
          lookupFieldId: table1.fields.find((f) => f.name === 'Count')!.id,
        } as ILookupOptionsRo,
      };

      lookupField1 = await createField(table2.id, lookupFieldRo1);

      // Create link field from table3 to table2
      const linkFieldRo2: IFieldRo = {
        name: 'Link to Table2',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      };

      linkField2 = await createField(table3.id, linkFieldRo2);

      // Create nested lookup field in table3 that looks up table2's lookup field
      const nestedLookupFieldRo: IFieldRo = {
        name: 'Nested Lookup Count',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField2.id,
          lookupFieldId: lookupField1.id,
        } as ILookupOptionsRo,
      };

      nestedLookupField = await createField(table3.id, nestedLookupFieldRo);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
      await permanentDeleteTable(baseId, table3.id);
    });

    it('should generate correct CTE for nested lookup field', async () => {
      // Establish relationships
      // Link table2's first record to table1's first record
      await updateRecordByApi(table2.id, table2.records[0].id, linkField1.id, [
        { id: table1.records[0].id },
      ]);

      // Link table2's second record to table1's second record
      await updateRecordByApi(table2.id, table2.records[1].id, linkField1.id, [
        { id: table1.records[1].id },
      ]);

      // Link table3's record to both table2 records
      await updateRecordByApi(table3.id, table3.records[0].id, linkField2.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // Get table3 records, should see nested lookup values
      const records = await getRecords(table3.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(records.records).toHaveLength(1);
      const record = records.records[0];

      // Verify nested lookup field value
      const nestedLookupValue = record.fields[nestedLookupField.id];
      console.log('Nested lookup value:', nestedLookupValue);

      // Should contain Count values from table1: [10, 20]
      expect(nestedLookupValue).toEqual(expect.arrayContaining([10, 20]));
    });

    it('should handle empty nested lookup correctly', async () => {
      // Query without establishing any relationships
      const records = await getRecords(table3.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(records.records).toHaveLength(1);
      const record = records.records[0];

      // Verify nested lookup field value should be empty array or null/undefined
      const nestedLookupValue = record.fields[nestedLookupField.id];
      console.log('Empty nested lookup value:', nestedLookupValue);

      expect(nestedLookupValue).toBeUndefined();
    });

    it('should handle partial nested lookup correctly', async () => {
      // Establish partial relationships only
      // Link table2's first record to table1's first record
      await updateRecordByApi(table2.id, table2.records[0].id, linkField1.id, [
        { id: table1.records[0].id },
      ]);

      // Link table3's record only to table2's first record
      await updateRecordByApi(table3.id, table3.records[0].id, linkField2.id, [
        { id: table2.records[0].id },
      ]);

      // Get table3 records
      const records = await getRecords(table3.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(records.records).toHaveLength(1);
      const record = records.records[0];

      // Verify nested lookup field value
      const nestedLookupValue = record.fields[nestedLookupField.id];
      console.log('Partial nested lookup value:', nestedLookupValue);

      // Should contain only one value [10]
      expect(nestedLookupValue).toEqual([10]);
    });
  });

  describe('Three-level nested lookup (lookup -> lookup -> lookup -> text)', () => {
    let table1: ITableFullVo; // Final table
    let table2: ITableFullVo; // Intermediate table 1
    let table3: ITableFullVo; // Intermediate table 2
    let table4: ITableFullVo; // Main table
    let linkField1: IFieldVo; // Link field from table2 to table1
    let linkField2: IFieldVo; // Link field from table3 to table2
    let linkField3: IFieldVo; // Link field from table4 to table3
    let lookupField1: IFieldVo; // Lookup field in table2 that looks up table1's text
    let lookupField2: IFieldVo; // Lookup field in table3 that looks up table2's lookup
    let nestedLookupField: IFieldVo; // Nested lookup field in table4 that looks up table3's lookup

    beforeEach(async () => {
      // Create table1 (final table) - contains a text field
      const textFieldRo: IFieldRo = {
        name: 'Name',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'Table1',
        fields: [textFieldRo],
        records: [{ fields: { Name: 'Alpha' } }, { fields: { Name: 'Beta' } }],
      });

      // Create table2 (intermediate table 1)
      table2 = await createTable(baseId, {
        name: 'Table2',
        fields: [],
        records: [{ fields: {} }],
      });

      // Create table3 (intermediate table 2)
      table3 = await createTable(baseId, {
        name: 'Table3',
        fields: [],
        records: [{ fields: {} }],
      });

      // Create table4 (main table)
      table4 = await createTable(baseId, {
        name: 'Table4',
        fields: [],
        records: [{ fields: {} }],
      });

      // Create link and lookup fields
      linkField1 = await createField(table2.id, {
        name: 'Link to Table1',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
        },
      });

      lookupField1 = await createField(table2.id, {
        name: 'Lookup Name from Table1',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          linkFieldId: linkField1.id,
          lookupFieldId: table1.fields.find((f) => f.name === 'Name')!.id,
        } as ILookupOptionsRo,
      });

      linkField2 = await createField(table3.id, {
        name: 'Link to Table2',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      });

      lookupField2 = await createField(table3.id, {
        name: 'Lookup Name from Table2',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField2.id,
          lookupFieldId: lookupField1.id,
        } as ILookupOptionsRo,
      });

      linkField3 = await createField(table4.id, {
        name: 'Link to Table3',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table3.id,
        },
      });

      nestedLookupField = await createField(table4.id, {
        name: 'Three Level Lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table3.id,
          linkFieldId: linkField3.id,
          lookupFieldId: lookupField2.id,
        } as ILookupOptionsRo,
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
      await permanentDeleteTable(baseId, table3.id);
      await permanentDeleteTable(baseId, table4.id);
    });

    it('should handle three-level nested lookup correctly', async () => {
      // Establish complete relationship chain
      await updateRecordByApi(table2.id, table2.records[0].id, linkField1.id, [
        { id: table1.records[0].id },
        { id: table1.records[1].id },
      ]);

      await updateRecordByApi(table3.id, table3.records[0].id, linkField2.id, [
        { id: table2.records[0].id },
      ]);

      await updateRecordByApi(table4.id, table4.records[0].id, linkField3.id, [
        { id: table3.records[0].id },
      ]);

      // Get table4 records
      const records = await getRecords(table4.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(records.records).toHaveLength(1);
      const record = records.records[0];

      // Verify three-level nested lookup field value
      const nestedLookupValue = record.fields[nestedLookupField.id];
      console.log('Three-level nested lookup value:', nestedLookupValue);

      // Should contain Name values from table1
      expect(nestedLookupValue).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    });
  });
});
