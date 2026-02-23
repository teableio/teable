/**
 * E2E tests for converting SingleSelect field to Date.
 *
 * Conversion behavior:
 * - Date-like option values (ISO format strings) are parsed to dates
 * - Non-date option values become null
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleSelect → date conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'SingleSelect to Date Conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No primary field');
    primaryFieldId = primaryField.id;
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('should convert date-like options to dates', async () => {
    // Setup: Create singleSelect with date-like options
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Date Select',
        options: ['2024-01-15', '2024-01-16', '2024-12-31'],
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '2024-12-31' });

    // Action: Convert to date
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: Values converted to ISO date strings
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    // Date values are stored as ISO strings
    expect(rec1?.fields[fieldId]).toMatch(/^2024-01-15/);
    expect(rec2?.fields[fieldId]).toMatch(/^2024-12-31/);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert non-date options to null', async () => {
    // Setup: Create singleSelect with non-date options
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Color Select',
        options: ['Red', 'Green', 'Blue'],
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Green' });

    // Action: Convert to date
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: Non-date values become null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBeNull();
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle null values', async () => {
    // Setup: Create singleSelect field with some null values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Nullable Select',
        options: ['2024-01-15', 'Option A'],
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No field value' }); // null for fieldId

    // Action: Convert to date
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: null remains null, date-like value is converted
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-01-15/);
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle mixed date and non-date options', async () => {
    // Setup: Create singleSelect with both date-like and non-date options
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Mixed Select',
        options: ['2024-06-15', 'Not a date', '2024-12-25'],
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-06-15' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Not a date' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '2024-12-25' });

    // Action: Convert to date
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: Date-like values converted, non-date becomes null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-06-15/);
    expect(rec2?.fields[fieldId]).toBeNull();
    expect(rec3?.fields[fieldId]).toMatch(/^2024-12-25/);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert with date formatting options', async () => {
    // Setup: Create singleSelect with date-like option
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Formatted Date Select',
        options: ['2024-03-20'],
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-03-20' });

    // Action: Convert to date with formatting options
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        type: 'date',
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'None',
            timeZone: 'UTC',
          },
        },
      },
    });

    // Assert: Field type changed with options
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: Value converted
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-03-20/);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
