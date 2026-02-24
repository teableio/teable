/**
 * E2E tests for converting SingleLineText field to Date field.
 *
 * Conversion behavior:
 * - ISO date strings (YYYY-MM-DD) are parsed to dates
 * - ISO datetime strings are parsed to datetime
 * - Invalid date strings become null
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleLineText → date conversion', () => {
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
      name: 'SingleLineText to Date Conversion',
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

  test('should convert ISO date strings', async () => {
    // Setup: Create singleLineText with ISO date values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Date Field' },
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

    // Assert: Values parsed as dates
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-01-15/);
    expect(rec2?.fields[fieldId]).toMatch(/^2024-12-31/);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert ISO datetime strings', async () => {
    // Setup: Create singleLineText with ISO datetime values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Datetime Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00Z' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '2024-06-20T15:45:30Z' });

    // Action: Convert to date
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: Values parsed as datetime
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-01-15/);
    expect(rec2?.fields[fieldId]).toMatch(/^2024-06-20/);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle invalid date strings', async () => {
    // Setup: Create singleLineText with invalid date values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Invalid Date' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'not-a-date' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'random text' });

    // Action: Convert to date
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: Invalid dates become null
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
    // Setup: Create singleLineText with null values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Null Date' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-03-15' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' }); // null for fieldId

    // Action: Convert to date
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-03-15/);
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle mixed valid and invalid dates', async () => {
    // Setup: Create singleLineText with mixed values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Mixed Dates' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-07-04' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'invalid' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '2024-12-25T00:00:00Z' });

    // Action: Convert to date
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Assert: Valid dates converted, invalid becomes null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-07-04/);
    expect(rec2?.fields[fieldId]).toBeNull();
    expect(rec3?.fields[fieldId]).toMatch(/^2024-12-25/);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });
});
