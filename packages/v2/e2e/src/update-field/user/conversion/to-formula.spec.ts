/**
 * E2E tests for converting User field to Formula.
 *
 * NOTE: This conversion requires schema recreation (drop old column, create new).
 * Formula fields are computed fields that store their expression and result type,
 * not data from the source user field.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: user → formula conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createUserField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name,
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User to Formula Conversion',
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
    const fieldId = await createUserField('User Field');
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: ctx.testUser.id, title: ctx.testUser.name },
    });

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
    const fieldId = await createUserField('Invalid Expression Field');

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
    const fieldId = await createUserField('User Field');
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: ctx.testUser.id, title: ctx.testUser.name },
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

  test('should handle formula that references other fields', async () => {
    const fieldId = await createUserField('User Field');
    const numFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: numFieldId,
        name: 'Number Field',
      },
    });

    const r1 = await ctx.createRecord(tableId, { [numFieldId]: 10 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: {
        type: 'formula',
        options: {
          expression: `{${numFieldId}} + 1`,
        },
      },
    });

    const records = await ctx.listRecords(tableId);
    const record = records.find((r: { id: string }) => r.id === r1.id);
    expect(record?.fields[fieldId]).toBe(11);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteField({ tableId, fieldId: numFieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createUserField('Null User Field');
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
