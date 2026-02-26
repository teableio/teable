/**
 * E2E tests for updating Date field properties.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let globalFieldIdCounter = 0;
const createGlobalFieldId = () => {
  const suffix = globalFieldIdCounter.toString(36).padStart(16, '0');
  globalFieldIdCounter += 1;
  return `fld${suffix}`;
};

describe('update-field: date property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;

  const createDateField = async (
    name: string,
    formatting?: { date: string; time: 'None' | 'HH:mm' | 'hh:mm A'; timeZone: string },
    defaultValue?: string
  ) => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'date',
        id: fieldId,
        name,
        options: {
          ...(formatting ? { formatting } : {}),
          ...(defaultValue ? { defaultValue } : {}),
        },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Date Update Properties',
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

  test('should update date format', async () => {
    const fieldId = await createDateField('Date Format Field', {
      date: 'YYYY-MM-DD',
      time: 'None',
      timeZone: 'utc',
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15' });

    const before = await ctx.listRecords(tableId);
    const beforeValue = before.find((r) => r.id === r1.id)?.fields[fieldId];

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: {
            date: 'M/D/YYYY',
            time: 'None',
            timeZone: 'utc',
          },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { options?: { formatting?: { date?: string } } }
      | undefined;
    expect(updatedField?.options?.formatting?.date).toBe('M/D/YYYY');

    const after = await ctx.listRecords(tableId);
    const afterValue = after.find((r) => r.id === r1.id)?.fields[fieldId];
    expect(afterValue).toBe(beforeValue);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should update time format', async () => {
    const fieldId = await createDateField('Time Format Field', {
      date: 'YYYY-MM-DD',
      time: 'HH:mm',
      timeZone: 'utc',
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'hh:mm A',
            timeZone: 'utc',
          },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { options?: { formatting?: { time?: string } } }
      | undefined;
    expect(updatedField?.options?.formatting?.time).toBe('hh:mm A');

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should toggle include time', async () => {
    const fieldId = await createDateField('Include Time Field', {
      date: 'YYYY-MM-DD',
      time: 'None',
      timeZone: 'utc',
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { options?: { formatting?: { time?: string } } }
      | undefined;
    expect(updatedField?.options?.formatting?.time).toBe('HH:mm');

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId];
    expect(String(value)).toMatch(/^2024-01-15T00:00:00\.000Z$/);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should update timezone', async () => {
    const fieldId = await createDateField('Timezone Field', {
      date: 'YYYY-MM-DD',
      time: 'HH:mm',
      timeZone: 'utc',
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });

    const before = await ctx.listRecords(tableId);
    const beforeValue = before.find((r) => r.id === r1.id)?.fields[fieldId];

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'America/New_York',
          },
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { options?: { formatting?: { timeZone?: string } } }
      | undefined;
    expect(updatedField?.options?.formatting?.timeZone).toBe('America/New_York');

    const after = await ctx.listRecords(tableId);
    const afterValue = after.find((r) => r.id === r1.id)?.fields[fieldId];
    expect(afterValue).toBe(beforeValue);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should reject static date defaultValue (only now is supported)', async () => {
    const fieldId = await createDateField('Static Default Field', {
      date: 'YYYY-MM-DD',
      time: 'None',
      timeZone: 'utc',
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: {
          options: {
            formatting: {
              date: 'YYYY-MM-DD',
              time: 'None',
              timeZone: 'utc',
            },
            defaultValue: '2024-01-01',
          },
        },
      })
    ).rejects.toThrow('Invalid DateDefaultValue');

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should set defaultValue to now', async () => {
    const fieldId = await createDateField('Now Default Field', {
      date: 'YYYY-MM-DD',
      time: 'HH:mm',
      timeZone: 'utc',
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          },
          defaultValue: 'now',
        },
      },
    });

    const beforeMs = Date.now();
    const rec = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'New record with now default',
    });
    const afterMs = Date.now();

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === rec.id)?.fields[fieldId];
    expect(value).toBeTruthy();

    const parsed = Date.parse(String(value));
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(beforeMs - 5_000);
    expect(parsed).toBeLessThanOrEqual(afterMs + 5_000);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });
});

describe('update-field: date conversions', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;

  const createDateField = async (name: string) => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'date',
        id: fieldId,
        name,
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          },
        },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Date Conversion In Update Properties',
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

  test('should convert date to text', async () => {
    const fieldId = await createDateField('Date to Text');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId];
    expect(value).toEqual(expect.any(String));
    expect(String(value)).toContain('2024-01-15');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should convert date to number (timestamp)', async () => {
    const fieldId = await createDateField('Date to Number');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-01T00:00:00.000Z' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId];
    expect(value).toBe(1704067200000);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should convert date to singleSelect', async () => {
    const fieldId = await createDateField('Date to SingleSelect');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleSelect');

    const records = await ctx.listRecords(tableId);
    const v1 = records.find((r) => r.id === r1.id)?.fields[fieldId];
    const v2 = records.find((r) => r.id === r2.id)?.fields[fieldId];
    expect(v1).toEqual(expect.any(String));
    expect(v2).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert date to multipleSelect', async () => {
    const fieldId = await createDateField('Date to MultipleSelect');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('multipleSelect');

    const records = await ctx.listRecords(tableId);
    const v1 = records.find((r) => r.id === r1.id)?.fields[fieldId];
    const v2 = records.find((r) => r.id === r2.id)?.fields[fieldId];
    expect(v1).toEqual([expect.any(String)]);
    expect(v2).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert date to checkbox', async () => {
    const fieldId = await createDateField('Date to Checkbox');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('checkbox');

    const records = await ctx.listRecords(tableId);
    const v1 = records.find((r) => r.id === r1.id)?.fields[fieldId];
    const v2 = records.find((r) => r.id === r2.id)?.fields[fieldId];
    expect(v1).toBe(true);
    expect(v2).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
