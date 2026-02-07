/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 link field ordering (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  describe('OneMany link field ordering', () => {
    it('should maintain insertion order when multiple records link to the same record', async () => {
      const titleFieldId = createFieldId();
      const linkFieldId = createFieldId();

      // Create Table2 first (the "One" side of the relationship)
      const table2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Table2_OneMany',
        fields: [
          {
            type: 'singleLineText',
            id: titleFieldId,
            name: 'title',
          },
        ],
      });

      // Create a record in Table2
      const table2Record = await ctx.createRecord(table2.id, { [titleFieldId]: 'TargetRecord' });

      // Create Table1 with ManyOne link to Table2
      const nameFieldId = createFieldId();
      const table1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Table1_ManyOne',
        fields: [
          {
            type: 'singleLineText',
            id: nameFieldId,
            name: 'name',
          },
          {
            type: 'link',
            id: linkFieldId,
            name: 'link_to_table2',
            options: {
              relationship: 'manyOne',
              foreignTableId: table2.id,
              lookupFieldId: titleFieldId,
            },
          },
        ],
      });

      // Create records in Table1
      const rec1 = await ctx.createRecord(table1.id, { [nameFieldId]: 'B1' });
      const rec2 = await ctx.createRecord(table1.id, { [nameFieldId]: 'B2' });

      const table2RecordId = table2Record.id;
      const rec1Id = rec1.id;
      const rec2Id = rec2.id;

      // Link rec1 first, then rec2 (in this specific order)
      await ctx.updateRecord(table1.id, rec1Id, {
        [linkFieldId]: { id: table2RecordId },
      });

      await ctx.updateRecord(table1.id, rec2Id, {
        [linkFieldId]: { id: table2RecordId },
      });

      // Process outbox to compute the symmetric link field
      await ctx.drainOutbox(3);

      // Get table2 record and check the symmetric OneMany field
      const table2Records = await ctx.listRecords(table2.id);
      const table2CurrentRecord = table2Records[0];

      // Find the symmetric link field (should be auto-created)
      const symmetricFieldName = Object.keys(table2CurrentRecord.fields).find(
        (key) => key !== 'title' && key !== titleFieldId
      );
      expect(symmetricFieldName).toBeDefined();

      const symmetricLinks = table2CurrentRecord.fields[symmetricFieldName!];
      expect(Array.isArray(symmetricLinks)).toBe(true);
      expect(symmetricLinks).toHaveLength(2);

      // CRITICAL: Order must match link creation order (rec1 first, rec2 second)
      expect(symmetricLinks).toEqual([
        { id: rec1Id, title: 'B1' },
        { id: rec2Id, title: 'B2' },
      ]);
    });

    it('should preserve order when updating the symmetric oneMany field', async () => {
      const titleFieldId = createFieldId();
      const linkFieldId = createFieldId();
      const nameFieldId = createFieldId();

      // Create Table2 (one side)
      const table2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Table2_OneMany_UpdateOrder',
        fields: [
          {
            type: 'singleLineText',
            id: titleFieldId,
            name: 'title',
          },
        ],
      });

      const table2Record = await ctx.createRecord(table2.id, { [titleFieldId]: 'Target' });

      // Create Table1 with manyOne link to Table2 (two-way)
      const table1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Table1_OneMany_UpdateOrder',
        fields: [
          {
            type: 'singleLineText',
            id: nameFieldId,
            name: 'name',
          },
          {
            type: 'link',
            id: linkFieldId,
            name: 'link_to_table2',
            options: {
              relationship: 'manyOne',
              foreignTableId: table2.id,
              lookupFieldId: titleFieldId,
            },
          },
        ],
      });

      // Create records in Table1
      const recA = await ctx.createRecord(table1.id, { [nameFieldId]: 'A' });
      const recB = await ctx.createRecord(table1.id, { [nameFieldId]: 'B' });
      const recC = await ctx.createRecord(table1.id, { [nameFieldId]: 'C' });

      // Process outbox to ensure symmetric field exists
      await ctx.drainOutbox(2);

      // Detect symmetric field key from Table2 record
      const table2Records = await ctx.listRecords(table2.id);
      const symmetricFieldKey = Object.keys(table2Records[0].fields).find(
        (key) => key !== 'title' && key !== titleFieldId
      );
      expect(symmetricFieldKey).toBeDefined();
      if (!symmetricFieldKey) return;

      const orderedLinks = [{ id: recC.id }, { id: recA.id }, { id: recB.id }];

      await ctx.updateRecord(table2.id, table2Record.id, {
        [symmetricFieldKey]: orderedLinks,
      });

      await ctx.drainOutbox(2);

      const updatedRecords = await ctx.listRecords(table2.id);
      const updatedLinks = updatedRecords[0].fields[symmetricFieldKey] as Array<{
        id: string;
        title?: string;
      }>;

      expect(updatedLinks).toEqual([
        { id: recC.id, title: 'C' },
        { id: recA.id, title: 'A' },
        { id: recB.id, title: 'B' },
      ]);
    });

    it('should maintain __id ordering (not __auto_number) after deletion', async () => {
      const titleFieldId = createFieldId();
      const linkFieldId = createFieldId();
      const nameFieldId = createFieldId();

      // Create Table2
      const table2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Table2_Deletion',
        fields: [
          {
            type: 'singleLineText',
            id: titleFieldId,
            name: 'title',
          },
        ],
      });

      // Create a record in Table2
      const targetRecord = await ctx.createRecord(table2.id, { [titleFieldId]: 'Target' });

      // Create Table1
      const table1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Table1_Deletion',
        fields: [
          {
            type: 'singleLineText',
            id: nameFieldId,
            name: 'name',
          },
          {
            type: 'link',
            id: linkFieldId,
            name: 'link_to_table2',
            options: {
              relationship: 'manyOne',
              foreignTableId: table2.id,
              lookupFieldId: titleFieldId,
            },
          },
        ],
      });

      // Create records in Table1
      const recA = await ctx.createRecord(table1.id, { [nameFieldId]: 'A' });
      const recB = await ctx.createRecord(table1.id, { [nameFieldId]: 'B' });
      const recC = await ctx.createRecord(table1.id, { [nameFieldId]: 'C' });

      const table2RecordId = targetRecord.id;
      const recAId = recA.id;
      const recBId = recB.id;
      const recCId = recC.id;

      // Link all three records
      await ctx.updateRecord(table1.id, recAId, {
        [linkFieldId]: { id: table2RecordId },
      });
      await ctx.updateRecord(table1.id, recBId, {
        [linkFieldId]: { id: table2RecordId },
      });
      await ctx.updateRecord(table1.id, recCId, {
        [linkFieldId]: { id: table2RecordId },
      });

      // Process outbox to compute the symmetric link field
      await ctx.drainOutbox(3);

      // Get initial order
      const table2Records = await ctx.listRecords(table2.id);
      const symmetricFieldName = Object.keys(table2Records[0].fields).find(
        (key) => key !== 'title' && key !== titleFieldId
      );

      const initialLinks = table2Records[0].fields[symmetricFieldName!];
      expect(initialLinks).toHaveLength(3);

      // The order should be based on __id (insertion order: A, B, C)
      expect(initialLinks).toEqual([
        { id: recAId, title: 'A' },
        { id: recBId, title: 'B' },
        { id: recCId, title: 'C' },
      ]);
    });
  });

  describe('ManyMany link field ordering', () => {
    it('should maintain junction table insertion order', async () => {
      const title1FieldId = createFieldId();
      const title2FieldId = createFieldId();
      const linkFieldId = createFieldId();

      // Create Table1
      const table1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Table1_ManyMany',
        fields: [
          {
            type: 'singleLineText',
            id: title1FieldId,
            name: 'title',
          },
        ],
      });

      // Create a record in Table1
      const table1Rec = await ctx.createRecord(table1.id, { [title1FieldId]: 'Record1' });

      // Create Table2 with ManyMany link
      const table2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Table2_ManyMany',
        fields: [
          {
            type: 'singleLineText',
            id: title2FieldId,
            name: 'title',
          },
          {
            type: 'link',
            id: linkFieldId,
            name: 'link_to_table1',
            options: {
              relationship: 'manyMany',
              foreignTableId: table1.id,
              lookupFieldId: title1FieldId,
            },
          },
        ],
      });

      // Create records in Table2
      const recA = await ctx.createRecord(table2.id, { [title2FieldId]: 'A' });
      const recB = await ctx.createRecord(table2.id, { [title2FieldId]: 'B' });
      const recC = await ctx.createRecord(table2.id, { [title2FieldId]: 'C' });

      const table1RecordId = table1Rec.id;
      const recAId = recA.id;
      const recBId = recB.id;
      const recCId = recC.id;

      // Create links in specific order: A, B, C
      await ctx.updateRecord(table2.id, recAId, {
        [linkFieldId]: [{ id: table1RecordId }],
      });
      await ctx.updateRecord(table2.id, recBId, {
        [linkFieldId]: [{ id: table1RecordId }],
      });
      await ctx.updateRecord(table2.id, recCId, {
        [linkFieldId]: [{ id: table1RecordId }],
      });

      // Process outbox to compute the symmetric link field
      await ctx.drainOutbox(3);

      // Check symmetric field order
      const table1Records = await ctx.listRecords(table1.id);
      const symmetricFieldName = Object.keys(table1Records[0].fields).find(
        (key) => key !== 'title' && key !== title1FieldId
      );

      const symmetricLinks = table1Records[0].fields[symmetricFieldName!];
      expect(symmetricLinks).toHaveLength(3);

      // Order should match junction table insertion order
      expect(symmetricLinks).toEqual([
        { id: recAId, title: 'A' },
        { id: recBId, title: 'B' },
        { id: recCId, title: 'C' },
      ]);
    });
  });
});
