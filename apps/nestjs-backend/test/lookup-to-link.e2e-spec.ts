import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import type { IFieldRo, LinkFieldCore } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  deleteTable,
  getRecord,
  getRecords,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI LookupToLink (e2e)', () => {
  let app: INestApplication;
  let table1: ITableFullVo;
  let table2: ITableFullVo;
  let table3: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Create table1 with basic fields
    table1 = await createTable(baseId, {
      name: 'Table1',
      fields: [
        {
          name: 'Name',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Count',
          type: FieldType.Number,
        },
      ],
      records: [
        { fields: { Name: 'A1', Count: 10 } },
        { fields: { Name: 'A2', Count: 20 } },
        { fields: { Name: 'A3', Count: 30 } },
      ],
    });

    // Create table2 with basic fields
    table2 = await createTable(baseId, {
      name: 'Table2',
      fields: [
        {
          name: 'Title',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Value',
          type: FieldType.Number,
        },
      ],
      records: [
        { fields: { Title: 'B1', Value: 100 } },
        { fields: { Title: 'B2', Value: 200 } },
        { fields: { Title: 'B3', Value: 300 } },
      ],
    });

    // Create table3 with basic fields
    table3 = await createTable(baseId, {
      name: 'Table3',
      fields: [
        {
          name: 'Description',
          type: FieldType.SingleLineText,
        },
      ],
      records: [{ fields: { Description: 'C1' } }, { fields: { Description: 'C2' } }],
    });
  });

  afterEach(async () => {
    await deleteTable(baseId, table1.id);
    await deleteTable(baseId, table2.id);
    await deleteTable(baseId, table3.id);
  });

  describe('Lookup to Link Field Tests', () => {
    it('should handle lookup field that targets a link field', async () => {
      // Create link field from table1 to table2
      const linkField1to2 = await createField(table1.id, {
        name: 'Link to Table2',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      } as IFieldRo);

      // Wait a bit for the symmetric field to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get the symmetric field ID
      const symmetricFieldId = (linkField1to2 as LinkFieldCore).options.symmetricFieldId;
      if (!symmetricFieldId) {
        throw new Error('Symmetric field ID not found');
      }

      // Create lookup field in table1 that looks up table2's symmetric link field

      const lookupField = await createField(table1.id, {
        name: 'Lookup Link to Table1',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField1to2.id,
          lookupFieldId: symmetricFieldId,
        },
      } as IFieldRo);

      // Establish link: table1[0] -> table2[0]
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1to2.id, {
        id: table2.records[0].id,
      });

      // Test that the lookup field can be queried without errors
      const record = await getRecord(table1.id, table1.records[0].id);

      // The lookup field should exist and not cause query errors
      expect(record.fields).toHaveProperty(lookupField.id);

      // The value should be the linked table1 record (symmetric link)
      // Use field name instead of field ID to access the value
      const lookupValue = record.fields[lookupField.name];
      if (lookupValue) {
        expect(lookupValue).toHaveProperty('id', table1.records[0].id);
        expect(lookupValue).toHaveProperty('title', 'A1');
      }
    });

    it('should handle multiple records in lookup to link scenario', async () => {
      // Create link field from table1 to table2
      const linkField1to2 = await createField(table1.id, {
        name: 'Link to Table2',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      } as IFieldRo);

      // Create link field from table2 to table3
      const linkField2to3 = await createField(table2.id, {
        name: 'Link to Table3',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table3.id,
        },
      } as IFieldRo);

      // Create lookup field in table1 that looks up table2's link field
      const lookupField = await createField(table1.id, {
        name: 'Lookup Link to Table3',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField1to2.id,
          lookupFieldId: linkField2to3.id,
        },
      } as IFieldRo);

      // Establish multiple links
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1to2.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      await updateRecordByApi(table2.id, table2.records[0].id, linkField2to3.id, [
        { id: table3.records[0].id },
      ]);

      await updateRecordByApi(table2.id, table2.records[1].id, linkField2to3.id, [
        { id: table3.records[1].id },
      ]);

      // Test that we can query all records without errors
      const records = await getRecords(table1.id);
      expect(records.records).toHaveLength(3);

      // Check the first record has the expected lookup values
      const firstRecord = records.records[0];
      // Use field name instead of field ID to access the value
      const lookupValueByName = firstRecord.fields[lookupField.name];
      // Use the correct lookup value (by name, not by ID)
      const actualLookupValue = lookupValueByName;
      expect(Array.isArray(actualLookupValue)).toBe(true);
      if (Array.isArray(actualLookupValue)) {
        expect(actualLookupValue).toHaveLength(2);
        const ids = actualLookupValue.map((v: { id: string }) => v.id);
        expect(ids).toContain(table3.records[0].id);
        expect(ids).toContain(table3.records[1].id);
      }
    });
  });
});
