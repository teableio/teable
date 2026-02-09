/* eslint-disable @typescript-eslint/naming-convention */
import type { RecordFilter } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * E2E tests for v2 deleteByRange command.
 *
 * Uses shared test context for faster test execution.
 */
describe('v2 http deleteByRange (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  describe('basic deleteByRange operations', () => {
    let tableId: string;
    let viewId: string;
    let textFieldId: string;
    let numberFieldId: string;

    beforeEach(async () => {
      // Create a fresh table for each test
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DeleteByRange Test Table ${Date.now()}`,
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

      // Create initial records
      for (let i = 0; i < 5; i++) {
        await ctx.createRecord(tableId, {
          [textFieldId]: `Record ${i + 1}`,
          [numberFieldId]: (i + 1) * 10,
        });
      }
    });

    it('should delete a single row (cell range)', async () => {
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
      });

      expect(result.deletedCount).toBe(1);
      expect(result.deletedRecordIds).toHaveLength(1);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(4);
      expect(records[0].fields[textFieldId]).toBe('Record 2'); // Record 1 was deleted
    });

    it('should delete multiple rows in range', async () => {
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [
          [0, 1],
          [1, 2],
        ],
      });

      expect(result.deletedCount).toBe(2);
      expect(result.deletedRecordIds).toHaveLength(2);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(3);
      expect(records[0].fields[textFieldId]).toBe('Record 1'); // Unchanged
      expect(records[1].fields[textFieldId]).toBe('Record 4'); // Records 2 and 3 deleted
      expect(records[2].fields[textFieldId]).toBe('Record 5');
    });

    it('should delete entire row with type=rows', async () => {
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[2, 2]], // Row 2 (0-indexed)
        type: 'rows',
      });

      expect(result.deletedCount).toBe(1);
      expect(result.deletedRecordIds).toHaveLength(1);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(4);
      expect(records[0].fields[textFieldId]).toBe('Record 1');
      expect(records[1].fields[textFieldId]).toBe('Record 2');
      expect(records[2].fields[textFieldId]).toBe('Record 4'); // Record 3 was deleted
      expect(records[3].fields[textFieldId]).toBe('Record 5');
    });

    it('should delete multiple rows with type=rows', async () => {
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[1, 3]], // Rows 1-3
        type: 'rows',
      });

      expect(result.deletedCount).toBe(3);
      expect(result.deletedRecordIds).toHaveLength(3);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(2);
      expect(records[0].fields[textFieldId]).toBe('Record 1');
      expect(records[1].fields[textFieldId]).toBe('Record 5');
    });

    it('should delete all records with type=columns (all columns selected)', async () => {
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 2]], // Columns 0-2 (all columns)
        type: 'columns',
      });

      // Deleting all columns means deleting all rows
      expect(result.deletedCount).toBe(5);
      expect(result.deletedRecordIds).toHaveLength(5);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(0);
    });

    it('should return 0 when deleting range beyond existing records', async () => {
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [
          [0, 100],
          [1, 100],
        ],
      });

      expect(result.deletedCount).toBe(0);
      expect(result.deletedRecordIds).toHaveLength(0);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(5); // All records intact
    });

    it('should return deleted record IDs in the response', async () => {
      const records = await ctx.listRecords(tableId);
      const expectedDeletedId = records[0].id;

      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
      });

      expect(result.deletedRecordIds).toContain(expectedDeletedId);
    });
  });

  describe('deleteByRange with filter', () => {
    let tableId: string;
    let viewId: string;
    let textFieldId: string;
    let numberFieldId: string;
    let categoryFieldId: string;

    beforeEach(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Filter DeleteByRange Test Table ${Date.now()}`,
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

    it('should delete only filtered records with is operator', async () => {
      const filter: RecordFilter = {
        fieldId: categoryFieldId,
        operator: 'is',
        value: 'A',
      };

      // Delete all columns for filtered records
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 2]], // All columns
        type: 'columns',
        filter,
      });

      // Should only delete Category A records (3 records)
      expect(result.deletedCount).toBe(3);
      expect(result.deletedRecordIds).toHaveLength(3);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(2);

      // Only Category B records should remain
      expect(records[0].fields[textFieldId]).toBe('ItemB1');
      expect(records[1].fields[textFieldId]).toBe('ItemB2');
    });

    it('should delete filtered records with numeric filter', async () => {
      const filter: RecordFilter = {
        fieldId: numberFieldId,
        operator: 'isGreater',
        value: 25,
      };

      // Delete all rows for filtered records
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 4]], // All rows
        type: 'rows',
        filter,
      });

      // Should delete records with Count > 25 (Count: 30, 40, 50)
      expect(result.deletedCount).toBe(3);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(2);

      // Records with Count <= 25 should remain
      expect(records[0].fields[textFieldId]).toBe('ItemA1'); // Count: 10
      expect(records[1].fields[textFieldId]).toBe('ItemB1'); // Count: 20
    });

    it('should delete range within filtered records', async () => {
      const filter: RecordFilter = {
        fieldId: categoryFieldId,
        operator: 'is',
        value: 'A',
      };

      // Delete only first row within filtered view (ItemA1)
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 0]], // First row only
        type: 'rows',
        filter,
      });

      expect(result.deletedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(4);

      // ItemA1 was deleted, others remain
      expect(records.map((r) => r.fields[textFieldId])).toEqual([
        'ItemB1',
        'ItemA2',
        'ItemB2',
        'ItemA3',
      ]);
    });

    it('should use view default filter when filter is omitted', async () => {
      const viewFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryFieldId,
            operator: 'is',
            value: 'A',
          },
        ],
      };

      await ctx.testContainer.db
        .updateTable('view')
        .set({ filter: JSON.stringify(viewFilter) })
        .where('id', '=', viewId)
        .execute();

      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 0]],
        type: 'rows',
      });

      expect(result.deletedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      expect(records.map((r) => r.fields[textFieldId])).toEqual([
        'ItemB1',
        'ItemA2',
        'ItemB2',
        'ItemA3',
      ]);
    });
  });

  describe('deleteByRange event publishing', () => {
    let tableId: string;
    let viewId: string;
    let textFieldId: string;

    beforeEach(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Event DeleteByRange Test Table ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Value', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      textFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      // Create initial records
      for (let i = 0; i < 3; i++) {
        await ctx.createRecord(tableId, {
          [textFieldId]: `Record ${i + 1}`,
        });
      }
    });

    it('should publish RecordsDeleted event with record snapshots', async () => {
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 1]], // Rows 0-1
        type: 'rows',
      });

      expect(result.deletedCount).toBe(2);
      expect(result.events).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);

      const recordsDeletedEvent = result.events.find((e) => e.name === 'RecordsDeleted');
      expect(recordsDeletedEvent).toBeDefined();
    });

    it('should not publish events when no records deleted', async () => {
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[100, 100]], // Beyond existing records
        type: 'rows',
      });

      expect(result.deletedCount).toBe(0);
      expect(result.events).toHaveLength(0);
    });
  });

  describe('deleteByRange with groupBy', () => {
    let tableId: string;
    let viewId: string;
    let textFieldId: string;
    let categoryFieldId: string;
    let valueFieldId: string;

    beforeEach(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `GroupBy DeleteByRange Test Table ${Date.now()}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Category', type: 'singleLineText' },
          { name: 'Value', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      textFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      categoryFieldId = table.fields.find((f) => f.name === 'Category')?.id ?? '';
      valueFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      // Create records in specific order for testing groupBy behavior
      // Without groupBy, order is: A1(10), B1(20), A2(30), B2(40), A3(50)
      // With groupBy by Category asc: A1(10), A2(30), A3(50), B1(20), B2(40)
      const records = [
        { name: 'A1', category: 'A', value: 10 },
        { name: 'B1', category: 'B', value: 20 },
        { name: 'A2', category: 'A', value: 30 },
        { name: 'B2', category: 'B', value: 40 },
        { name: 'A3', category: 'A', value: 50 },
      ];

      for (const rec of records) {
        await ctx.createRecord(tableId, {
          [textFieldId]: rec.name,
          [categoryFieldId]: rec.category,
          [valueFieldId]: rec.value,
        });
      }
    });

    it('should delete first row in grouped view (groupBy category asc)', async () => {
      // With groupBy category asc, order is: A1, A2, A3, B1, B2
      // Row 0 should be A1
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 0]],
        type: 'rows',
        groupBy: [{ fieldId: categoryFieldId, order: 'asc' }],
      });

      expect(result.deletedCount).toBe(1);
      expect(result.deletedRecordIds).toHaveLength(1);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(4);

      // A1 should be deleted
      const names = records.map((r) => r.fields[textFieldId]);
      expect(names).not.toContain('A1');
      expect(names).toContain('A2');
      expect(names).toContain('A3');
      expect(names).toContain('B1');
      expect(names).toContain('B2');
    });

    it('should delete range in grouped view (groupBy category desc)', async () => {
      // With groupBy category desc, order is: B1, B2, A1, A2, A3
      // Rows 0-1 should be B1, B2
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 1]],
        type: 'rows',
        groupBy: [{ fieldId: categoryFieldId, order: 'desc' }],
      });

      expect(result.deletedCount).toBe(2);
      expect(result.deletedRecordIds).toHaveLength(2);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(3);

      // B1 and B2 should be deleted
      const names = records.map((r) => r.fields[textFieldId]);
      expect(names).not.toContain('B1');
      expect(names).not.toContain('B2');
      expect(names).toContain('A1');
      expect(names).toContain('A2');
      expect(names).toContain('A3');
    });

    it('should delete with groupBy and sort combined', async () => {
      // groupBy category asc, then sort by value desc within each group
      // Order should be: A3(50), A2(30), A1(10), B2(40), B1(20)
      // Row 0 should be A3
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 0]],
        type: 'rows',
        groupBy: [{ fieldId: categoryFieldId, order: 'asc' }],
        sort: [{ fieldId: valueFieldId, order: 'desc' }],
      });

      expect(result.deletedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(4);

      // A3 should be deleted (highest value in category A)
      const names = records.map((r) => r.fields[textFieldId]);
      expect(names).not.toContain('A3');
      expect(names).toContain('A1');
      expect(names).toContain('A2');
      expect(names).toContain('B1');
      expect(names).toContain('B2');
    });

    it('should delete with groupBy and filter combined', async () => {
      // Filter to only category B, then groupBy value asc
      // Filtered records: B1(20), B2(40)
      // With groupBy value asc: B1(20), B2(40)
      // Row 0 should be B1
      const result = await ctx.deleteByRange({
        tableId,
        viewId,
        ranges: [[0, 0]],
        type: 'rows',
        filter: {
          fieldId: categoryFieldId,
          operator: 'is',
          value: 'B',
        },
        groupBy: [{ fieldId: valueFieldId, order: 'asc' }],
      });

      expect(result.deletedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      expect(records).toHaveLength(4);

      // B1 should be deleted (first in filtered and grouped view)
      const names = records.map((r) => r.fields[textFieldId]);
      expect(names).not.toContain('B1');
      expect(names).toContain('A1');
      expect(names).toContain('A2');
      expect(names).toContain('A3');
      expect(names).toContain('B2');
    });
  });

  describe('deleteByRange with multi-column sort', () => {
    let multiSortTableId: string;
    let multiSortViewId: string;
    let multiSortNameFieldId: string;
    let multiSortGroupFieldId: string;
    let multiSortScoreFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Delete Multi Sort Table',
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

    it('should delete correct row with two sort keys', async () => {
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
        throw new Error('Expected record not found for multi-column sort delete');
      }

      const result = await ctx.deleteByRange({
        tableId: multiSortTableId,
        viewId: multiSortViewId,
        ranges: [[targetOffset, targetOffset]],
        type: 'rows',
        sort: [
          { fieldId: multiSortGroupFieldId, order: 'asc' },
          { fieldId: multiSortScoreFieldId, order: 'desc' },
        ],
      });

      expect(result.deletedCount).toBe(1);

      const updatedRecords = await ctx.listRecords(multiSortTableId);
      const deleted = updatedRecords.find((record) => record.id === expectedId);
      expect(deleted).toBeUndefined();
    });
  });

  describe('deleteByRange with large offset and stable tie-breaker', () => {
    let tieTableId: string;
    let tieViewId: string;
    let tieNameFieldId: string;
    let tieValueFieldId: string;
    let tieDbTableName: string;
    const rowCount = 600;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Delete Large Offset Tie Table',
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

    it('should delete correct row at large offset when sort values tie', async () => {
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
        throw new Error('Expected record not found for large offset delete');
      }

      const result = await ctx.deleteByRange({
        tableId: tieTableId,
        viewId: tieViewId,
        ranges: [[targetOffset, targetOffset]],
        type: 'rows',
        sort: [{ fieldId: tieValueFieldId, order: 'desc' }],
      });

      expect(result.deletedCount).toBe(1);

      const records = await ctx.listRecords(tieTableId, { limit: rowCount });
      const deleted = records.find((r) => r.id === expectedId);
      expect(deleted).toBeUndefined();
    });
  });
});
