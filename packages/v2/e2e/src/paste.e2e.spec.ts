/* eslint-disable @typescript-eslint/naming-convention */
import type { RecordFilter } from '@teable/v2-core';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * E2E tests for v2 paste command.
 */
describe('v2 http paste (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let viewId: string;
  let textFieldId: string;
  let numberFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create table with fields
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Paste Test Table',
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
        [numberFieldId]: i * 10,
      });
    }
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  it('should paste and update existing records', async () => {
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [1, 1],
      ],
      content: [
        ['Updated Record 1', 100],
        ['Updated Record 2', 200],
      ],
    });

    expect(result.updatedCount).toBe(2);
    expect(result.createdCount).toBe(0);

    // Verify the updates
    const records = await ctx.listRecords(tableId);
    expect(records[0].fields[textFieldId]).toBe('Updated Record 1');
    expect(records[0].fields[numberFieldId]).toBe(100);
    expect(records[1].fields[textFieldId]).toBe('Updated Record 2');
    expect(records[1].fields[numberFieldId]).toBe(200);
  });

  it('should create new records when paste exceeds existing', async () => {
    // First, get current record count
    const { pagination } = await ctx.listRecordsWithPagination(tableId);
    const beforeCount = pagination.total;

    // Paste starting from the last row + 2 (so we create new records)
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, beforeCount],
        [1, beforeCount + 1],
      ],
      content: [
        ['New Record A', 1000],
        ['New Record B', 2000],
      ],
    });

    expect(result.createdCount).toBe(2);
  });

  it('should handle empty paste content', async () => {
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [],
    });

    expect(result.updatedCount).toBe(0);
    expect(result.createdCount).toBe(0);
  });

  it('should handle single cell paste', async () => {
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 2],
        [0, 2],
      ],
      content: [['Single Cell Value']],
    });

    expect(result.updatedCount).toBe(1);

    // Verify
    const records = await ctx.listRecords(tableId);
    expect(records[2].fields[textFieldId]).toBe('Single Cell Value');
  });

  it('should ignore paste values for button fields', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Paste Button Field Table',
      fields: [
        { name: 'Title', type: 'singleLineText', isPrimary: true },
        { name: 'Action', type: 'button', options: { label: 'Run' } },
      ],
      views: [{ type: 'grid' }],
    });

    const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const buttonFieldId = table.fields.find((field) => field.type === 'button')?.id ?? '';

    await ctx.createRecord(table.id, { [primaryFieldId]: 'Row 1' });

    const result = await ctx.paste({
      tableId: table.id,
      viewId: table.views[0].id,
      ranges: [
        [1, 0],
        [1, 0],
      ],
      content: [['Click']],
      typecast: true,
    });

    expect(result.updatedCount).toBe(1);

    const records = await ctx.listRecords(table.id);
    expect(records[0].fields[primaryFieldId]).toBe('Row 1');
    expect(records[0].fields[buttonFieldId]).toBeNull();
  });

  it('should paste when lastModifiedTime field exists', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Paste LastModifiedTime Table',
      fields: [
        { name: 'Title', type: 'singleLineText', isPrimary: true },
        {
          name: 'Updated At',
          type: 'lastModifiedTime',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const lastModifiedTimeFieldId =
      table.fields.find((field) => field.type === 'lastModifiedTime')?.id ?? '';

    await ctx.createRecord(table.id, {
      [primaryFieldId]: 'Before Paste',
    });

    const beforeRecords = await ctx.listRecords(table.id);
    const beforeLastModified = beforeRecords[0].fields[lastModifiedTimeFieldId];

    const result = await ctx.paste({
      tableId: table.id,
      viewId: table.views[0].id,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['After Paste']],
    });

    expect(result.updatedCount).toBe(1);

    const afterRecords = await ctx.listRecords(table.id);
    const afterLastModified = afterRecords[0].fields[lastModifiedTimeFieldId];

    expect(typeof afterLastModified).toBe('string');
    if (beforeLastModified) {
      expect(afterLastModified).not.toBe(beforeLastModified);
    }
  });

  it('should return correct update and create counts', async () => {
    // Get current count
    const { pagination } = await ctx.listRecordsWithPagination(tableId);
    const total = pagination.total;

    // Paste that overlaps existing records and creates new ones
    // Paste 3 rows starting from row (total - 1), so 1 update + 2 creates
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, total - 1],
        [0, total + 1],
      ],
      content: [['Overlap Row'], ['New Row 1'], ['New Row 2']],
    });

    expect(result.updatedCount).toBe(1);
    expect(result.createdCount).toBe(2);
  });

  it('should apply typecast when enabled', async () => {
    // Paste string numbers that should be converted to numbers
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [1, 0],
        [1, 0],
      ],
      content: [['999']], // String that should be converted to number
      typecast: true,
    });

    expect(result.updatedCount).toBe(1);

    // Verify the value was converted
    const records = await ctx.listRecords(tableId);
    expect(records[0].fields[numberFieldId]).toBe(999);
  });

  it('should apply typecast when creating new records (regression test for string to number conversion)', async () => {
    /**
     * Regression test for bug:
     * When pasting content to create new records, typecast was not being applied
     * to the createRecordsStream method. This caused string values like "8888"
     * to fail validation with: "Invalid value for field X: expected number, received string"
     *
     * The fix ensures typecast option is passed from PasteHandler to createRecordsStream.
     */
    const { pagination } = await ctx.listRecordsWithPagination(tableId);
    const beforeCount = pagination.total;

    // Paste beyond existing records to trigger CREATE (not update)
    // Use string values for the number field to test typecast during record creation
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, beforeCount],
        [1, beforeCount + 2],
      ],
      content: [
        ['Typecast New 1', '1234'], // String for number field
        ['Typecast New 2', '5678.9'], // Float string for number field
        ['Typecast New 3', ''], // Empty string should become null
      ],
      typecast: true,
    });

    // All 3 should be created (not updates)
    expect(result.createdCount).toBe(3);
    expect(result.updatedCount).toBe(0);

    // Verify the values were correctly typecasted
    const records = await ctx.listRecords(tableId);
    const newRecords = records.slice(beforeCount);

    expect(newRecords[0].fields[textFieldId]).toBe('Typecast New 1');
    expect(newRecords[0].fields[numberFieldId]).toBe(1234);

    expect(newRecords[1].fields[textFieldId]).toBe('Typecast New 2');
    expect(newRecords[1].fields[numberFieldId]).toBe(5678.9);

    expect(newRecords[2].fields[textFieldId]).toBe('Typecast New 3');
    expect(newRecords[2].fields[numberFieldId]).toBeNull();
  });

  it('auto creates select options when typecast is enabled', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Paste Select Auto',
      fields: [
        { name: 'Title', type: 'singleLineText', isPrimary: true },
        { name: 'Status', type: 'singleSelect', options: ['Open'] },
        { name: 'Tags', type: 'multipleSelect', options: ['Tag A'] },
      ],
      views: [{ type: 'grid' }],
    });

    const tableIdParam = table.id;
    const viewIdParam = table.views[0].id;
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';
    const tagsFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';

    const result = await ctx.paste({
      tableId: tableIdParam,
      viewId: viewIdParam,
      ranges: [
        [0, 0],
        [2, 0],
      ],
      content: [['Row 1', 'In Progress', 'Tag A, Tag Z']],
      typecast: true,
    });

    expect(result.createdCount).toBe(1);

    const records = await ctx.listRecords(tableIdParam);
    const created = records.find((record) => record.fields[titleFieldId] === 'Row 1');
    expect(created).toBeDefined();
    if (!created) return;

    expect(created.fields[statusFieldId]).toBe('In Progress');
    const tagsValue = created.fields[tagsFieldId];
    const normalizedTags = Array.isArray(tagsValue)
      ? tagsValue
      : typeof tagsValue === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(tagsValue) as unknown;
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })()
        : [];
    expect(normalizedTags).toContain('Tag Z');

    const updatedTable = await ctx.getTableById(tableIdParam);
    const statusField = updatedTable.fields.find((field) => field.id === statusFieldId);
    const statusChoices =
      (statusField?.options as { choices?: Array<{ name: string }> })?.choices ?? [];
    expect(statusChoices.some((choice) => choice.name === 'In Progress')).toBe(true);

    const tagsField = updatedTable.fields.find((field) => field.id === tagsFieldId);
    const tagsChoices =
      (tagsField?.options as { choices?: Array<{ name: string }> })?.choices ?? [];
    expect(tagsChoices.some((choice) => choice.name === 'Tag Z')).toBe(true);
  });

  it('should handle paste with null values in typed columns (regression test)', async () => {
    /**
     * Regression test for bug:
     * When pasting content with null values in number columns, the batch update
     * SQL was generating incorrect type for NULL values, causing PostgreSQL error:
     * "column X is of type double precision but expression is of type text"
     *
     * The fix ensures NULL values include explicit type casts in VALUES clause.
     */

    // First, set some values to ensure we can clear them
    await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [1, 2],
      ],
      content: [
        ['Row1', 100],
        ['Row2', 200],
        ['Row3', 300],
      ],
    });

    // Now paste with null values in the number column (column 1)
    // This simulates the user scenario: copying rows from one location
    // and pasting to another, where some columns have null values
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [1, 2],
      ],
      content: [
        ['Updated1', null],
        ['Updated2', null],
        ['Updated3', null],
      ],
      typecast: true,
    });

    expect(result.updatedCount).toBe(3);

    // Verify values are correctly set: text column updated, number column is null
    const records = await ctx.listRecords(tableId);
    expect(records[0].fields[textFieldId]).toBe('Updated1');
    expect(records[0].fields[numberFieldId]).toBeNull();
    expect(records[1].fields[textFieldId]).toBe('Updated2');
    expect(records[1].fields[numberFieldId]).toBeNull();
    expect(records[2].fields[textFieldId]).toBe('Updated3');
    expect(records[2].fields[numberFieldId]).toBeNull();
  });

  it('should handle paste with mixed null and non-null values in typed columns', async () => {
    // Paste with mix of null and non-null values in number column
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [1, 3],
      ],
      content: [
        ['TextA', null],
        ['TextB', 500],
        ['TextC', null],
        ['TextD', 600],
      ],
      typecast: true,
    });

    expect(result.updatedCount).toBe(4);

    // Verify mixed values are correctly set
    const records = await ctx.listRecords(tableId);
    expect(records[0].fields[textFieldId]).toBe('TextA');
    expect(records[0].fields[numberFieldId]).toBeNull();
    expect(records[1].fields[textFieldId]).toBe('TextB');
    expect(records[1].fields[numberFieldId]).toBe(500);
    expect(records[2].fields[textFieldId]).toBe('TextC');
    expect(records[2].fields[numberFieldId]).toBeNull();
    expect(records[3].fields[textFieldId]).toBe('TextD');
    expect(records[3].fields[numberFieldId]).toBe(600);
  });

  it('should expand single value to fill entire column selection', async () => {
    // Get current record count
    const { pagination } = await ctx.listRecordsWithPagination(tableId);
    const total = pagination.total;

    // Paste single value with selection spanning all rows (column header selection)
    // Range: column 0, rows 0 to (total-1) -- this is total rows
    // Content: single value [['Filled Value']]
    // Since total % 1 === 0 and 1 % 1 === 0, content should be expanded
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, total - 1],
      ],
      content: [['Filled Value']],
    });

    expect(result.updatedCount).toBe(total);

    // Verify all records have the same value
    const records = await ctx.listRecords(tableId);
    for (const record of records) {
      expect(record.fields[textFieldId]).toBe('Filled Value');
    }
  });

  it('should expand small pattern to fill larger range', async () => {
    // Paste 2x2 content to 4x2 range (4 rows, 2 columns)
    // Content: [['Pattern1', 100], ['Pattern2', 200]]
    // Since 4 % 2 === 0 and 2 % 2 === 0, content should tile to fill
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [1, 3],
      ],
      content: [
        ['Pattern1', 100],
        ['Pattern2', 200],
      ],
    });

    expect(result.updatedCount).toBe(4);

    // Verify the pattern was tiled
    const records = await ctx.listRecords(tableId);
    expect(records[0].fields[textFieldId]).toBe('Pattern1');
    expect(records[0].fields[numberFieldId]).toBe(100);
    expect(records[1].fields[textFieldId]).toBe('Pattern2');
    expect(records[1].fields[numberFieldId]).toBe(200);
    expect(records[2].fields[textFieldId]).toBe('Pattern1'); // Tiled
    expect(records[2].fields[numberFieldId]).toBe(100);
    expect(records[3].fields[textFieldId]).toBe('Pattern2'); // Tiled
    expect(records[3].fields[numberFieldId]).toBe(200);
  });

  it('should NOT expand when range is not exact multiple of content', async () => {
    // First set known values
    await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 2],
      ],
      content: [['Before1'], ['Before2'], ['Before3']],
    });

    // Paste 2 rows to 3-row range (3 % 2 !== 0, should NOT expand)
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 2],
      ],
      content: [['NoExpand1'], ['NoExpand2']],
    });

    // Only 2 records updated (content size), not 3 (range size)
    expect(result.updatedCount).toBe(2);

    // Verify only first 2 records changed
    const records = await ctx.listRecords(tableId);
    expect(records[0].fields[textFieldId]).toBe('NoExpand1');
    expect(records[1].fields[textFieldId]).toBe('NoExpand2');
    expect(records[2].fields[textFieldId]).toBe('Before3'); // Unchanged
  });

  it('should handle large content in small range (use content size)', async () => {
    // Paste 5 rows but range only covers 2 rows
    // Content size determines how many rows are processed (no expansion happens)
    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 1],
      ],
      content: [['LargeRow1'], ['LargeRow2'], ['LargeRow3'], ['LargeRow4'], ['LargeRow5']],
    });

    // All 5 rows processed - when range is smaller than content, use content size
    // (This is the behavior: range is for expansion, not truncation)
    expect(result.updatedCount).toBe(5);

    // Verify all 5 rows were actually updated
    const records = await ctx.listRecords(tableId);
    expect(records[0].fields[textFieldId]).toBe('LargeRow1');
    expect(records[1].fields[textFieldId]).toBe('LargeRow2');
    expect(records[2].fields[textFieldId]).toBe('LargeRow3');
    expect(records[3].fields[textFieldId]).toBe('LargeRow4');
    expect(records[4].fields[textFieldId]).toBe('LargeRow5');
  });

  describe('paste link fields (v1 parity)', () => {
    let linkTableId: string;
    let linkPrimaryFieldId: string;
    let linkRecords: Array<{ id: string; fields: Record<string, unknown> }>;
    let duplicateTableId: string;
    let duplicatePrimaryFieldId: string;
    let duplicateRecords: Array<{ id: string; fields: Record<string, unknown> }>;

    beforeAll(async () => {
      const linkTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste Link Source',
        fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      linkTableId = linkTable.id;
      linkPrimaryFieldId = linkTable.fields.find((field) => field.isPrimary)?.id ?? '';
      linkRecords = [];
      for (const name of ['table2_1', 'table2_2', 'table2_3']) {
        linkRecords.push(
          await ctx.createRecord(linkTableId, {
            [linkPrimaryFieldId]: name,
          })
        );
      }

      const duplicateTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste Link Duplicate',
        fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      duplicateTableId = duplicateTable.id;
      duplicatePrimaryFieldId = duplicateTable.fields.find((field) => field.isPrimary)?.id ?? '';
      duplicateRecords = [];
      for (let i = 0; i < 3; i++) {
        duplicateRecords.push(
          await ctx.createRecord(duplicateTableId, {
            [duplicatePrimaryFieldId]: 'table3',
          })
        );
      }
    }, 30000);

    it('pastes two manyOne link fields in the same row', async () => {
      const linkFieldId1 = createFieldId();
      const linkFieldId2 = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Paste Link ManyOne ${linkFieldId1}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: `Link A ${linkFieldId1}`,
            type: 'link',
            id: linkFieldId1,
            options: {
              relationship: 'manyOne',
              foreignTableId: linkTableId,
              lookupFieldId: linkPrimaryFieldId,
              isOneWay: true,
            },
          },
          {
            name: `Link B ${linkFieldId2}`,
            type: 'link',
            id: linkFieldId2,
            options: {
              relationship: 'manyOne',
              foreignTableId: linkTableId,
              lookupFieldId: linkPrimaryFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id ?? '';
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Row 1',
      });

      await ctx.paste({
        tableId: hostTable.id,
        viewId: hostTable.views[0].id,
        ranges: [
          [1, 0],
          [2, 0],
        ],
        content: [['table2_1', 'table2_2']],
        typecast: true,
      });

      const records = await ctx.listRecords(hostTable.id);
      const row = records.find((record) => record.id === hostRecord.id) ?? records[0];

      expect(row.fields[linkFieldId1]).toEqual({
        id: linkRecords[0].id,
        title: 'table2_1',
      });
      expect(row.fields[linkFieldId2]).toEqual({
        id: linkRecords[1].id,
        title: 'table2_2',
      });
    });

    it('pastes two oneMany link fields in the same row', async () => {
      const linkFieldId1 = createFieldId();
      const linkFieldId2 = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Paste Link OneMany ${linkFieldId1}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: `Link A ${linkFieldId1}`,
            type: 'link',
            id: linkFieldId1,
            options: {
              relationship: 'oneMany',
              foreignTableId: linkTableId,
              lookupFieldId: linkPrimaryFieldId,
              isOneWay: true,
            },
          },
          {
            name: `Link B ${linkFieldId2}`,
            type: 'link',
            id: linkFieldId2,
            options: {
              relationship: 'oneMany',
              foreignTableId: linkTableId,
              lookupFieldId: linkPrimaryFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id ?? '';
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Row 1',
      });

      await ctx.paste({
        tableId: hostTable.id,
        viewId: hostTable.views[0].id,
        ranges: [
          [1, 0],
          [2, 0],
        ],
        content: [['table2_1', 'table2_2']],
        typecast: true,
      });

      const records = await ctx.listRecords(hostTable.id);
      const row = records.find((record) => record.id === hostRecord.id) ?? records[0];

      expect(row.fields[linkFieldId1]).toEqual([
        {
          id: linkRecords[0].id,
          title: 'table2_1',
        },
      ]);
      expect(row.fields[linkFieldId2]).toEqual([
        {
          id: linkRecords[1].id,
          title: 'table2_2',
        },
      ]);
    });

    it('pastes oneMany link fields when titles are duplicated', async () => {
      const linkFieldId1 = createFieldId();
      const linkFieldId2 = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Paste Link Duplicate ${linkFieldId1}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: `Link A ${linkFieldId1}`,
            type: 'link',
            id: linkFieldId1,
            options: {
              relationship: 'oneMany',
              foreignTableId: duplicateTableId,
              lookupFieldId: duplicatePrimaryFieldId,
              isOneWay: true,
            },
          },
          {
            name: `Link B ${linkFieldId2}`,
            type: 'link',
            id: linkFieldId2,
            options: {
              relationship: 'oneMany',
              foreignTableId: duplicateTableId,
              lookupFieldId: duplicatePrimaryFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id ?? '';
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Row 1',
      });

      await ctx.paste({
        tableId: hostTable.id,
        viewId: hostTable.views[0].id,
        ranges: [
          [1, 0],
          [2, 0],
        ],
        content: [[{ id: duplicateRecords[0].id }, { id: duplicateRecords[1].id }]],
        typecast: true,
      });

      const records = await ctx.listRecords(hostTable.id);
      const row = records.find((record) => record.id === hostRecord.id) ?? records[0];

      expect(row.fields[linkFieldId1]).toEqual([
        {
          id: duplicateRecords[0].id,
          title: 'table3',
        },
      ]);
      expect(row.fields[linkFieldId2]).toEqual([
        {
          id: duplicateRecords[1].id,
          title: 'table3',
        },
      ]);
    });

    it('pastes a single link value by title', async () => {
      const linkFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Paste Link Single ${linkFieldId}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: `Link ${linkFieldId}`,
            type: 'link',
            id: linkFieldId,
            options: {
              relationship: 'oneMany',
              foreignTableId: linkTableId,
              lookupFieldId: linkPrimaryFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id ?? '';
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Row 1',
      });

      await ctx.paste({
        tableId: hostTable.id,
        viewId: hostTable.views[0].id,
        ranges: [
          [1, 0],
          [1, 0],
        ],
        content: [['table2_1']],
        typecast: true,
      });

      const records = await ctx.listRecords(hostTable.id);
      const row = records.find((record) => record.id === hostRecord.id) ?? records[0];

      expect(row.fields[linkFieldId]).toEqual([
        {
          id: linkRecords[0].id,
          title: 'table2_1',
        },
      ]);
    });

    it('filters link title lookup by record ids', async () => {
      const linkFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Paste Link Filter ${linkFieldId}`,
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: `Link ${linkFieldId}`,
            type: 'link',
            id: linkFieldId,
            options: {
              relationship: 'manyOne',
              foreignTableId: linkTableId,
              lookupFieldId: linkPrimaryFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id ?? '';
      await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Row 1',
      });

      ctx.testContainer.clearLogs();

      await ctx.paste({
        tableId: hostTable.id,
        viewId: hostTable.views[0].id,
        ranges: [
          [1, 0],
          [1, 0],
        ],
        content: [[linkRecords[0].id]],
        typecast: true,
      });

      const entries = ctx.testContainer.spyLogger.getEntriesByMessage('find:mode:stored:sql');
      const linkQuery = entries.find((entry) =>
        entry.message.includes(`"${ctx.baseId}"."${linkTableId}"`)
      );

      expect(linkQuery).toBeTruthy();
      expect(linkQuery?.context?.parameters).toEqual(expect.arrayContaining([linkRecords[0].id]));
      const normalizedSql = linkQuery!.message.toLowerCase();
      expect(normalizedSql).toContain('where');
      expect(normalizedSql).toContain('__id');
      expect(normalizedSql).toContain(' in ');
    });
  });

  describe('paste with sourceFields (v1 header parity)', () => {
    it('should paste column selection with sourceFields metadata', async () => {
      /**
       * This test covers the v1 API use case where paste is called with:
       * - type: 'columns' (column header selection)
       * - header/sourceFields: field metadata from the source (for typecast)
       *
       * This was previously blocked by !pasteRo.header?.length condition in
       * the selection controller. After removing that condition, header
       * is converted to sourceFields and passed to v2 core.
       */
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste Column With Header',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Count',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const textFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const numberFieldId = table.fields.find((f) => f.name === 'Count')?.id ?? '';

      // Create initial records
      for (let i = 0; i < 3; i++) {
        await ctx.createRecord(table.id, {
          [textFieldId]: `Row ${i + 1}`,
          [numberFieldId]: (i + 1) * 10,
        });
      }

      // Paste to column 1 (Count) with type='columns' and sourceFields
      // This simulates the v1 API behavior where header is converted to sourceFields
      const result = await ctx.paste({
        tableId: table.id,
        viewId: table.views[0].id,
        ranges: [[1, 1]], // Column selection: column 1 only
        content: [[11]], // Single value to fill column
        type: 'columns',
        sourceFields: [
          {
            name: 'Count',
            type: 'number',
            cellValueType: 'number',
            isComputed: false,
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
        ],
      });

      // All rows should be updated
      expect(result.updatedCount).toBe(3);
      expect(result.createdCount).toBe(0);

      // Verify all records have the new value
      const records = await ctx.listRecords(table.id);
      for (const record of records) {
        expect(record.fields[numberFieldId]).toBe(11);
      }
    });

    it('should paste with sourceFields for type conversion', async () => {
      /**
       * Tests that sourceFields metadata is used for proper type conversion
       * when pasting string values to number fields.
       */
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste Type Conversion',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Amount', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      const textFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const numberFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';

      // Create initial record
      await ctx.createRecord(table.id, {
        [textFieldId]: 'Row 1',
        [numberFieldId]: 100,
      });

      // Paste string value with sourceFields indicating it's a number
      const result = await ctx.paste({
        tableId: table.id,
        viewId: table.views[0].id,
        ranges: [
          [1, 0],
          [1, 0],
        ],
        content: [['999']], // String value
        typecast: true,
        sourceFields: [
          {
            name: 'Amount',
            type: 'number',
            cellValueType: 'number',
            isComputed: false,
          },
        ],
      });

      expect(result.updatedCount).toBe(1);

      // Verify the value was converted to number
      const records = await ctx.listRecords(table.id);
      expect(records[0].fields[numberFieldId]).toBe(999);
    });
  });

  describe('paste expand columns (v1 parity)', () => {
    it('expands columns using computed header metadata', async () => {
      const numberFieldIdLocal = createFieldId();
      const formulaFieldId = createFieldId();
      const extraFieldId = createFieldId();
      const numberOptions = {
        formatting: { type: 'decimal', precision: 0 },
        showAs: { type: 'bar', color: 'blue', showValue: true, maxValue: 100 },
      } as const;
      const formulaOptions = {
        expression: `{${numberFieldIdLocal}}`,
        formatting: numberOptions.formatting,
        showAs: numberOptions.showAs,
      } as const;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste Expand Formula',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'count', type: 'number', id: numberFieldIdLocal, options: numberOptions },
          { name: 'formula', type: 'formula', id: formulaFieldId, options: formulaOptions },
          { name: 'Notes', type: 'singleLineText', id: extraFieldId },
        ],
        views: [{ type: 'grid' }],
      });

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id ?? '';
      await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Row 1',
        [numberFieldIdLocal]: 1,
      });

      await ctx.paste({
        tableId: hostTable.id,
        viewId: hostTable.views[0].id,
        ranges: [
          [3, 0],
          [3, 0],
        ],
        content: [[1, 2]],
        sourceFields: [
          {
            name: 'count',
            type: 'number',
            cellValueType: 'number',
            isComputed: false,
            options: numberOptions,
          },
          {
            name: 'formula',
            type: 'formula',
            cellValueType: 'number',
            isComputed: true,
            options: formulaOptions,
          },
        ],
      });

      const updatedTable = await ctx.getTableById(hostTable.id);
      const existingFieldIds = new Set(hostTable.fields.map((field) => field.id));
      const newFields = updatedTable.fields.filter((field) => !existingFieldIds.has(field.id));

      expect(newFields).toHaveLength(1);
      expect(newFields[0]?.type).toBe('number');
      expect(newFields[0]?.options).toEqual(numberOptions);
    });
  });

  describe('paste with filter', () => {
    let filterTableId: string;
    let filterViewId: string;
    let filterTextFieldId: string;
    let filterNumberFieldId: string;

    beforeAll(async () => {
      // Create a separate table for filter tests
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Paste Test Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Count', type: 'number' },
          { name: 'Category', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });

      filterTableId = table.id;
      filterViewId = table.views[0].id;
      filterTextFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      filterNumberFieldId = table.fields.find((f) => f.name === 'Count')?.id ?? '';
      const categoryFieldId = table.fields.find((f) => f.name === 'Category')?.id ?? '';

      // Create records with different categories
      // This creates a mix of 'A' and 'B' category records
      const records = [
        { name: 'ItemA1', count: 10, category: 'A' },
        { name: 'ItemB1', count: 20, category: 'B' },
        { name: 'ItemA2', count: 30, category: 'A' },
        { name: 'ItemB2', count: 40, category: 'B' },
        { name: 'ItemA3', count: 50, category: 'A' },
      ];

      for (const rec of records) {
        await ctx.createRecord(filterTableId, {
          [filterTextFieldId]: rec.name,
          [filterNumberFieldId]: rec.count,
          [categoryFieldId]: rec.category,
        });
      }
    }, 30000);

    it('should paste only to filtered records', async () => {
      const categoryFieldId =
        (await ctx.listRecords(filterTableId))[0]?.fields &&
        Object.keys((await ctx.listRecords(filterTableId))[0]?.fields || {}).find(
          (key) => key !== filterTextFieldId && key !== filterNumberFieldId
        );

      // Filter to only Category = 'A' records
      const filter: RecordFilter = {
        fieldId: categoryFieldId!,
        operator: 'is',
        value: 'A',
      };

      // Paste to first 3 rows (but with filter, should only affect 'A' records)
      const result = await ctx.paste({
        tableId: filterTableId,
        viewId: filterViewId,
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['FilteredUpdate1'], ['FilteredUpdate2'], ['FilteredUpdate3']],
        filter,
      });

      // Should update 3 records (all Category A records)
      expect(result.updatedCount).toBe(3);
      expect(result.createdCount).toBe(0);

      // Verify only Category A records were updated
      const records = await ctx.listRecords(filterTableId);
      const categoryARecords = records.filter((r) => r.fields[categoryFieldId!] === 'A');
      const categoryBRecords = records.filter((r) => r.fields[categoryFieldId!] === 'B');

      // Category A records should have new values
      expect(categoryARecords[0].fields[filterTextFieldId]).toBe('FilteredUpdate1');
      expect(categoryARecords[1].fields[filterTextFieldId]).toBe('FilteredUpdate2');
      expect(categoryARecords[2].fields[filterTextFieldId]).toBe('FilteredUpdate3');

      // Category B records should be unchanged (still original values)
      expect(categoryBRecords[0].fields[filterTextFieldId]).toBe('ItemB1');
      expect(categoryBRecords[1].fields[filterTextFieldId]).toBe('ItemB2');
    });

    it('should paste with number filter (isGreater)', async () => {
      // Filter to records where Count > 25
      const filter: RecordFilter = {
        fieldId: filterNumberFieldId,
        operator: 'isGreater',
        value: 25,
      };

      // Paste to first 2 rows of filtered result
      const result = await ctx.paste({
        tableId: filterTableId,
        viewId: filterViewId,
        ranges: [
          [1, 0],
          [1, 1],
        ],
        content: [[999], [888]],
        filter,
      });

      // Should update 2 records (Count > 25: 30, 40, 50 - first two)
      expect(result.updatedCount).toBe(2);

      // Verify the updates
      const records = await ctx.listRecords(filterTableId);
      // Find records that originally had Count > 25 and were updated
      const highCountRecords = records.filter(
        (r) => (r.fields[filterNumberFieldId] as number) >= 25
      );

      // First two of filtered result should be updated
      expect(highCountRecords.some((r) => r.fields[filterNumberFieldId] === 999)).toBe(true);
      expect(highCountRecords.some((r) => r.fields[filterNumberFieldId] === 888)).toBe(true);
    });

    it('should create records when paste exceeds filtered record count', async () => {
      const categoryFieldId =
        (await ctx.listRecords(filterTableId))[0]?.fields &&
        Object.keys((await ctx.listRecords(filterTableId))[0]?.fields || {}).find(
          (key) => key !== filterTextFieldId && key !== filterNumberFieldId
        );

      // Filter to Category = 'B' (only 2 records)
      const filter: RecordFilter = {
        fieldId: categoryFieldId!,
        operator: 'is',
        value: 'B',
      };

      // Paste 4 rows to table filtered to 2 records - should update 2, create 2
      const result = await ctx.paste({
        tableId: filterTableId,
        viewId: filterViewId,
        ranges: [
          [0, 0],
          [0, 3],
        ],
        content: [['NewB1'], ['NewB2'], ['NewB3'], ['NewB4']],
        filter,
      });

      // 2 updates (existing B records) + 2 creates
      expect(result.updatedCount).toBe(2);
      expect(result.createdCount).toBe(2);
    });

    it('should handle empty filter result gracefully', async () => {
      // Filter that matches no records
      const filter: RecordFilter = {
        fieldId: filterNumberFieldId,
        operator: 'isGreater',
        value: 99999, // No record has count this high
      };

      // Paste content
      const result = await ctx.paste({
        tableId: filterTableId,
        viewId: filterViewId,
        ranges: [
          [0, 0],
          [0, 1],
        ],
        content: [['NoMatch1'], ['NoMatch2']],
        filter,
      });

      // No matching records to update, but should create 2
      expect(result.updatedCount).toBe(0);
      expect(result.createdCount).toBe(2);
    });

    it('should paste with singleSelect hasAnyOf filter (v1 compatibility)', async () => {
      /**
       * Regression test for v1/v2 compatibility:
       * In v1, singleSelect fields with isMultipleCellValue allow operators like
       * hasAnyOf, hasAllOf, isExactly, isNotExactly, hasNoneOf.
       *
       * This test ensures v2 correctly handles these operators when the field
       * is singleSelect but the filter uses hasAnyOf (valid for multiple cell values).
       */
      const selectTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SingleSelect HasAnyOf Test',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Status', type: 'singleSelect', options: ['Open', 'Closed', 'Pending'] },
        ],
        views: [{ type: 'grid' }],
      });

      const selectTextFieldId = selectTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const selectStatusFieldId = selectTable.fields.find((f) => f.name === 'Status')?.id ?? '';

      // Create records with different statuses
      for (const [name, status] of [
        ['Rec1', 'Open'],
        ['Rec2', 'Closed'],
        ['Rec3', 'Pending'],
        ['Rec4', 'Open'],
        ['Rec5', 'Closed'],
      ] as const) {
        await ctx.createRecord(selectTable.id, {
          [selectTextFieldId]: name,
          [selectStatusFieldId]: status,
        });
      }

      // Filter using hasAnyOf operator on singleSelect field
      // This is valid in v1 when the field has isMultipleCellValue
      const filter: RecordFilter = {
        fieldId: selectStatusFieldId,
        operator: 'isAnyOf',
        value: ['Open', 'Pending'],
      };

      // Paste to first 3 rows of filtered result
      const result = await ctx.paste({
        tableId: selectTable.id,
        viewId: selectTable.views[0].id,
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['FilteredBySelect1'], ['FilteredBySelect2'], ['FilteredBySelect3']],
        filter,
      });

      // Should update 3 records (Open: 2, Pending: 1)
      expect(result.updatedCount).toBe(3);

      // Verify the correct records were updated
      const records = await ctx.listRecords(selectTable.id);
      const openOrPendingRecords = records.filter((r) =>
        ['Open', 'Pending'].includes(r.fields[selectStatusFieldId] as string)
      );

      expect(openOrPendingRecords[0].fields[selectTextFieldId]).toBe('FilteredBySelect1');
      expect(openOrPendingRecords[1].fields[selectTextFieldId]).toBe('FilteredBySelect2');
      expect(openOrPendingRecords[2].fields[selectTextFieldId]).toBe('FilteredBySelect3');
    });
  });

  describe('paste with type (columns/rows selection)', () => {
    let typeTableId: string;
    let typeViewId: string;
    let typeTextFieldId: string;
    let typeNumberFieldId: string;

    beforeAll(async () => {
      // Create a separate table for type tests
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Type Paste Test Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Value', type: 'number' },
          { name: 'Status', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });

      typeTableId = table.id;
      typeViewId = table.views[0].id;
      typeTextFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      typeNumberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      // Create initial records
      for (let i = 0; i < 5; i++) {
        await ctx.createRecord(typeTableId, {
          [typeTextFieldId]: `Item ${i + 1}`,
          [typeNumberFieldId]: (i + 1) * 100,
        });
      }
    }, 30000);

    it('should paste to entire column with type=columns', async () => {
      // Get current record count
      const { pagination } = await ctx.listRecordsWithPagination(typeTableId);
      const total = pagination.total;

      // Select column 0 (Name column) - ranges is [[startCol, endCol]]
      // This should paste "ColumnValue" to all rows in column 0
      const result = await ctx.paste({
        tableId: typeTableId,
        viewId: typeViewId,
        ranges: [[0, 0]], // Column 0 only
        content: [['ColumnValue']],
        type: 'columns',
      });

      // All rows should be updated
      expect(result.updatedCount).toBe(total);
      expect(result.createdCount).toBe(0);

      // Verify all records in column 0 have the new value
      const records = await ctx.listRecords(typeTableId);
      for (const record of records) {
        expect(record.fields[typeTextFieldId]).toBe('ColumnValue');
      }
    });

    it('should paste to multiple columns with type=columns', async () => {
      // Select columns 0-1 (Name and Value) - ranges is [[startCol, endCol]]
      const { pagination } = await ctx.listRecordsWithPagination(typeTableId);
      const total = pagination.total;

      const result = await ctx.paste({
        tableId: typeTableId,
        viewId: typeViewId,
        ranges: [[0, 1]], // Columns 0 and 1
        content: [['MultiColName', 999]],
        type: 'columns',
      });

      // All rows should be updated
      expect(result.updatedCount).toBe(total);

      // Verify all records have the new values
      const records = await ctx.listRecords(typeTableId);
      for (const record of records) {
        expect(record.fields[typeTextFieldId]).toBe('MultiColName');
        expect(record.fields[typeNumberFieldId]).toBe(999);
      }
    });

    it('should paste to entire row with type=rows', async () => {
      // First, reset the table values
      await ctx.paste({
        tableId: typeTableId,
        viewId: typeViewId,
        ranges: [
          [0, 0],
          [2, 4],
        ],
        content: [
          ['Row1', 100, 'Active'],
          ['Row2', 200, 'Active'],
          ['Row3', 300, 'Active'],
          ['Row4', 400, 'Active'],
          ['Row5', 500, 'Active'],
        ],
      });

      // Select row 0 - ranges is [[startRow, endRow]]
      // This should paste to all columns in row 0
      const result = await ctx.paste({
        tableId: typeTableId,
        viewId: typeViewId,
        ranges: [[0, 0]], // Row 0 only
        content: [['RowPasteTest', 1111, 'RowStatus']],
        type: 'rows',
      });

      expect(result.updatedCount).toBe(1);
      expect(result.createdCount).toBe(0);

      // Verify row 0 has the new values
      const records = await ctx.listRecords(typeTableId);
      expect(records[0].fields[typeTextFieldId]).toBe('RowPasteTest');
      expect(records[0].fields[typeNumberFieldId]).toBe(1111);
      // Other rows should be unchanged
      expect(records[1].fields[typeTextFieldId]).toBe('Row2');
    });

    it('should paste to multiple rows with type=rows', async () => {
      // Select rows 1-2 - ranges is [[startRow, endRow]]
      const result = await ctx.paste({
        tableId: typeTableId,
        viewId: typeViewId,
        ranges: [[1, 2]], // Rows 1 and 2
        content: [
          ['MultiRow1', 2222, 'Status1'],
          ['MultiRow2', 3333, 'Status2'],
        ],
        type: 'rows',
      });

      expect(result.updatedCount).toBe(2);

      // Verify rows 1-2 have the new values
      const records = await ctx.listRecords(typeTableId);
      expect(records[1].fields[typeTextFieldId]).toBe('MultiRow1');
      expect(records[1].fields[typeNumberFieldId]).toBe(2222);
      expect(records[2].fields[typeTextFieldId]).toBe('MultiRow2');
      expect(records[2].fields[typeNumberFieldId]).toBe(3333);
    });

    it('should expand single value to fill column selection', async () => {
      const { pagination } = await ctx.listRecordsWithPagination(typeTableId);
      const total = pagination.total;

      // Paste single value to entire column - should expand to all rows
      const result = await ctx.paste({
        tableId: typeTableId,
        viewId: typeViewId,
        ranges: [[1, 1]], // Column 1 (Value)
        content: [[7777]],
        type: 'columns',
      });

      expect(result.updatedCount).toBe(total);

      // Verify all records have the expanded value
      const records = await ctx.listRecords(typeTableId);
      for (const record of records) {
        expect(record.fields[typeNumberFieldId]).toBe(7777);
      }
    });
  });

  describe('paste with projection', () => {
    let projTableId: string;
    let projViewId: string;
    let projField1Id: string; // singleLineText (primary)
    let projField2Id: string; // number
    let projField3Id: string; // singleLineText

    beforeAll(async () => {
      // Create a table for projection tests
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Projection Paste Test Table',
        fields: [
          { name: 'Field1', type: 'singleLineText', isPrimary: true },
          { name: 'Field2', type: 'number' },
          { name: 'Field3', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });

      projTableId = table.id;
      projViewId = table.views[0].id;
      projField1Id = table.fields.find((f) => f.name === 'Field1')?.id ?? '';
      projField2Id = table.fields.find((f) => f.name === 'Field2')?.id ?? '';
      projField3Id = table.fields.find((f) => f.name === 'Field3')?.id ?? '';

      // Create initial records
      for (let i = 0; i < 3; i++) {
        await ctx.createRecord(projTableId, {
          [projField1Id]: `Row${i + 1}`,
          [projField2Id]: (i + 1) * 10,
          [projField3Id]: `Notes${i + 1}`,
        });
      }
    }, 30000);

    it('should paste correctly when projection order is shuffled', async () => {
      // Projection: [Field3, Field1, Field2] - different from view order [Field1, Field2, Field3]
      // Content columns should map to projection order:
      //   content[0] -> Field3
      //   content[1] -> Field1
      //   content[2] -> Field2
      const result = await ctx.paste({
        tableId: projTableId,
        viewId: projViewId,
        ranges: [
          [0, 0],
          [2, 0],
        ],
        content: [['ShuffledNotes', 'ShuffledName', 999]],
        projection: [projField3Id, projField1Id, projField2Id],
      });

      expect(result.updatedCount).toBe(1);

      // Verify the values are in correct fields
      const records = await ctx.listRecords(projTableId);
      expect(records[0].fields[projField1Id]).toBe('ShuffledName');
      expect(records[0].fields[projField2Id]).toBe(999);
      expect(records[0].fields[projField3Id]).toBe('ShuffledNotes');
    });

    it('should paste correctly when projection order is reversed', async () => {
      // Projection: [Field3, Field2, Field1] - reversed from view order
      // Content columns should map:
      //   content[0] -> Field3
      //   content[1] -> Field2
      //   content[2] -> Field1
      const result = await ctx.paste({
        tableId: projTableId,
        viewId: projViewId,
        ranges: [
          [0, 1],
          [2, 1],
        ],
        content: [['ReversedNotes', 888, 'ReversedName']],
        projection: [projField3Id, projField2Id, projField1Id],
      });

      expect(result.updatedCount).toBe(1);

      // Verify the values are in correct fields
      const records = await ctx.listRecords(projTableId);
      expect(records[1].fields[projField1Id]).toBe('ReversedName');
      expect(records[1].fields[projField2Id]).toBe(888);
      expect(records[1].fields[projField3Id]).toBe('ReversedNotes');
    });

    it('should paste to correct field when using shuffled projection with column offset', async () => {
      // Projection starts at column offset 1 (startCol=1)
      // Projection: [Field2, Field3] (2 fields starting from column 1)
      // Content columns should map:
      //   content[0] -> Field2
      //   content[1] -> Field3
      const result = await ctx.paste({
        tableId: projTableId,
        viewId: projViewId,
        ranges: [
          [0, 2],
          [1, 2],
        ],
        content: [[777, 'OffsetNotes']],
        projection: [projField2Id, projField3Id],
      });

      expect(result.updatedCount).toBe(1);

      // Verify the values are in correct fields
      const records = await ctx.listRecords(projTableId);
      // Field1 should remain unchanged
      expect(records[2].fields[projField1Id]).toBe('Row3');
      // Field2 and Field3 should be updated via projection
      expect(records[2].fields[projField2Id]).toBe(777);
      expect(records[2].fields[projField3Id]).toBe('OffsetNotes');
    });

    it('should handle paste content ending with newline (empty last row)', async () => {
      // When content ends with newline, the last row is empty []
      // This simulates pasting "A\nB\n" which produces [['A'], ['B'], []]
      const result = await ctx.paste({
        tableId: projTableId,
        viewId: projViewId,
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['NewlineRow1'], ['NewlineRow2'], []], // Empty last row from trailing newline
      });

      // Should handle the empty row gracefully
      expect(result.updatedCount).toBe(3);

      const records = await ctx.listRecords(projTableId);
      expect(records[0].fields[projField1Id]).toBe('NewlineRow1');
      expect(records[1].fields[projField1Id]).toBe('NewlineRow2');
      // Third row gets empty value (null or undefined converted from empty array)
    });
  });

  describe('paste with sort (view row order)', () => {
    /**
     * Critical test for ensuring paste operations target the correct rows
     * when a view has custom sort order.
     *
     * Without the sort parameter, paste would use the default __auto_number order,
     * causing updates to go to the wrong records.
     */
    let sortTableId: string;
    let sortViewId: string;
    let sortNameFieldId: string;
    let sortValueFieldId: string;

    beforeAll(async () => {
      // Create a table for sort tests
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Paste Test Table',
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
    }, 30000);

    it('should paste to correct rows when sort is specified (descending)', async () => {
      /**
       * Test scenario:
       * - Records in creation order: A(100), B(200), C(300), D(400), E(500)
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Paste "Updated" to row 0 with sort=[{fieldId: valueFieldId, order: 'desc'}]
       * - Should update E (first in DESC order), NOT A (first in creation order)
       */
      const result = await ctx.paste({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['SortTestUpdated']],
        sort: [{ fieldId: sortValueFieldId, order: 'desc' }],
      });

      expect(result.updatedCount).toBe(1);

      // Verify E was updated (not A)
      const records = await ctx.listRecords(sortTableId);
      const recordE = records.find((r) => r.fields[sortValueFieldId] === 500);
      const recordA = records.find((r) => r.fields[sortValueFieldId] === 100);

      expect(recordE?.fields[sortNameFieldId]).toBe('SortTestUpdated');
      expect(recordA?.fields[sortNameFieldId]).toBe('RecordA'); // Should remain unchanged
    });

    it('should paste multiple rows in correct sort order', async () => {
      /**
       * Test scenario:
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Paste to rows 1-3 with sort DESC
       * - Should update D, C, B (rows 1-3 in DESC order)
       */
      const result = await ctx.paste({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 1],
          [0, 3],
        ],
        content: [['SortRow1'], ['SortRow2'], ['SortRow3']],
        sort: [{ fieldId: sortValueFieldId, order: 'desc' }],
      });

      expect(result.updatedCount).toBe(3);

      // Verify D, C, B were updated in order
      const records = await ctx.listRecords(sortTableId);
      const recordD = records.find((r) => r.fields[sortValueFieldId] === 400);
      const recordC = records.find((r) => r.fields[sortValueFieldId] === 300);
      const recordB = records.find((r) => r.fields[sortValueFieldId] === 200);
      const recordA = records.find((r) => r.fields[sortValueFieldId] === 100);

      expect(recordD?.fields[sortNameFieldId]).toBe('SortRow1');
      expect(recordC?.fields[sortNameFieldId]).toBe('SortRow2');
      expect(recordB?.fields[sortNameFieldId]).toBe('SortRow3');
      expect(recordA?.fields[sortNameFieldId]).toBe('RecordA'); // Should remain unchanged
    });

    it('should paste to correct rows when sort is ascending (non-default)', async () => {
      /**
       * Test scenario:
       * - Reset values first
       * - View sorted by Value ASC: A(100), B(200), C(300), D(400), E(500)
       * - This matches creation order, but we're explicitly specifying it
       * - Paste to row 4 (last in ASC = E)
       */
      // Reset names first
      await ctx.paste({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 0],
          [0, 4],
        ],
        content: [['ResetA'], ['ResetB'], ['ResetC'], ['ResetD'], ['ResetE']],
        sort: [{ fieldId: sortValueFieldId, order: 'asc' }],
      });

      // Now paste to row 4 with ASC sort
      const result = await ctx.paste({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 4],
          [0, 4],
        ],
        content: [['AscLastRow']],
        sort: [{ fieldId: sortValueFieldId, order: 'asc' }],
      });

      expect(result.updatedCount).toBe(1);

      // Verify E (Value=500, last in ASC) was updated
      const records = await ctx.listRecords(sortTableId);
      const recordE = records.find((r) => r.fields[sortValueFieldId] === 500);
      expect(recordE?.fields[sortNameFieldId]).toBe('AscLastRow');
    });

    it('should use default order when sort is not specified', async () => {
      /**
       * Test scenario:
       * - No sort specified → uses default __auto_number ASC
       * - Paste to row 0 without sort
       * - Should update A (first in creation order)
       */
      // Reset E name first
      await ctx.paste({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['ResetE']],
        sort: [{ fieldId: sortValueFieldId, order: 'desc' }],
      });

      // Now paste without sort
      const result = await ctx.paste({
        tableId: sortTableId,
        viewId: sortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['DefaultOrder']],
        // No sort - should use default __auto_number ASC
      });

      expect(result.updatedCount).toBe(1);

      // Verify A (first in creation order) was updated
      const records = await ctx.listRecords(sortTableId);
      const recordA = records.find((r) => r.fields[sortValueFieldId] === 100);
      expect(recordA?.fields[sortNameFieldId]).toBe('DefaultOrder');
    });
  });

  describe('paste row mapping with user sort/filter/hidden columns', () => {
    let userSortTableId: string;
    let userSortViewId: string;
    let userSortNameFieldId: string;
    let userSortStatusFieldId: string;
    let userSortRankFieldId: string;
    let userSortAssigneeFieldId: string;
    let userSortDbTableName: string;
    let userSortAssigneeDbFieldName: string;
    let todoNullRecordId: string;
    let todoZoeRecordId: string;
    let todoAmyRecordId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste User Sort Mapping Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Status', type: 'singleSelect', options: ['Todo', 'Done'] },
          { name: 'Rank', type: 'number' },
          { name: 'Assignee', type: 'user', options: { isMultiple: false } },
        ],
        views: [{ type: 'grid' }],
      });

      userSortTableId = table.id;
      userSortViewId = table.views[0].id;
      userSortNameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      userSortStatusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';
      userSortRankFieldId = table.fields.find((f) => f.name === 'Rank')?.id ?? '';
      userSortAssigneeFieldId = table.fields.find((f) => f.name === 'Assignee')?.id ?? '';

      todoNullRecordId = (
        await ctx.createRecord(userSortTableId, {
          [userSortNameFieldId]: 'TodoNull',
          [userSortStatusFieldId]: 'Todo',
          [userSortRankFieldId]: 1,
        })
      ).id;

      todoZoeRecordId = (
        await ctx.createRecord(userSortTableId, {
          [userSortNameFieldId]: 'TodoZoe',
          [userSortStatusFieldId]: 'Todo',
          [userSortRankFieldId]: 1,
        })
      ).id;

      todoAmyRecordId = (
        await ctx.createRecord(userSortTableId, {
          [userSortNameFieldId]: 'TodoAmy',
          [userSortStatusFieldId]: 'Todo',
          [userSortRankFieldId]: 1,
        })
      ).id;

      await ctx.createRecord(userSortTableId, {
        [userSortNameFieldId]: 'DoneFiltered',
        [userSortStatusFieldId]: 'Done',
        [userSortRankFieldId]: 1,
      });

      const tableMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', userSortTableId)
        .executeTakeFirst();
      userSortDbTableName = tableMeta?.db_table_name ?? '';

      const assigneeFieldMeta = await ctx.testContainer.db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', userSortAssigneeFieldId)
        .executeTakeFirst();
      userSortAssigneeDbFieldName = assigneeFieldMeta?.db_field_name ?? '';

      await sql`
        UPDATE ${sql.table(userSortDbTableName)}
        SET ${sql.ref(userSortAssigneeDbFieldName)} = ${JSON.stringify({
          id: 'usr_zoe',
          title: 'Zoe',
        })}::jsonb
        WHERE "__id" = ${todoZoeRecordId}
      `.execute(ctx.testContainer.db);

      await sql`
        UPDATE ${sql.table(userSortDbTableName)}
        SET ${sql.ref(userSortAssigneeDbFieldName)} = ${JSON.stringify({
          id: 'usr_amy',
          title: 'Amy',
        })}::jsonb
        WHERE "__id" = ${todoAmyRecordId}
      `.execute(ctx.testContainer.db);

      const tableWithView = await ctx.getTableById(userSortTableId);
      const view = tableWithView.views.find((v) => v.id === userSortViewId);
      const columnMeta =
        (view?.columnMeta as Record<string, { order?: number; hidden?: boolean }>) ?? {};
      columnMeta[userSortStatusFieldId] = {
        ...(columnMeta[userSortStatusFieldId] ?? {}),
        hidden: true,
      };

      await ctx.testContainer.db
        .updateTable('view')
        .set({
          filter: JSON.stringify({
            conjunction: 'and',
            filterSet: [{ fieldId: userSortStatusFieldId, operator: 'is', value: 'Todo' }],
          }),
          sort: JSON.stringify({
            sortObjs: [
              { fieldId: userSortRankFieldId, order: 'desc' },
              { fieldId: userSortAssigneeFieldId, order: 'asc' },
            ],
            manualSort: false,
          }),
          column_meta: JSON.stringify(columnMeta),
        })
        .where('id', '=', userSortViewId)
        .execute();
    }, 30000);

    it('pastes to the correct visible row when sort includes user field', async () => {
      const result = await ctx.paste({
        tableId: userSortTableId,
        viewId: userSortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['PasteToVisibleRow0']],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(userSortTableId, { limit: 10 });
      const nullRecord = records.find((record) => record.id === todoNullRecordId);
      const zoeRecord = records.find((record) => record.id === todoZoeRecordId);
      const amyRecord = records.find((record) => record.id === todoAmyRecordId);

      // View order should be: null assignee first, then Amy, then Zoe.
      expect(nullRecord?.fields[userSortNameFieldId]).toBe('PasteToVisibleRow0');
      expect(amyRecord?.fields[userSortNameFieldId]).toBe('TodoAmy');
      expect(zoeRecord?.fields[userSortNameFieldId]).toBe('TodoZoe');
    });

    it('pastes user object to same user column even with legacy scalar values in sorted rows', async () => {
      await sql`
        UPDATE ${sql.table(userSortDbTableName)}
        SET ${sql.ref(userSortAssigneeDbFieldName)} = ${JSON.stringify('usr_legacy_scalar')}::jsonb
        WHERE "__id" = ${todoZoeRecordId}
      `.execute(ctx.testContainer.db);

      const copiedUser = {
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
        avatarUrl: `https://storage-public.teable.io/avatar/${ctx.testUser.id}`,
      };

      const result = await ctx.paste({
        tableId: userSortTableId,
        viewId: userSortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        projection: [userSortAssigneeFieldId],
        content: [[copiedUser]],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(userSortTableId, { limit: 10 });
      const nullRecord = records.find((record) => record.id === todoNullRecordId);

      expect(nullRecord?.fields[userSortAssigneeFieldId]).toMatchObject({
        id: copiedUser.id,
        title: copiedUser.title,
      });
    });
  });

  describe('paste with multi-column sort', () => {
    let multiSortTableId: string;
    let multiSortViewId: string;
    let multiSortNameFieldId: string;
    let multiSortGroupFieldId: string;
    let multiSortScoreFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste Multi Sort Table',
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

    it('should paste to correct row with two sort keys', async () => {
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
        throw new Error('Expected record not found for multi-column sort paste');
      }

      const result = await ctx.paste({
        tableId: multiSortTableId,
        viewId: multiSortViewId,
        ranges: [
          [0, targetOffset],
          [0, targetOffset],
        ],
        content: [['MultiSortPaste']],
        sort: [
          { fieldId: multiSortGroupFieldId, order: 'asc' },
          { fieldId: multiSortScoreFieldId, order: 'desc' },
        ],
      });

      expect(result.updatedCount).toBe(1);

      const updatedRecords = await ctx.listRecords(multiSortTableId);
      const updated = updatedRecords.find((record) => record.id === expectedId);
      expect(updated?.fields[multiSortNameFieldId]).toBe('MultiSortPaste');
    });
  });

  describe('paste with view default sort', () => {
    let defaultSortTableId: string;
    let defaultSortViewId: string;
    let defaultSortNameFieldId: string;
    let defaultSortValueFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'View Default Sort Paste Table',
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
    }, 30000);

    it('should use view default sort when sort is omitted', async () => {
      const result = await ctx.paste({
        tableId: defaultSortTableId,
        viewId: defaultSortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['DefaultSortUpdated']],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(defaultSortTableId);
      const recordE = records.find((r) => r.fields[defaultSortValueFieldId] === 500);
      const recordA = records.find((r) => r.fields[defaultSortValueFieldId] === 100);

      expect(recordE?.fields[defaultSortNameFieldId]).toBe('DefaultSortUpdated');
      expect(recordA?.fields[defaultSortNameFieldId]).toBe('RecordA');
    });
  });

  describe('paste with view group and sort defaults', () => {
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
        name: 'Paste Group Defaults Table',
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
      const result = await ctx.paste({
        tableId: groupTableId,
        viewId: groupViewId,
        ranges: [
          [0, 3],
          [0, 3],
        ],
        content: [['GroupedPaste']],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(groupTableId);
      const recordB1 = records.find((record) => record.id === recordB1Id);
      const recordB2 = records.find((record) => record.id === recordB2Id);

      expect(recordB1?.fields[groupNameFieldId]).toBe('GroupedPaste');
      expect(recordB2?.fields[groupNameFieldId]).toBe('B2');
    });
  });

  describe('paste with large offset and stable tie-breaker', () => {
    let tieTableId: string;
    let tieViewId: string;
    let tieNameFieldId: string;
    let tieValueFieldId: string;
    let tieDbTableName: string;
    const rowCount = 600;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste Large Offset Tie Table',
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
            // Make all sort values equal to force tie-breaker ordering
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

      // Force view row order to differ from insertion order
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

    it('should paste to correct row at large offset when sort values tie', async () => {
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
        throw new Error('Expected record not found for large offset paste');
      }

      const newValue = `PasteTie${targetOffset}`;
      const result = await ctx.paste({
        tableId: tieTableId,
        viewId: tieViewId,
        ranges: [
          [0, targetOffset],
          [0, targetOffset],
        ],
        content: [[newValue]],
        sort: [{ fieldId: tieValueFieldId, order: 'desc' }],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(tieTableId, { limit: rowCount });
      const updated = records.find((r) => r.id === expectedId);
      expect(updated?.fields[tieNameFieldId]).toBe(newValue);
    });
  });

  describe('paste event version (realtime sync)', () => {
    /**
     * These tests verify that paste operations publish events with correct
     * record versions for ShareDB realtime synchronization.
     *
     * Bug fix: Previously PasteHandler hardcoded oldVersion: 0 and newVersion: 1,
     * causing OT conflicts when clients had different versions.
     */
    let versionTableId: string;
    let versionViewId: string;
    let versionTextFieldId: string;
    let versionDbTableName: string;

    const getRecordVersion = async (recordId: string): Promise<number> => {
      const result = await sql<{ __version: number }>`
        SELECT "__version" FROM ${sql.table(versionDbTableName)} WHERE "__id" = ${recordId}
      `.execute(ctx.testContainer.db);
      return result.rows[0]?.__version ?? 0;
    };

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Version Test Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Count', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      versionTableId = table.id;
      versionViewId = table.views[0].id;
      versionTextFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      // Get the db table name for direct queries
      const tableMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', versionTableId)
        .executeTakeFirst();
      versionDbTableName = tableMeta?.db_table_name ?? '';
    }, 30000);

    it('should increment record version after paste update', async () => {
      // Create a record
      const record = await ctx.createRecord(versionTableId, {
        [versionTextFieldId]: 'Initial',
      });

      // Get initial version from database
      const initialVersion = await getRecordVersion(record.id);

      // Update the record a few times to increase version
      await ctx.updateRecord(versionTableId, record.id, { [versionTextFieldId]: 'Update 1' });
      await ctx.updateRecord(versionTableId, record.id, { [versionTextFieldId]: 'Update 2' });
      await ctx.updateRecord(versionTableId, record.id, { [versionTextFieldId]: 'Update 3' });

      // Get version after updates
      const versionAfterUpdates = await getRecordVersion(record.id);

      // Version should have increased
      expect(versionAfterUpdates).toBeGreaterThan(initialVersion);

      // Now paste to update the record
      await ctx.paste({
        tableId: versionTableId,
        viewId: versionViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['Pasted Value']],
      });

      // Get version after paste
      const versionAfterPaste = await getRecordVersion(record.id);

      // Version should have incremented by 1 after paste
      expect(versionAfterPaste).toBe(versionAfterUpdates + 1);

      // Verify the value was updated
      const records = await ctx.listRecords(versionTableId);
      expect(records[0].fields[versionTextFieldId]).toBe('Pasted Value');
    });

    it('should correctly increment versions for multiple records with different versions', async () => {
      // Create multiple records
      const record1 = await ctx.createRecord(versionTableId, { [versionTextFieldId]: 'Rec1' });
      const record2 = await ctx.createRecord(versionTableId, { [versionTextFieldId]: 'Rec2' });
      const record3 = await ctx.createRecord(versionTableId, { [versionTextFieldId]: 'Rec3' });

      // Update records different number of times to create different versions
      await ctx.updateRecord(versionTableId, record1.id, { [versionTextFieldId]: 'Rec1-v2' });

      await ctx.updateRecord(versionTableId, record2.id, { [versionTextFieldId]: 'Rec2-v2' });
      await ctx.updateRecord(versionTableId, record2.id, { [versionTextFieldId]: 'Rec2-v3' });
      await ctx.updateRecord(versionTableId, record2.id, { [versionTextFieldId]: 'Rec2-v4' });

      // record3 stays at initial version

      // Get versions before paste
      const v1Before = await getRecordVersion(record1.id);
      const v2Before = await getRecordVersion(record2.id);
      const v3Before = await getRecordVersion(record3.id);

      // Verify they have different versions
      expect(v1Before).not.toBe(v2Before);

      // Paste to update all three records
      // Note: Need to find the row indices for these records
      const recordsBeforePaste = await ctx.listRecords(versionTableId);
      const row1Index = recordsBeforePaste.findIndex((r) => r.id === record1.id);
      const row3Index = recordsBeforePaste.findIndex((r) => r.id === record3.id);

      await ctx.paste({
        tableId: versionTableId,
        viewId: versionViewId,
        ranges: [
          [0, row1Index],
          [0, row3Index],
        ],
        content: [['Pasted1'], ['Pasted2'], ['Pasted3']],
      });

      // Get versions after paste
      const v1After = await getRecordVersion(record1.id);
      const v2After = await getRecordVersion(record2.id);
      const v3After = await getRecordVersion(record3.id);

      // Each version should have incremented by exactly 1
      expect(v1After).toBe(v1Before + 1);
      expect(v2After).toBe(v2Before + 1);
      expect(v3After).toBe(v3Before + 1);
    });
  });

  describe('paste source/target compatibility matrix', () => {
    it('reproduces Created By -> User and User -> User paste', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste User Repro',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Assignee', type: 'user', options: { isMultiple: false } },
        ],
        views: [{ type: 'grid' }],
      });

      const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
      const userFieldId = table.fields.find((field) => field.name === 'Assignee')?.id ?? '';

      const tableWithCreatedBy = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          name: 'Created By',
          type: 'createdBy',
        },
      });
      const createdByFieldId =
        tableWithCreatedBy.fields.find((field) => field.name === 'Created By')?.id ?? '';
      const userFieldIndex = tableWithCreatedBy.fields.findIndex(
        (field) => field.id === userFieldId
      );

      await ctx.createRecord(table.id, {
        [primaryFieldId]: 'Row 1',
        [userFieldId]: {
          id: ctx.testUser.id,
          title: ctx.testUser.name,
          email: ctx.testUser.email,
        },
      });
      await ctx.createRecord(table.id, {
        [primaryFieldId]: 'Row 2',
      });

      const beforeRecords = await ctx.listRecords(table.id);
      const createdByValue = beforeRecords[0]?.fields[createdByFieldId];
      const userValue = beforeRecords[0]?.fields[userFieldId];

      await ctx.paste({
        tableId: table.id,
        viewId: table.views[0].id,
        ranges: [
          [userFieldIndex, 1],
          [userFieldIndex, 1],
        ],
        content: [[createdByValue]],
        typecast: true,
        sourceFields: [{ type: 'createdBy', cellValueType: 'string', isComputed: true }],
      });

      await ctx.paste({
        tableId: table.id,
        viewId: table.views[0].id,
        ranges: [
          [userFieldIndex, 1],
          [userFieldIndex, 1],
        ],
        content: [[userValue]],
        typecast: true,
        sourceFields: [{ type: 'user', cellValueType: 'string' }],
      });

      const afterRecords = await ctx.listRecords(table.id);
      expect(afterRecords[1]?.fields[userFieldId]).toMatchObject({
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
      });
    });

    describe('test.each: source -> singleSelect target', () => {
      const sourceCases: Array<{
        name: string;
        sourceFieldMeta: {
          type: string;
          cellValueType: string;
          isComputed?: boolean;
          isLookup?: boolean;
          isMultipleCellValue?: boolean;
        };
        sourceValueFactory: (testUser: SharedTestContext['testUser']) => unknown;
        expectedDisplayFactory: (testUser: SharedTestContext['testUser']) => string;
        existingOptions?: string[];
      }> = [
        {
          name: 'user object -> select name',
          sourceFieldMeta: { type: 'user', cellValueType: 'string' },
          sourceValueFactory: (testUser) => ({
            id: testUser.id,
            title: testUser.name,
            email: testUser.email,
          }),
          expectedDisplayFactory: (testUser) => testUser.name,
        },
        {
          name: 'createdBy object -> select name',
          sourceFieldMeta: { type: 'createdBy', cellValueType: 'string', isComputed: true },
          sourceValueFactory: (testUser) => ({
            id: testUser.id,
            title: testUser.name,
            email: testUser.email,
          }),
          expectedDisplayFactory: (testUser) => testUser.name,
        },
        {
          name: 'link object -> select title',
          sourceFieldMeta: { type: 'link', cellValueType: 'string' },
          sourceValueFactory: () => ({
            id: 'rec000000000000001',
            title: 'Linked Title',
          }),
          expectedDisplayFactory: () => 'Linked Title',
        },
        {
          name: 'json object with name -> select name',
          sourceFieldMeta: { type: 'json', cellValueType: 'string' },
          sourceValueFactory: () => ({
            name: 'Json Name',
            foo: 'bar',
          }),
          expectedDisplayFactory: () => 'Json Name',
        },
        {
          name: 'json object without title/name -> select json string',
          sourceFieldMeta: { type: 'json', cellValueType: 'string' },
          sourceValueFactory: () => ({
            foo: 'bar',
          }),
          expectedDisplayFactory: () => '{"foo":"bar"}',
        },
        {
          name: 'user object should not duplicate existing option',
          sourceFieldMeta: { type: 'user', cellValueType: 'string' },
          sourceValueFactory: (testUser) => ({
            id: testUser.id,
            title: testUser.name,
            email: testUser.email,
          }),
          expectedDisplayFactory: (testUser) => testUser.name,
          existingOptions: ['test'],
        },
      ];

      it.each(sourceCases)('$name', async (testCase) => {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Paste Matrix Select ${testCase.name}`,
          fields: [
            { name: 'Name', type: 'singleLineText', isPrimary: true },
            { name: 'Status', type: 'singleSelect', options: testCase.existingOptions ?? [] },
          ],
          views: [{ type: 'grid' }],
        });

        const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
        const selectFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
        const selectFieldIndex = table.fields.findIndex((field) => field.id === selectFieldId);

        await ctx.createRecord(table.id, {
          [primaryFieldId]: 'Row 1',
        });

        const sourceValue = testCase.sourceValueFactory(ctx.testUser);
        const expectedDisplay = testCase.expectedDisplayFactory(ctx.testUser);

        const pasteResult = await ctx.paste({
          tableId: table.id,
          viewId: table.views[0].id,
          ranges: [
            [selectFieldIndex, 0],
            [selectFieldIndex, 0],
          ],
          content: [[sourceValue]],
          typecast: true,
          sourceFields: [testCase.sourceFieldMeta],
        });

        expect(pasteResult.updatedCount).toBe(1);

        const records = await ctx.listRecords(table.id);
        expect(records[0]?.fields[selectFieldId]).toBe(expectedDisplay);

        const latestTable = await ctx.getTableById(table.id);
        const latestSelectField = latestTable.fields.find((field) => field.id === selectFieldId);
        const optionNames = (latestSelectField?.options?.choices ?? []).map(
          (choice) => choice.name
        );

        expect(optionNames).not.toContain('[object Object]');
        expect(optionNames).toContain(expectedDisplay);

        const expectedCount =
          testCase.existingOptions?.filter((name) => name === expectedDisplay).length ?? 0;
        if (expectedCount > 0) {
          expect(optionNames.filter((name) => name === expectedDisplay).length).toBe(expectedCount);
        }
      });
    });

    describe('test.each: readonly target should not be affected', () => {
      const readonlyCases: Array<{
        name: string;
        sourceFieldMeta: { type: string; cellValueType: string; isComputed?: boolean };
        sourceValueFactory: (testUser: SharedTestContext['testUser']) => unknown;
      }> = [
        {
          name: 'user object -> formula field',
          sourceFieldMeta: { type: 'user', cellValueType: 'string' },
          sourceValueFactory: (testUser) => ({
            id: testUser.id,
            title: testUser.name,
            email: testUser.email,
          }),
        },
      ];

      it.each(readonlyCases)('$name', async (testCase) => {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Paste Matrix Readonly ${testCase.name}`,
          fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
          views: [{ type: 'grid' }],
        });

        const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
        const tableWithFormula = await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            name: 'Formula',
            type: 'formula',
            options: { expression: `{${primaryFieldId}}` },
          },
        });
        const formulaFieldId =
          tableWithFormula.fields.find((field) => field.name === 'Formula')?.id ?? '';
        const formulaFieldIndex = tableWithFormula.fields.findIndex(
          (field) => field.id === formulaFieldId
        );

        await ctx.createRecord(table.id, {
          [primaryFieldId]: 'Row 1',
        });
        await ctx.drainOutbox(2);

        const beforeRecords = await ctx.listRecords(table.id);
        const beforeFormulaValue = beforeRecords[0]?.fields[formulaFieldId];

        const pasteResult = await ctx.paste({
          tableId: table.id,
          viewId: table.views[0].id,
          ranges: [
            [formulaFieldIndex, 0],
            [formulaFieldIndex, 0],
          ],
          content: [[testCase.sourceValueFactory(ctx.testUser)]],
          typecast: true,
          sourceFields: [testCase.sourceFieldMeta],
        });

        expect(pasteResult.updatedCount).toBe(0);
        expect(pasteResult.createdCount).toBe(0);

        const afterRecords = await ctx.listRecords(table.id);
        expect(afterRecords[0]?.fields[formulaFieldId]).toBe(beforeFormulaValue);
      });
    });
  });

  describe('paste with view-level sort and filter (no client sort/filter)', () => {
    /**
     * Regression test for paste row mismatch when the view has a saved sort/filter
     * but the client does NOT send sort/filter in the paste request.
     *
     * Scenario: The view has sort=Value DESC and filter=Value>=200.
     * Paste at row 0 without providing sort/filter.
     * Expected: paste targets the first record in DESC order among filtered records (E=500).
     * Bug: paste might target the wrong record if view defaults are not applied.
     */
    let vsSortTableId: string;
    let vsSortViewId: string;
    let vsSortNameFieldId: string;
    let vsSortValueFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'View Sort Filter Paste Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Value', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      vsSortTableId = table.id;
      vsSortViewId = table.views[0].id;
      vsSortNameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      vsSortValueFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      // Create records: A(100), B(200), C(300), D(400), E(500)
      for (const [name, value] of [
        ['RecordA', 100],
        ['RecordB', 200],
        ['RecordC', 300],
        ['RecordD', 400],
        ['RecordE', 500],
      ] as const) {
        await ctx.createRecord(vsSortTableId, {
          [vsSortNameFieldId]: name,
          [vsSortValueFieldId]: value,
        });
      }

      // Set view sort=Value DESC and filter=Value>=200 directly in the database
      await ctx.testContainer.db
        .updateTable('view')
        .set({
          sort: JSON.stringify({
            sortObjs: [{ fieldId: vsSortValueFieldId, order: 'desc' }],
          }),
          filter: JSON.stringify({
            conjunction: 'and',
            filterSet: [{ fieldId: vsSortValueFieldId, operator: 'isGreaterEqual', value: 200 }],
          }),
        })
        .where('id', '=', vsSortViewId)
        .execute();
    }, 30000);

    it('should paste to correct row using view default sort+filter when client omits them', async () => {
      // Filtered records in DESC order: E(500), D(400), C(300), B(200)
      // Paste at row 0 → should update E (first in DESC among filtered)
      const result = await ctx.paste({
        tableId: vsSortTableId,
        viewId: vsSortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['ViewSortFilterRow0']],
        // No sort or filter provided — rely on view defaults
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(vsSortTableId);
      const recordE = records.find((r) => r.fields[vsSortValueFieldId] === 500);
      const recordA = records.find((r) => r.fields[vsSortValueFieldId] === 100);
      const recordB = records.find((r) => r.fields[vsSortValueFieldId] === 200);

      // E should be updated (first in DESC)
      expect(recordE?.fields[vsSortNameFieldId]).toBe('ViewSortFilterRow0');
      // A should remain unchanged (filtered out)
      expect(recordA?.fields[vsSortNameFieldId]).toBe('RecordA');
      // B should remain unchanged
      expect(recordB?.fields[vsSortNameFieldId]).toBe('RecordB');
    });

    it('should paste to correct middle row using view default sort+filter', async () => {
      // Reset E first using view defaults (no explicit sort/filter)
      await ctx.paste({
        tableId: vsSortTableId,
        viewId: vsSortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['RecordE']],
      });

      // Filtered DESC: E(500), D(400), C(300), B(200)
      // Paste at row 2 → should update C (third in DESC among filtered)
      const result = await ctx.paste({
        tableId: vsSortTableId,
        viewId: vsSortViewId,
        ranges: [
          [0, 2],
          [0, 2],
        ],
        content: [['ViewSortFilterRow2']],
        // No sort or filter — rely on view defaults
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(vsSortTableId);
      const recordC = records.find((r) => r.fields[vsSortValueFieldId] === 300);

      // C should be updated (third in DESC among filtered)
      expect(recordC?.fields[vsSortNameFieldId]).toBe('ViewSortFilterRow2');
    });

    it('should paste at last filtered row using view default sort+filter', async () => {
      // Filtered DESC: E(500), D(400), C(300), B(200)
      // Paste at row 3 → should update B (last in DESC among filtered)
      const result = await ctx.paste({
        tableId: vsSortTableId,
        viewId: vsSortViewId,
        ranges: [
          [0, 3],
          [0, 3],
        ],
        content: [['ViewSortFilterRow3']],
        // No sort or filter — rely on view defaults
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(vsSortTableId);
      const recordB = records.find((r) => r.fields[vsSortValueFieldId] === 200);

      // B should be updated (last in DESC among filtered)
      expect(recordB?.fields[vsSortNameFieldId]).toBe('ViewSortFilterRow3');
    });
  });

  describe('paste with NULL values in sort field (v1 null ordering alignment)', () => {
    /**
     * Regression test for paste row offset mismatch caused by different NULL ordering
     * between v1 and v2.
     *
     * v1 uses: ASC NULLS FIRST, DESC NULLS LAST
     * PostgreSQL default: ASC NULLS LAST, DESC NULLS FIRST
     *
     * Without the fix, v2 uses PostgreSQL defaults, placing NULLs in the opposite
     * position from v1, so paste at row N targets a different record.
     */
    let nullSortTableId: string;
    let nullSortViewId: string;
    let nullSortNameFieldId: string;
    let nullSortScoreFieldId: string;
    let recordWithNull1Id: string;
    let recordWithNull2Id: string;
    let recordWith100Id: string;
    let recordWith200Id: string;
    let recordWith300Id: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Paste Null Sort Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Score', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });

      nullSortTableId = table.id;
      nullSortViewId = table.views[0].id;
      nullSortNameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      nullSortScoreFieldId = table.fields.find((f) => f.name === 'Score')?.id ?? '';

      // Create records: some have NULL Score
      recordWith100Id = (
        await ctx.createRecord(nullSortTableId, {
          [nullSortNameFieldId]: 'Row100',
          [nullSortScoreFieldId]: 100,
        })
      ).id;
      recordWithNull1Id = (
        await ctx.createRecord(nullSortTableId, {
          [nullSortNameFieldId]: 'RowNull1',
          // Score is NULL
        })
      ).id;
      recordWith200Id = (
        await ctx.createRecord(nullSortTableId, {
          [nullSortNameFieldId]: 'Row200',
          [nullSortScoreFieldId]: 200,
        })
      ).id;
      recordWithNull2Id = (
        await ctx.createRecord(nullSortTableId, {
          [nullSortNameFieldId]: 'RowNull2',
          // Score is NULL
        })
      ).id;
      recordWith300Id = (
        await ctx.createRecord(nullSortTableId, {
          [nullSortNameFieldId]: 'Row300',
          [nullSortScoreFieldId]: 300,
        })
      ).id;

      // Set view sort=Score ASC (v1 ordering: NULLs first, then 100, 200, 300)
      await ctx.testContainer.db
        .updateTable('view')
        .set({
          sort: JSON.stringify({
            sortObjs: [{ fieldId: nullSortScoreFieldId, order: 'asc' }],
          }),
        })
        .where('id', '=', nullSortViewId)
        .execute();
    }, 30000);

    it('should place NULLs first for ASC sort (v1 alignment) and paste to correct row', async () => {
      // v1 ordering (ASC NULLS FIRST): RowNull1, RowNull2, Row100, Row200, Row300
      // If v2 uses PG default (ASC NULLS LAST): Row100, Row200, Row300, RowNull1, RowNull2
      // Paste at row 0 should target the first record in v1 ordering = RowNull1 or RowNull2
      const result = await ctx.paste({
        tableId: nullSortTableId,
        viewId: nullSortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['PastedRow0']],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(nullSortTableId);
      const null1 = records.find((r) => r.id === recordWithNull1Id);
      const null2 = records.find((r) => r.id === recordWithNull2Id);
      const r100 = records.find((r) => r.id === recordWith100Id);

      // Row 0 should be one of the NULL records (NULLs first for ASC)
      const nullsWereFirst =
        null1?.fields[nullSortNameFieldId] === 'PastedRow0' ||
        null2?.fields[nullSortNameFieldId] === 'PastedRow0';
      expect(nullsWereFirst).toBe(true);

      // Row100 should NOT be updated (it's row 2 or later)
      expect(r100?.fields[nullSortNameFieldId]).toBe('Row100');
    });

    it('should place NULLs last for DESC sort (v1 alignment) and paste to correct row', async () => {
      // Reset the previous paste
      const records = await ctx.listRecords(nullSortTableId);
      const pastedRecord = records.find((r) => r.fields[nullSortNameFieldId] === 'PastedRow0');
      if (pastedRecord) {
        await ctx.updateRecord(nullSortTableId, pastedRecord.id, {
          [nullSortNameFieldId]: pastedRecord.id === recordWithNull1Id ? 'RowNull1' : 'RowNull2',
        });
      }

      // Change sort to DESC
      await ctx.testContainer.db
        .updateTable('view')
        .set({
          sort: JSON.stringify({
            sortObjs: [{ fieldId: nullSortScoreFieldId, order: 'desc' }],
          }),
        })
        .where('id', '=', nullSortViewId)
        .execute();

      // v1 ordering (DESC NULLS LAST): Row300, Row200, Row100, RowNull1, RowNull2
      // If v2 uses PG default (DESC NULLS FIRST): RowNull1, RowNull2, Row300, Row200, Row100
      // Paste at row 0 should target Row300 (first in DESC with NULLs last)
      const result = await ctx.paste({
        tableId: nullSortTableId,
        viewId: nullSortViewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['PastedDescRow0']],
      });

      expect(result.updatedCount).toBe(1);

      const updatedRecords = await ctx.listRecords(nullSortTableId);
      const r300 = updatedRecords.find((r) => r.id === recordWith300Id);

      // Row300 should be updated (first in DESC with NULLs last)
      expect(r300?.fields[nullSortNameFieldId]).toBe('PastedDescRow0');
    });

    it('should paste to correct middle row with NULLs in sort field', async () => {
      // Reset previous paste
      await ctx.updateRecord(nullSortTableId, recordWith300Id, {
        [nullSortNameFieldId]: 'Row300',
      });

      // Change sort back to ASC
      await ctx.testContainer.db
        .updateTable('view')
        .set({
          sort: JSON.stringify({
            sortObjs: [{ fieldId: nullSortScoreFieldId, order: 'asc' }],
          }),
        })
        .where('id', '=', nullSortViewId)
        .execute();

      // v1 ordering (ASC NULLS FIRST): RowNull1, RowNull2, Row100, Row200, Row300
      // Paste at row 3 should target Row200
      const result = await ctx.paste({
        tableId: nullSortTableId,
        viewId: nullSortViewId,
        ranges: [
          [0, 3],
          [0, 3],
        ],
        content: [['PastedMiddle']],
      });

      expect(result.updatedCount).toBe(1);

      const updatedRecords = await ctx.listRecords(nullSortTableId);
      const r200 = updatedRecords.find((r) => r.id === recordWith200Id);

      // Row200 should be updated (row 3 in ASC NULLS FIRST order)
      expect(r200?.fields[nullSortNameFieldId]).toBe('PastedMiddle');
    });
  });

  describe('paste with isNoneOf filter and NULL values (production regression)', () => {
    /**
     * Regression test: isNoneOf filter must include records where the field is NULL.
     *
     * Production scenario:
     * - SingleSelect "Status" with choices ["Open", "InProgress", "Closed"]
     * - Some records have NULL Status
     * - View filter: Status isNoneOf ["Closed"]
     * - v1: COALESCE(Status, '') NOT IN ('Closed') → NULLs are INCLUDED
     * - v2 bug: Status NOT IN ('Closed') → NULLs are EXCLUDED (NULL NOT IN → NULL → false)
     *
     * This causes different filtered sets and shifted row offsets, making paste target
     * the wrong record.
     */
    let isNoneOfTableId: string;
    let isNoneOfViewId: string;
    let isNoneOfNameFieldId: string;
    let isNoneOfStatusFieldId: string;
    let recordBravoId: string;
    let recordDeltaId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'IsNoneOf NULL Paste Table',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Status', type: 'singleSelect', options: ['Open', 'InProgress', 'Closed'] },
        ],
        views: [{ type: 'grid' }],
      });

      isNoneOfTableId = table.id;
      isNoneOfViewId = table.views[0].id;
      isNoneOfNameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      isNoneOfStatusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';

      // Create records - some with NULL Status
      await ctx.createRecord(isNoneOfTableId, {
        [isNoneOfNameFieldId]: 'Alpha',
        [isNoneOfStatusFieldId]: 'Open',
      });

      const recBravo = await ctx.createRecord(isNoneOfTableId, {
        [isNoneOfNameFieldId]: 'Bravo',
        // No Status — NULL
      });
      recordBravoId = recBravo.id;

      await ctx.createRecord(isNoneOfTableId, {
        [isNoneOfNameFieldId]: 'Charlie',
        [isNoneOfStatusFieldId]: 'InProgress',
      });

      const recDelta = await ctx.createRecord(isNoneOfTableId, {
        [isNoneOfNameFieldId]: 'Delta',
        // No Status — NULL
      });
      recordDeltaId = recDelta.id;

      await ctx.createRecord(isNoneOfTableId, {
        [isNoneOfNameFieldId]: 'Echo',
        [isNoneOfStatusFieldId]: 'Closed', // Will be excluded by filter
      });

      await ctx.createRecord(isNoneOfTableId, {
        [isNoneOfNameFieldId]: 'Foxtrot',
        [isNoneOfStatusFieldId]: 'Open',
      });

      // Set view: sort=Name ASC, filter=Status isNoneOf ["Closed"]
      await ctx.testContainer.db
        .updateTable('view')
        .set({
          sort: JSON.stringify({
            sortObjs: [{ fieldId: isNoneOfNameFieldId, order: 'asc' }],
          }),
          filter: JSON.stringify({
            conjunction: 'and',
            filterSet: [
              { fieldId: isNoneOfStatusFieldId, operator: 'isNoneOf', value: ['Closed'] },
            ],
          }),
        })
        .where('id', '=', isNoneOfViewId)
        .execute();
    }, 30000);

    it('should include NULL records in isNoneOf filter and paste to row 1 (Bravo)', async () => {
      // Filtered ASC order (excluding Echo=Closed):
      // Row 0: Alpha (Open)
      // Row 1: Bravo (NULL) ← must be included
      // Row 2: Charlie (InProgress)
      // Row 3: Delta (NULL) ← must be included
      // Row 4: Foxtrot (Open)

      const result = await ctx.paste({
        tableId: isNoneOfTableId,
        viewId: isNoneOfViewId,
        ranges: [
          [0, 1],
          [0, 1],
        ],
        content: [['PastedToBravo']],
        // No sort or filter — rely on view defaults
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(isNoneOfTableId);
      const bravo = records.find((r) => r.id === recordBravoId);

      // Bravo (NULL status, row 1) should be updated
      expect(bravo?.fields[isNoneOfNameFieldId]).toBe('PastedToBravo');
    });

    it('should paste to row 3 (Delta, another NULL record)', async () => {
      // Reset Bravo
      await ctx.updateRecord(isNoneOfTableId, recordBravoId, {
        [isNoneOfNameFieldId]: 'Bravo',
      });

      const result = await ctx.paste({
        tableId: isNoneOfTableId,
        viewId: isNoneOfViewId,
        ranges: [
          [0, 3],
          [0, 3],
        ],
        content: [['PastedToDelta']],
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(isNoneOfTableId);
      const delta = records.find((r) => r.id === recordDeltaId);

      // Delta (NULL status, row 3) should be updated
      expect(delta?.fields[isNoneOfNameFieldId]).toBe('PastedToDelta');
    });

    it('should not affect records excluded by isNoneOf filter', async () => {
      const records = await ctx.listRecords(isNoneOfTableId);
      const echo = records.find((r) => r.fields[isNoneOfStatusFieldId] === 'Closed');

      // Echo (Closed) should never be affected by paste — it's filtered out
      expect(echo?.fields[isNoneOfNameFieldId]).toBe('Echo');
    });
  });
});
