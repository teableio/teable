/**
 * E2E tests for converting multipleSelect field to formula.
 *
 * NOTE: This conversion requires schema recreation (drop old column, create new).
 * formula fields are computed fields that don't preserve data from the source field.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: multipleSelect → formula conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createMultipleSelectField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name,
        options: {
          choices: [
            { id: 'cho1', name: 'Option 1', color: 'red' },
            { id: 'cho2', name: 'Option 2', color: 'blue' },
          ],
        },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'MultipleSelect to Formula Conversion',
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
    const fieldId = await createMultipleSelectField('MultipleSelect Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['Option 1'] });

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
    const fieldId = await createMultipleSelectField('Invalid Expression Field');

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
  });

  test('should convert to formula and clear data', async () => {
    const fieldId = await createMultipleSelectField('MultipleSelect Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['Option 1'] });

    await ctx.updateField({
      tableId,
      fieldId,
      field: {
        type: 'formula',
        options: {
          expression: '1 + 1',
        },
      },
    });

    const records = await ctx.listRecords(tableId);
    const record = records.find((r: { id: string }) => r.id === r1.id);
    expect(record?.fields[fieldId]).toBe(2);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createMultipleSelectField('Null MultipleSelect Field');
    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'No value',
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: {
        type: 'formula',
        options: {
          expression: '1 + 1',
        },
      },
    });

    const records = await ctx.listRecords(tableId);
    const record = records.find((r: { id: string }) => r.id === r1.id);
    expect(record?.fields[fieldId]).toBe(2);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
