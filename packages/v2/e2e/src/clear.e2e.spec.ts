/* eslint-disable @typescript-eslint/naming-convention */
import type { RecordFilter } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * E2E tests for v2 clear command.
 *
 * Uses shared test context for faster test execution.
 */
describe('v2 http clear (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  describe('basic clear operations', () => {
    let tableId: string;
    let viewId: string;
    let textFieldId: string;
    let numberFieldId: string;
    let notesFieldId: string;

    beforeEach(async () => {
      // Create a fresh table for each test
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Clear Test Table ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Count', type: 'number' },
          { name: 'Notes', type: 'longText' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      textFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Count')?.id ?? '';
      notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';

      // Create initial records
      for (let i = 0; i < 5; i++) {
        await ctx.createRecord(tableId, {
          [textFieldId]: `Record ${i + 1}`,
          [numberFieldId]: (i + 1) * 10,
          [notesFieldId]: `Note ${i + 1}`,
        });
      }
    });

    it('should clear a single cell', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      expect(records[0].fields[textFieldId]).toBeNull();
      expect(records[0].fields[numberFieldId]).toBe(10); // Unchanged
    });

    it('should clear a range of cells', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [
          [0, 1],
          [1, 2],
        ],
      });

      expect(result.updatedCount).toBe(2);

      const records = await ctx.listRecords(tableId);
      // Row 0 should be unchanged
      expect(records[0].fields[textFieldId]).toBe('Record 1');
      expect(records[0].fields[numberFieldId]).toBe(10);

      // Rows 1 and 2 should be cleared (columns 0 and 1)
      expect(records[1].fields[textFieldId]).toBeNull();
      expect(records[1].fields[numberFieldId]).toBeNull();
      expect(records[2].fields[textFieldId]).toBeNull();
      expect(records[2].fields[numberFieldId]).toBeNull();

      // Rows 3 and 4 should be unchanged
      expect(records[3].fields[textFieldId]).toBe('Record 4');
      expect(records[4].fields[textFieldId]).toBe('Record 5');
    });

    it('should clear entire column with type=columns', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [[1, 1]], // Column 1 (Count)
        type: 'columns',
      });

      // Should clear all 5 records
      expect(result.updatedCount).toBe(5);

      const records = await ctx.listRecords(tableId);
      for (const record of records) {
        expect(record.fields[numberFieldId]).toBeNull();
      }
      // Name column should be unchanged
      expect(records[0].fields[textFieldId]).toBe('Record 1');
      expect(records[4].fields[textFieldId]).toBe('Record 5');
    });

    it('should clear entire row with type=rows', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [[2, 2]], // Row 2 (0-indexed)
        type: 'rows',
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      // Rows 0, 1 should be unchanged
      expect(records[0].fields[textFieldId]).toBe('Record 1');
      expect(records[1].fields[textFieldId]).toBe('Record 2');

      // Row 2 should be cleared
      expect(records[2].fields[textFieldId]).toBeNull();
      expect(records[2].fields[numberFieldId]).toBeNull();

      // Rows 3, 4 should be unchanged
      expect(records[3].fields[textFieldId]).toBe('Record 4');
      expect(records[4].fields[textFieldId]).toBe('Record 5');
    });

    it('should clear multiple rows with type=rows', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [[1, 3]], // Rows 1-3
        type: 'rows',
      });

      expect(result.updatedCount).toBe(3);

      const records = await ctx.listRecords(tableId);
      // Row 0 should be unchanged
      expect(records[0].fields[textFieldId]).toBe('Record 1');

      // Rows 1, 2, 3 should be cleared
      expect(records[1].fields[textFieldId]).toBeNull();
      expect(records[2].fields[textFieldId]).toBeNull();
      expect(records[3].fields[textFieldId]).toBeNull();

      // Row 4 should be unchanged
      expect(records[4].fields[textFieldId]).toBe('Record 5');
    });

    it('should return 0 when clearing range beyond existing records', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [
          [0, 100],
          [1, 100],
        ],
      });

      expect(result.updatedCount).toBe(0);
    });

    it('should return 0 when clearing range beyond existing columns', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [
          [10, 0],
          [10, 0],
        ],
      });

      expect(result.updatedCount).toBe(0);
    });

    it('should clear by projection column order when projection is provided', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [
          [1, 0],
          [1, 0],
        ],
        projection: [textFieldId, notesFieldId],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      expect(records[0].fields[notesFieldId]).toBeNull();
      expect(records[0].fields[numberFieldId]).toBe(10);
      expect(records[0].fields[textFieldId]).toBe('Record 1');
    });
  });

  describe('clear with required fields', () => {
    let tableId: string;
    let viewId: string;
    let requiredFieldId: string;
    let optionalFieldId: string;

    beforeEach(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Clear Required Test Table ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Required', type: 'singleLineText', notNull: true },
          { name: 'Optional', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      requiredFieldId = table.fields.find((f) => f.name === 'Required')?.id ?? '';
      optionalFieldId = table.fields.find((f) => f.name === 'Optional')?.id ?? '';

      await ctx.createRecords(tableId, [
        {
          fields: {
            [requiredFieldId]: 'req-1',
            [optionalFieldId]: 'opt-1',
          },
        },
        {
          fields: {
            [requiredFieldId]: 'req-2',
            [optionalFieldId]: 'opt-2',
          },
        },
      ]);
    });

    it('should throw validation error when clearing notNull fields', async () => {
      await expect(
        ctx.clear({
          tableId,
          viewId,
          ranges: [[1, 1]], // Required column only
          type: 'columns',
        })
      ).rejects.toThrow();

      // Records should remain unchanged
      const records = await ctx.listRecords(tableId);
      expect(records.map((record) => record.fields[requiredFieldId])).toEqual(['req-1', 'req-2']);
    });
  });

  describe('clear with filter', () => {
    let tableId: string;
    let viewId: string;
    let textFieldId: string;
    let numberFieldId: string;
    let categoryFieldId: string;

    beforeEach(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Filter Clear Test Table ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Count', type: 'number' },
          { name: 'Category', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      textFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Count')?.id ?? '';
      categoryFieldId = table.fields.find((f) => f.name === 'Category')?.id ?? '';

      // Create records with different categories
      const records = [
        { name: 'ItemA1', count: 10, category: 'A' },
        { name: 'ItemB1', count: 20, category: 'B' },
        { name: 'ItemA2', count: 30, category: 'A' },
        { name: 'ItemB2', count: 40, category: 'B' },
        { name: 'ItemA3', count: 50, category: 'A' },
      ];

      for (const rec of records) {
        await ctx.createRecord(tableId, {
          [textFieldId]: rec.name,
          [numberFieldId]: rec.count,
          [categoryFieldId]: rec.category,
        });
      }
    });

    it('should clear only filtered records with is operator', async () => {
      const filter: RecordFilter = {
        fieldId: categoryFieldId,
        operator: 'is',
        value: 'A',
      };

      // Clear first column (Name) for filtered records
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [[0, 0]], // Column 0
        type: 'columns',
        filter,
      });

      // Should only clear Category A records (3 records)
      expect(result.updatedCount).toBe(3);

      const records = await ctx.listRecords(tableId);

      // Items with category A should have Name cleared
      expect(records[0].fields[textFieldId]).toBeNull(); // ItemA1
      expect(records[2].fields[textFieldId]).toBeNull(); // ItemA2
      expect(records[4].fields[textFieldId]).toBeNull(); // ItemA3

      // Items with category B should remain unchanged
      expect(records[1].fields[textFieldId]).toBe('ItemB1');
      expect(records[3].fields[textFieldId]).toBe('ItemB2');
    });

    it('should clear filtered records with numeric filter', async () => {
      const filter: RecordFilter = {
        fieldId: numberFieldId,
        operator: 'isGreater',
        value: 25,
      };

      // Clear all columns for filtered records
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [[0, 2]], // Columns 0-2
        type: 'columns',
        filter,
      });

      // Should clear records with Count > 25 (Count: 30, 40, 50)
      expect(result.updatedCount).toBe(3);

      const records = await ctx.listRecords(tableId);

      // Records with Count <= 25 should remain unchanged
      expect(records[0].fields[textFieldId]).toBe('ItemA1'); // Count: 10
      expect(records[1].fields[textFieldId]).toBe('ItemB1'); // Count: 20

      // Records with Count > 25 should be cleared
      expect(records[2].fields[textFieldId]).toBeNull(); // Count: 30
      expect(records[3].fields[textFieldId]).toBeNull(); // Count: 40
      expect(records[4].fields[textFieldId]).toBeNull(); // Count: 50
    });
  });

  describe('clear with sort (view row order)', () => {
    /**
     * Critical test for ensuring clear operations target the correct rows
     * when a view has custom sort order.
     *
     * Without the sort parameter, clear would use the default __auto_number order,
     * causing clears to target the wrong records.
     */
    let sortTableId: string;
    let sortViewId: string;
    let sortNameFieldId: string;
    let sortValueFieldId: string;

    beforeEach(async () => {
      // Create a table for sort tests
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Sort Clear Test Table ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Value', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      sortTableId = table.id;
      sortViewId = table.views[0].id;
      sortNameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      sortValueFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      // Create records with specific values for easy identification
      // Creation order: A(100), B(200), C(300), D(400), E(500)
      // Default order (by auto_number): A, B, C, D, E
      // Descending by Value: E(500), D(400), C(300), B(200), A(100)
      for (const [name, value] of [
        ['RecordA', 100],
        ['RecordB', 200],
        ['RecordC', 300],
        ['RecordD', 400],
        ['RecordE', 500],
      ] as const) {
        await ctx.createRecord(sortTableId, {
          [sortNameFieldId]: name,
          [sortValueFieldId]: value,
        });
      }
    });

    it('should clear correct row when sort is specified (descending)', async () => {
      /**
       * Test scenario:
       * - Records in creation order: A(100), B(200), C(300), D(400), E(500)
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Clear row 0 with sort=[{fieldId: valueFieldId, order: 'desc'}]
       * - Should clear E's Name (first in DESC order), NOT A (first in creation order)
       */
      const result = await ctx.clear({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        sort: [{ fieldId: sortValueFieldId, order: 'desc' }],
      });

      expect(result.updatedCount).toBe(1);

      // Verify E was cleared (not A)
      const records = await ctx.listRecords(sortTableId);
      const recordE = records.find((r) => r.fields[sortValueFieldId] === 500);
      const recordA = records.find((r) => r.fields[sortValueFieldId] === 100);

      expect(recordE?.fields[sortNameFieldId]).toBeNull();
      expect(recordA?.fields[sortNameFieldId]).toBe('RecordA'); // Should remain unchanged
    });

    it('should clear multiple rows in correct sort order', async () => {
      /**
       * Test scenario:
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Clear rows 1-3 with sort DESC
       * - Should clear D, C, B's Name fields (rows 1-3 in DESC order)
       */
      const result = await ctx.clear({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 1],
          [0, 3],
        ],
        sort: [{ fieldId: sortValueFieldId, order: 'desc' }],
      });

      expect(result.updatedCount).toBe(3);

      // Verify D, C, B were cleared in order
      const records = await ctx.listRecords(sortTableId);
      const recordD = records.find((r) => r.fields[sortValueFieldId] === 400);
      const recordC = records.find((r) => r.fields[sortValueFieldId] === 300);
      const recordB = records.find((r) => r.fields[sortValueFieldId] === 200);
      const recordE = records.find((r) => r.fields[sortValueFieldId] === 500);
      const recordA = records.find((r) => r.fields[sortValueFieldId] === 100);

      // D, C, B should be cleared (rows 1-3 in DESC order)
      expect(recordD?.fields[sortNameFieldId]).toBeNull();
      expect(recordC?.fields[sortNameFieldId]).toBeNull();
      expect(recordB?.fields[sortNameFieldId]).toBeNull();

      // E and A should remain unchanged (row 0 and row 4, not in clear range)
      expect(recordE?.fields[sortNameFieldId]).toBe('RecordE');
      expect(recordA?.fields[sortNameFieldId]).toBe('RecordA');
    });

    it('should clear correct row with ascending sort', async () => {
      /**
       * Test scenario:
       * - View sorted by Value ASC: A(100), B(200), C(300), D(400), E(500)
       * - This matches creation order, so row 0 should be A
       * - Clear row 0 with sort ASC
       * - Should clear A's Name (first in ASC order)
       */
      const result = await ctx.clear({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        sort: [{ fieldId: sortValueFieldId, order: 'asc' }],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(sortTableId);
      const recordA = records.find((r) => r.fields[sortValueFieldId] === 100);
      const recordE = records.find((r) => r.fields[sortValueFieldId] === 500);

      expect(recordA?.fields[sortNameFieldId]).toBeNull();
      expect(recordE?.fields[sortNameFieldId]).toBe('RecordE'); // Should remain unchanged
    });

    it('should clear entire rows (type=rows) with sort order', async () => {
      /**
       * Test scenario:
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Clear row 0 (entire row) with type=rows and sort DESC
       * - Should clear both Name and Value of E
       */
      const result = await ctx.clear({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [[0, 0]], // Row 0
        type: 'rows',
        sort: [{ fieldId: sortValueFieldId, order: 'desc' }],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(sortTableId);
      const recordE = records.find(
        (r) => r.fields[sortValueFieldId] === 500 || r.fields[sortValueFieldId] === null
      );
      const recordA = records.find((r) => r.fields[sortValueFieldId] === 100);

      // E should have both fields cleared
      expect(recordE?.fields[sortNameFieldId]).toBeNull();
      expect(recordE?.fields[sortValueFieldId]).toBeNull();

      // A should remain unchanged
      expect(recordA?.fields[sortNameFieldId]).toBe('RecordA');
      expect(recordA?.fields[sortValueFieldId]).toBe(100);
    });
  });

  describe('clear with multi-column sort', () => {
    let multiSortTableId: string;
    let multiSortViewId: string;
    let multiSortNameFieldId: string;
    let multiSortGroupFieldId: string;
    let multiSortScoreFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Clear Multi Sort Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Group', type: 'singleLineText' },
          { name: 'Score', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      multiSortTableId = table.id;
      multiSortViewId = table.views[0].id;
      multiSortNameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      multiSortGroupFieldId = table.fields.find((f) => f.name === 'Group')?.id ?? '';
      multiSortScoreFieldId = table.fields.find((f) => f.name === 'Score')?.id ?? '';

      await ctx.createRecord(multiSortTableId, {
        [multiSortNameFieldId]: 'A1',
        [multiSortGroupFieldId]: 'A',
        [multiSortScoreFieldId]: 10,
      });
      await ctx.createRecord(multiSortTableId, {
        [multiSortNameFieldId]: 'A2',
        [multiSortGroupFieldId]: 'A',
        [multiSortScoreFieldId]: 30,
      });
      await ctx.createRecord(multiSortTableId, {
        [multiSortNameFieldId]: 'A3',
        [multiSortGroupFieldId]: 'A',
        [multiSortScoreFieldId]: 20,
      });
      await ctx.createRecord(multiSortTableId, {
        [multiSortNameFieldId]: 'B1',
        [multiSortGroupFieldId]: 'B',
        [multiSortScoreFieldId]: 5,
      });
      await ctx.createRecord(multiSortTableId, {
        [multiSortNameFieldId]: 'B2',
        [multiSortGroupFieldId]: 'B',
        [multiSortScoreFieldId]: 15,
      });
      await ctx.createRecord(multiSortTableId, {
        [multiSortNameFieldId]: 'B3',
        [multiSortGroupFieldId]: 'B',
        [multiSortScoreFieldId]: 25,
      });
    }, 30000);

    it('should clear correct row with two sort keys', async () => {
      const records = await ctx.listRecords(multiSortTableId);
      const sorted = [...records].sort((left, right) => {
        const leftGroup = String(left.fields[multiSortGroupFieldId] ?? '');
        const rightGroup = String(right.fields[multiSortGroupFieldId] ?? '');
        if (leftGroup !== rightGroup) {
          return leftGroup.localeCompare(rightGroup);
        }
        const leftScore = Number(left.fields[multiSortScoreFieldId] ?? 0);
        const rightScore = Number(right.fields[multiSortScoreFieldId] ?? 0);
        return rightScore - leftScore;
      });

      const targetOffset = 4;
      const expectedId = sorted[targetOffset]?.id;
      if (!expectedId) {
        throw new Error('Expected record not found for multi-column sort clear');
      }

      const result = await ctx.clear({
        tableId: multiSortTableId,
        viewId: multiSortViewId,
        ranges: [
          [0, targetOffset],
          [0, targetOffset],
        ],
        sort: [
          { fieldId: multiSortGroupFieldId, order: 'asc' },
          { fieldId: multiSortScoreFieldId, order: 'desc' },
        ],
      });

      expect(result.updatedCount).toBe(1);

      const updatedRecords = await ctx.listRecords(multiSortTableId);
      const updated = updatedRecords.find((record) => record.id === expectedId);
      expect(updated?.fields[multiSortNameFieldId]).toBeNull();
    });
  });

  describe('clear with view default sort', () => {
    let defaultSortTableId: string;
    let defaultSortViewId: string;
    let defaultSortNameFieldId: string;
    let defaultSortValueFieldId: string;

    beforeEach(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `View Default Sort Clear Table ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Value', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      defaultSortTableId = table.id;
      defaultSortViewId = table.views[0].id;
      defaultSortNameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      defaultSortValueFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      for (const [name, value] of [
        ['RecordA', 100],
        ['RecordB', 200],
        ['RecordC', 300],
        ['RecordD', 400],
        ['RecordE', 500],
      ] as const) {
        await ctx.createRecord(defaultSortTableId, {
          [defaultSortNameFieldId]: name,
          [defaultSortValueFieldId]: value,
        });
      }

      await ctx.testContainer.db
        .updateTable('view')
        .set({
          sort: JSON.stringify({
            sortObjs: [{ fieldId: defaultSortValueFieldId, order: 'desc' }],
          }),
        })
        .where('id', '=', defaultSortViewId)
        .execute();
    });

    it('should clear row using view default sort when sort is omitted', async () => {
      const result = await ctx.clear({
        tableId: defaultSortTableId,
        viewId: defaultSortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(defaultSortTableId);
      const recordE = records.find((r) => r.fields[defaultSortValueFieldId] === 500);
      const recordA = records.find((r) => r.fields[defaultSortValueFieldId] === 100);

      expect(recordE?.fields[defaultSortNameFieldId]).toBeNull();
      expect(recordA?.fields[defaultSortNameFieldId]).toBe('RecordA');
    });
  });

  describe('clear with view group and sort defaults', () => {
    let groupTableId: string;
    let groupViewId: string;
    let groupNameFieldId: string;
    let groupCategoryFieldId: string;
    let groupValueFieldId: string;
    let recordB1Id: string;
    let recordB2Id: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Clear Group Defaults Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Category', type: 'singleLineText' },
          { name: 'Value', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      groupTableId = table.id;
      groupViewId = table.views[0].id;
      groupNameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      groupCategoryFieldId = table.fields.find((f) => f.name === 'Category')?.id ?? '';
      groupValueFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      await ctx.createRecord(groupTableId, {
        [groupNameFieldId]: 'A1',
        [groupCategoryFieldId]: 'A',
        [groupValueFieldId]: 50,
      });
      recordB1Id = (
        await ctx.createRecord(groupTableId, {
          [groupNameFieldId]: 'B1',
          [groupCategoryFieldId]: 'B',
          [groupValueFieldId]: 40,
        })
      ).id;
      await ctx.createRecord(groupTableId, {
        [groupNameFieldId]: 'A2',
        [groupCategoryFieldId]: 'A',
        [groupValueFieldId]: 30,
      });
      recordB2Id = (
        await ctx.createRecord(groupTableId, {
          [groupNameFieldId]: 'B2',
          [groupCategoryFieldId]: 'B',
          [groupValueFieldId]: 20,
        })
      ).id;
      await ctx.createRecord(groupTableId, {
        [groupNameFieldId]: 'A3',
        [groupCategoryFieldId]: 'A',
        [groupValueFieldId]: 10,
      });

      await ctx.testContainer.db
        .updateTable('view')
        .set({
          group: JSON.stringify([{ fieldId: groupCategoryFieldId, order: 'asc' }]),
          sort: JSON.stringify({
            sortObjs: [{ fieldId: groupValueFieldId, order: 'desc' }],
          }),
        })
        .where('id', '=', groupViewId)
        .execute();
    }, 30000);

    it('should respect view group + sort defaults when sort is omitted', async () => {
      const result = await ctx.clear({
        tableId: groupTableId,
        viewId: groupViewId,
        ranges: [
          [0, 3],
          [0, 3],
        ],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(groupTableId);
      const recordB1 = records.find((record) => record.id === recordB1Id);
      const recordB2 = records.find((record) => record.id === recordB2Id);

      expect(recordB1?.fields[groupNameFieldId]).toBeNull();
      expect(recordB2?.fields[groupNameFieldId]).toBe('B2');
    });
  });

  describe('clear with request groupBy override', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    let categoryFieldId: string;
    let valueFieldId: string;
    let recordA1Id: string;
    let recordB1Id: string;

    beforeEach(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Clear Group Override Table ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Category', type: 'singleLineText' },
          { name: 'Value', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      categoryFieldId = table.fields.find((f) => f.name === 'Category')?.id ?? '';
      valueFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      recordA1Id = (
        await ctx.createRecord(tableId, {
          [nameFieldId]: 'A1',
          [categoryFieldId]: 'A',
          [valueFieldId]: 50,
        })
      ).id;
      recordB1Id = (
        await ctx.createRecord(tableId, {
          [nameFieldId]: 'B1',
          [categoryFieldId]: 'B',
          [valueFieldId]: 40,
        })
      ).id;
      await ctx.createRecord(tableId, {
        [nameFieldId]: 'A2',
        [categoryFieldId]: 'A',
        [valueFieldId]: 30,
      });
      await ctx.createRecord(tableId, {
        [nameFieldId]: 'B2',
        [categoryFieldId]: 'B',
        [valueFieldId]: 20,
      });

      await ctx.testContainer.db
        .updateTable('view')
        .set({
          group: JSON.stringify([{ fieldId: categoryFieldId, order: 'asc' }]),
          sort: JSON.stringify({
            sortObjs: [{ fieldId: valueFieldId, order: 'desc' }],
          }),
        })
        .where('id', '=', viewId)
        .execute();
    });

    it('should use request groupBy instead of view default group', async () => {
      const result = await ctx.clear({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        groupBy: [{ fieldId: categoryFieldId, order: 'desc' }],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      const recordA1 = records.find((record) => record.id === recordA1Id);
      const recordB1 = records.find((record) => record.id === recordB1Id);

      expect(recordB1?.fields[nameFieldId]).toBeNull();
      expect(recordA1?.fields[nameFieldId]).toBe('A1');
    });
  });

  describe('clear with large offset and stable tie-breaker', () => {
    let tieTableId: string;
    let tieViewId: string;
    let tieNameFieldId: string;
    let tieValueFieldId: string;
    let tieDbTableName: string;
    const rowCount = 600;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Clear Large Offset Tie Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Value', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      tieTableId = table.id;
      tieViewId = table.views[0].id;
      tieNameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      tieValueFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const batchSize = 200;
      for (let i = 0; i < rowCount; i += batchSize) {
        const batch = Array.from({ length: Math.min(batchSize, rowCount - i) }, (_, idx) => ({
          fields: {
            [tieNameFieldId]: `Row${i + idx}`,
            [tieValueFieldId]: 1,
          },
        }));
        await ctx.createRecords(tieTableId, batch);
      }

      const tableMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', tieTableId)
        .executeTakeFirst();
      tieDbTableName = tableMeta?.db_table_name ?? '';

      const orderColumn = `__row_${tieViewId}`;
      await sql`
        ALTER TABLE ${sql.table(tieDbTableName)}
        ADD COLUMN IF NOT EXISTS ${sql.id(orderColumn)} double precision
      `.execute(ctx.testContainer.db);
      await sql`
        UPDATE ${sql.table(tieDbTableName)}
        SET ${sql.ref(orderColumn)} = ${rowCount + 1} - ${sql.ref('__auto_number')}
      `.execute(ctx.testContainer.db);
    }, 30000);

    it('should clear correct row at large offset when sort values tie', async () => {
      const targetOffset = 400;
      const orderColumn = `__row_${tieViewId}`;
      const expected = await sql<{ __id: string }>`
        SELECT "__id"
        FROM ${sql.table(tieDbTableName)}
        ORDER BY ${sql.ref(orderColumn)} ASC
        OFFSET ${targetOffset}
        LIMIT 1
      `.execute(ctx.testContainer.db);

      const expectedId = expected.rows[0]?.__id;
      if (!expectedId) {
        throw new Error('Expected record not found for large offset clear');
      }

      const result = await ctx.clear({
        tableId: tieTableId,
        viewId: tieViewId,
        ranges: [
          [0, targetOffset],
          [0, targetOffset],
        ],
        sort: [{ fieldId: tieValueFieldId, order: 'desc' }],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(tieTableId, { limit: rowCount });
      const updated = records.find((r) => r.id === expectedId);
      expect(updated?.fields[tieNameFieldId]).toBeNull();
    });
  });
});
