/* eslint-disable @typescript-eslint/naming-convention */
/**
 * E2E tests for link field ordering.
 *
 * These tests verify that link field values maintain stable ordering,
 * particularly for symmetric (reverse) links where the order should be
 * determined by the insertion order (using junction table's __id as tie-breaker).
 *
 * The scenario tested:
 * - Table1 has a manyMany link to Table2
 * - Table2.record0 links to Table1.record0 (first link)
 * - Table2.record1 links to Table1.record0 (second link)
 * - When viewing Table1.record0's symmetric link, it should show [record0, record1]
 *   (in insertion order), not [record1, record0]
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('link field ordering (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  // ---------------------------------------------------------------------------
  // Setup & Teardown
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  describe('manyMany symmetric link ordering', () => {
    it('should maintain insertion order when viewing symmetric link', async () => {
      // Setup: Create Table1 (e.g., Projects)
      const table1NameFieldId = createFieldId();
      const table1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkOrder_Table1',
        fields: [{ type: 'singleLineText', id: table1NameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create a record in Table1 that will be linked to by Table2 records
      const table1Record = await ctx.createRecord(table1.id, {
        [table1NameFieldId]: 'Project A',
      });

      // Setup: Create Table2 (e.g., Tasks) with manyMany link to Table1
      const table2NameFieldId = createFieldId();
      const table2LinkFieldId = createFieldId();
      const table2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkOrder_Table2',
        fields: [
          { type: 'singleLineText', id: table2NameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: table2LinkFieldId,
            name: 'Projects',
            options: {
              relationship: 'manyMany',
              foreignTableId: table1.id,
              lookupFieldId: table1NameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Get the symmetric field ID from the table1 schema
      // After creating table2 with link, table1 should have a symmetric link field
      const table1WithLink = await ctx.getTableById(table1.id);
      const symmetricField = table1WithLink.fields.find(
        (f: { id: string; type: string; options?: { symmetricFieldId?: string } }) =>
          f.type === 'link' && f.options?.symmetricFieldId === table2LinkFieldId
      );
      expect(symmetricField).toBeDefined();
      if (!symmetricField) {
        throw new Error('Missing symmetric link field');
      }
      const symmetricFieldId = symmetricField.id;

      // Create Table2 records that link to Table1.record (in specific order)
      // First record: B1
      const table2Record1 = await ctx.createRecord(table2.id, {
        [table2NameFieldId]: 'B1',
        [table2LinkFieldId]: [{ id: table1Record.id }],
      });

      // Second record: B2 - also links to same Table1 record
      const table2Record2 = await ctx.createRecord(table2.id, {
        [table2NameFieldId]: 'B2',
        [table2LinkFieldId]: [{ id: table1Record.id }],
      });

      // Now fetch Table1 records and check the symmetric link order
      const table1Records = await ctx.listRecords(table1.id);
      expect(table1Records).toHaveLength(1);

      const symmetricLinkValue = table1Records[0].fields[symmetricFieldId] as Array<{
        id: string;
        title: string;
      }>;
      expect(Array.isArray(symmetricLinkValue)).toBe(true);
      expect(symmetricLinkValue).toHaveLength(2);

      // The order should be [B1, B2] because B1 was linked first
      // This relies on junction table's __id as tie-breaker
      expect(symmetricLinkValue[0].title).toBe('B1');
      expect(symmetricLinkValue[1].title).toBe('B2');
      expect(symmetricLinkValue[0].id).toBe(table2Record1.id);
      expect(symmetricLinkValue[1].id).toBe(table2Record2.id);
    });

    it('should maintain insertion order for multiple links added sequentially', async () => {
      // Setup: Create Table1
      const table1NameFieldId = createFieldId();
      const table1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkOrder_Sequential_Table1',
        fields: [{ type: 'singleLineText', id: table1NameFieldId, name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      // Create a target record
      const targetRecord = await ctx.createRecord(table1.id, {
        [table1NameFieldId]: 'Target',
      });

      // Setup: Create Table2 with manyMany link
      const table2NameFieldId = createFieldId();
      const table2LinkFieldId = createFieldId();
      const table2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LinkOrder_Sequential_Table2',
        fields: [
          { type: 'singleLineText', id: table2NameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: table2LinkFieldId,
            name: 'Link',
            options: {
              relationship: 'manyMany',
              foreignTableId: table1.id,
              lookupFieldId: table1NameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Get symmetric field ID
      const table1WithLink = await ctx.getTableById(table1.id);
      const symmetricField = table1WithLink.fields.find(
        (f: { type: string; options?: { symmetricFieldId?: string } }) =>
          f.type === 'link' && f.options?.symmetricFieldId === table2LinkFieldId
      );
      expect(symmetricField).toBeDefined();
      if (!symmetricField) {
        throw new Error('Missing symmetric link field');
      }
      const symmetricFieldId = symmetricField.id;

      // Create multiple Table2 records, each linking to the same target
      const recordNames = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
      const createdRecords = [];
      for (const name of recordNames) {
        const record = await ctx.createRecord(table2.id, {
          [table2NameFieldId]: name,
          [table2LinkFieldId]: [{ id: targetRecord.id }],
        });
        createdRecords.push(record);
      }

      // Fetch Table1 and verify order
      const table1Records = await ctx.listRecords(table1.id);
      const symmetricLinkValue = table1Records[0].fields[symmetricFieldId] as Array<{
        id: string;
        title: string;
      }>;

      expect(symmetricLinkValue).toHaveLength(5);

      // Verify order matches insertion order
      for (let i = 0; i < recordNames.length; i++) {
        expect(symmetricLinkValue[i].title).toBe(recordNames[i]);
        expect(symmetricLinkValue[i].id).toBe(createdRecords[i].id);
      }
    });
  });
});
