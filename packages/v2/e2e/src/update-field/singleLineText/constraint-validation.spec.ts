/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
let tableNameCounter = 0;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const createTableName = () => {
  const suffix = tableNameCounter.toString(36).padStart(6, '0');
  tableNameCounter += 1;
  return `v1p-field-validation-${suffix}`;
};

describe('update-field: singleLineText constraint validation', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('[V1 PARITY] should validate unique/notNull updates and allow retry after data cleanup', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: createTableName(),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const fieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleLineText',
          id: fieldId,
          name: 'TextField',
        },
      });

      const duplicateA = await ctx.createRecord(tableId, { [fieldId]: '100' });
      const duplicateB = await ctx.createRecord(tableId, { [fieldId]: '100' });
      const nullRecord = await ctx.createRecord(tableId, {});

      await expect(
        ctx.updateField({
          tableId,
          fieldId,
          field: { unique: true },
        })
      ).rejects.toThrow('validation.field.unique');

      await ctx.deleteRecord(tableId, duplicateB.id);

      const uniqueEnabled = await ctx.updateField({
        tableId,
        fieldId,
        field: { unique: true },
      });
      const uniqueField = uniqueEnabled.fields.find((field) => field.id === fieldId);
      expect(uniqueField?.unique).toBe(true);

      await expect(
        ctx.updateField({
          tableId,
          fieldId,
          field: { notNull: true },
        })
      ).rejects.toThrow('validation.field.not_null');

      await ctx.deleteRecord(tableId, nullRecord.id);

      const notNullEnabled = await ctx.updateField({
        tableId,
        fieldId,
        field: { notNull: true },
      });
      const notNullField = notNullEnabled.fields.find((field) => field.id === fieldId);
      expect(notNullField?.notNull).toBe(true);

      await ctx.deleteRecord(tableId, duplicateA.id);
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  });
});
