/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  getRecords as apiGetRecords,
  createField,
  updateRecord,
  convertField,
  getFields,
} from '@teable/openapi';
import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('Bidirectional Formula Link Fields (e2e)', () => {
  let app: INestApplication;
  let baseId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    baseId = globalThis.testConfig.baseId;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('many-to-many bidirectional link with formula field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeAll(async () => {
      // Create Table1 with primary text field that will be converted to formula
      table1 = await createTable(baseId, {
        name: 'Table1_FormulaTest',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { Title: 'Item1' } },
          { fields: { Title: 'Item2' } },
          { fields: { Title: 'Item3' } },
        ],
      });

      // Create Table2
      table2 = await createTable(baseId, {
        name: 'Table2_FormulaTest',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { Title: 'Group1' } }, { fields: { Title: 'Group2' } }],
      });

      // Create many-to-many link field from Table1 to Table2
      const linkFieldResponse = await createField(table1.id, {
        name: 'LinkedGroups',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      });
      const linkField = linkFieldResponse.data;

      // Convert Table1's primary field (Title) to a formula field that references the link field
      const primaryField = table1.fields[0]; // This is the "Title" field
      await convertField(table1.id, primaryField.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${linkField.id}}`, // Reference the link field
        },
      });

      // Get fresh table data to get the created fields
      const table1Records = await apiGetRecords(table1.id, { viewId: table1.views[0].id });
      const table2Records = await apiGetRecords(table2.id, { viewId: table2.views[0].id });

      // Link Item1 to Group1
      await updateRecord(table1.id, table1Records.data.records[0].id, {
        record: {
          fields: {
            LinkedGroups: [{ id: table2Records.data.records[0].id }],
          },
        },
      });

      // Link Item2 to both Group1 and Group2
      await updateRecord(table1.id, table1Records.data.records[1].id, {
        record: {
          fields: {
            LinkedGroups: [
              { id: table2Records.data.records[0].id },
              { id: table2Records.data.records[1].id },
            ],
          },
        },
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should correctly display formula values in bidirectional link titles', async () => {
      // Get Table2 records to check the bidirectional link
      const table2Records = await apiGetRecords(table2.id, { viewId: table2.views[0].id });
      expect(table2Records.data.records).toHaveLength(2);

      // Get updated Table2 fields to find the symmetric link field (created automatically)
      const table2Fields = await getFields(table2.id, {});
      const linkField = table2Fields.data.find((f) => f.type === FieldType.Link);
      expect(linkField).toBeDefined();
      expect(linkField!.name).toContain('Table1_FormulaTest');

      // Check Group1 record - should be linked to Item1 and Item2
      const group1Record = table2Records.data.records.find((r) => r.fields.Title === 'Group1');
      expect(group1Record).toBeDefined();

      const group1Links = group1Record!.fields[linkField!.name!] as any[];
      expect(Array.isArray(group1Links)).toBe(true);
      expect(group1Links).toHaveLength(2); // Linked to Item1 and Item2

      // Verify that each linked record has correct title (should show formula result)
      // The formula field references the link field, so it should show the linked groups
      const titles = group1Links.map((link) => link.title).sort();
      expect(titles).toEqual(['Group1', 'Group1, Group2']); // Item1 links to Group1, Item2 links to Group1,Group2

      // Check Group2 record - should be linked to Item2 only
      const group2Record = table2Records.data.records.find((r) => r.fields.Title === 'Group2');
      expect(group2Record).toBeDefined();

      const group2Links = group2Record!.fields[linkField!.name!] as any[];
      expect(Array.isArray(group2Links)).toBe(true);
      expect(group2Links).toHaveLength(1); // Linked to Item2 only

      // Verify the linked record has correct title
      expect(group2Links[0].title).toBe('Group1, Group2'); // Item2 links to both groups

      // Verify all linked records have both id and title
      [...group1Links, ...group2Links].forEach((link) => {
        expect(link).toHaveProperty('id');
        expect(link).toHaveProperty('title');
        expect(typeof link.id).toBe('string');
        expect(typeof link.title).toBe('string');
        expect(link.title).not.toBe(''); // Title should not be empty
      });
    });
  });
});
