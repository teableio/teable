/**
 * E2E tests for converting date field to formula.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: date → formula conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createDateField = async (name: string) => {
    const fieldId = createFieldId();
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
      name: 'Date to Formula Conversion',
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

  test('should reject conversion to formula when expression is missing', async () => {
    const fieldId = await createDateField('Date Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: {
          type: 'formula',
        },
      })
    ).rejects.toThrow();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should reject conversion to formula when expression is invalid', async () => {
    const fieldId = await createDateField('Null Date Field');
    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'No value',
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: {
          type: 'formula',
          options: {
            expression: 'INVALID(',
          },
        },
      })
    ).rejects.toThrow();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
