/**
 * E2E tests for updating Number field properties.
 *
 * Tests cover:
 * - Formatting updates (precision, type)
 * - ShowAs updates (bar, ring, etc.)
 * - DefaultValue updates
 * - Record value transformations when precision changes
 */
/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldDto } from '@teable/v2-contract-http';
import { NumberFormattingType } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

// Type guard for number field options
type NumberFieldDto = IFieldDto & {
  type: 'number';
  options?: {
    formatting: { type: NumberFormattingType; precision: number; symbol?: string };
    showAs?: { type: string; color: string; showValue?: boolean; maxValue?: number };
    defaultValue?: number;
  };
};

const isNumberField = (field: IFieldDto): field is NumberFieldDto => {
  return field.type === 'number';
};

describe('update-field: number property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create a fresh table for these tests
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Number Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
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

  // ============ Name updates ============

  test('should update field name', async () => {
    // Setup: Create number field named "Amount"
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Amount' },
    });

    // Create record with value
    const record = await ctx.createRecord(tableId, { [fieldId]: 100 });

    // Action: Update name to "Price"
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Price' },
    });

    // Assert: Name changed, values preserved
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field?.name).toBe('Price');

    const records = await ctx.listRecords(tableId);
    const r = records.find((rec) => rec.id === record.id);
    expect(r?.fields[fieldId]).toBe(100);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });

  // ============ Formatting updates ============

  test('should update precision', async () => {
    // Setup: Create number field with precision: 2, values: 123.456789
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: fieldId,
        name: 'Precision Test',
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
      },
    });

    const record = await ctx.createRecord(tableId, { [fieldId]: 123.456789 });

    // Action: Update precision to 4
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { formatting: { type: NumberFormattingType.Decimal, precision: 4 } } },
    });

    // Assert:
    // - Field precision changed
    // - Stored values unchanged (precision affects display only)
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.formatting.precision).toBe(4);
    }

    const records = await ctx.listRecords(tableId);
    const r = records.find((rec) => rec.id === record.id);
    expect(r?.fields[fieldId]).toBe(123.456789);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });

  test('should update from decimal to percent', async () => {
    // Setup: Create number field with type: 'decimal', value: 0.5
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: fieldId,
        name: 'Percent Test',
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
      },
    });

    const record = await ctx.createRecord(tableId, { [fieldId]: 0.5 });

    // Action: Update type to 'percent'
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { formatting: { type: NumberFormattingType.Percent, precision: 2 } } },
    });

    // Assert:
    // - Field type changed
    // - Value still 0.5 (displayed as 50%)
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.formatting.type).toBe(NumberFormattingType.Percent);
    }

    const records = await ctx.listRecords(tableId);
    const r = records.find((rec) => rec.id === record.id);
    expect(r?.fields[fieldId]).toBe(0.5);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });

  test('should update from decimal to currency', async () => {
    // Setup: Create number field with type: 'decimal', value: 100
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: fieldId,
        name: 'Currency Test',
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
      },
    });

    const record = await ctx.createRecord(tableId, { [fieldId]: 100 });

    // Action: Update to type: 'currency', symbol: 'USD'
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: { type: NumberFormattingType.Currency, precision: 2, symbol: 'USD' },
        },
      },
    });

    // Assert:
    // - Field type changed
    // - Value still 100 (displayed as $100.00)
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.formatting.type).toBe(NumberFormattingType.Currency);
      expect(field.options?.formatting.symbol).toBe('USD');
    }

    const records = await ctx.listRecords(tableId);
    const r = records.find((rec) => rec.id === record.id);
    expect(r?.fields[fieldId]).toBe(100);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });

  // ============ ShowAs updates ============

  test('should set showAs to bar', async () => {
    // Setup: Create number field with values: 25, 50, 75
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Bar Test' },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: 25 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 50 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 75 });

    // Action: Update showAs to { type: 'bar', color: 'green', showValue: true, maxValue: 100 }
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          showAs: { type: 'bar', color: 'green', showValue: true, maxValue: 100 },
        },
      },
    });

    // Assert:
    // - showAs configured
    // - Values preserved
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.showAs).toEqual({
        type: 'bar',
        color: 'green',
        showValue: true,
        maxValue: 100,
      });
    }

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(25);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(50);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(75);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should set showAs to ring', async () => {
    // Setup: Create number field
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Ring Test' },
    });

    // Action: Update showAs to { type: 'ring', color: 'blue', showValue: false, maxValue: 100 }
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          showAs: { type: 'ring', color: 'blue', showValue: false, maxValue: 100 },
        },
      },
    });

    // Assert: showAs configured
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.showAs).toEqual({
        type: 'ring',
        color: 'blue',
        showValue: false,
        maxValue: 100,
      });
    }

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });

  test('should remove showAs', async () => {
    // Setup: Create number field with showAs bar
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: fieldId,
        name: 'Remove ShowAs',
        options: {
          showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 50 },
        },
      },
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: { options: { showAs: undefined } },
      })
    ).rejects.toThrow();

    const table = await ctx.getTableById(tableId);
    const field = table.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.showAs).toEqual({
        type: 'bar',
        color: 'red',
        showValue: true,
        maxValue: 50,
      });
    }

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });

  // ============ DefaultValue updates ============

  test('should set defaultValue', async () => {
    // Setup: Create number field with no defaultValue
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Set Default' },
    });

    // Action: Update defaultValue to 0
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { defaultValue: 0 } },
    });

    // Assert: Field defaultValue set
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.defaultValue).toBe(0);
    }

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });

  test('should update defaultValue', async () => {
    // Setup: Create number field with defaultValue: 0
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: fieldId,
        name: 'Update Default',
        options: { defaultValue: 0 },
      },
    });

    // Action: Update defaultValue to 100
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { defaultValue: 100 } },
    });

    // Assert: Field defaultValue changed
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.defaultValue).toBe(100);
    }

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });

  // ============ Combined updates ============

  test('should update formatting and showAs together', async () => {
    // Setup: Create number field
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Combined Test' },
    });

    // Action: Update precision, type, and showAs in single request
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: { type: NumberFormattingType.Percent, precision: 3 },
          showAs: { type: 'bar', color: 'yellow', showValue: false, maxValue: 1 },
        },
      },
    });

    // Assert: All properties updated atomically
    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isNumberField(field!)).toBe(true);
    if (isNumberField(field!)) {
      expect(field.options?.formatting).toEqual({
        type: NumberFormattingType.Percent,
        precision: 3,
      });
      expect(field.options?.showAs).toEqual({
        type: 'bar',
        color: 'yellow',
        showValue: false,
        maxValue: 1,
      });
    }

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });

  // ============ Record value handling ============

  test('should preserve exact values when changing formatting', async () => {
    // Setup: Create number field with precision: 2, value: 123.456789
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: fieldId,
        name: 'Preserve Value',
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
      },
    });

    const record = await ctx.createRecord(tableId, { [fieldId]: 123.456789 });

    // Action: Update precision to 0
    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } } },
    });

    // Assert:
    // - Stored value unchanged (123.456789)
    // - Display shows rounded value (123) - display is out of scope for e2e backend test usually,
    //   but we verify the value in DB/API remains high-precision.
    const records = await ctx.listRecords(tableId);
    const r = records.find((rec) => rec.id === record.id);
    expect(r?.fields[fieldId]).toBe(123.456789);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });

  test('should handle null values when updating options', async () => {
    // Setup: Create number field with some null values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Null Test' },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: 42 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: null });

    // Action: Update formatting
    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { formatting: { type: NumberFormattingType.Decimal, precision: 5 } } },
    });

    // Assert: Null values remain null
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(42);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
