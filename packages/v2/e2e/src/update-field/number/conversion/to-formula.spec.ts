/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: number → formula conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createNumberField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Number to Formula Conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        void 0;
      }
    }
  });

  test('should reject conversion to formula when expression is missing', async () => {
    const fieldId = await createNumberField('Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 42 });

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
    const fieldId = await createNumberField('Invalid Formula Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 7 });

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
