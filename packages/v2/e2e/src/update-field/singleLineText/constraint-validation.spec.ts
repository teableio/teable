/* eslint-disable @typescript-eslint/naming-convention */
import { updateFieldErrorResponseSchema } from '@teable/v2-contract-http';
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

const updateFieldRaw = async (
  ctx: SharedTestContext,
  payload: {
    tableId: string;
    fieldId: string;
    field: Record<string, unknown>;
  }
) => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseId: ctx.baseId,
      ...payload,
    }),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
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

      const notNullFailure = await updateFieldRaw(ctx, {
        tableId,
        fieldId,
        field: { notNull: true },
      });
      expect(notNullFailure.status).toBe(400);
      const parsedFailure = updateFieldErrorResponseSchema.safeParse(notNullFailure.body);
      expect(parsedFailure.success).toBe(true);
      if (parsedFailure.success) {
        expect(parsedFailure.data.error.code).toBe('validation.field.not_null');
        expect(parsedFailure.data.error.message).toBe(
          'Cannot mark field "TextField" as required because existing records contain empty values.'
        );
      }

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

  test('allows duplicate record values after disabling unique on a created unique field', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: createTableName(),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const fieldId = createFieldId();
      const withUniqueField = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleLineText',
          id: fieldId,
          name: 'ProjectName',
          unique: true,
        },
      });
      const createdField = withUniqueField.fields.find((field) => field.id === fieldId);
      expect(createdField?.unique).toBe(true);

      const first = await ctx.createRecord(tableId, { [fieldId]: 'same-project' });
      const second = await ctx.createRecord(tableId, { [fieldId]: 'other-project' });

      const uniqueDisabled = await ctx.updateField({
        tableId,
        fieldId,
        field: { unique: false },
      });
      const disabledField = uniqueDisabled.fields.find((field) => field.id === fieldId);
      expect(disabledField?.unique).not.toBe(true);

      const updated = await ctx.updateRecord(tableId, second.id, { [fieldId]: 'same-project' });
      expect(updated.fields[fieldId]).toBe('same-project');

      const records = await ctx.listRecords(tableId);
      const duplicateValues = records
        .filter((record) => record.id === first.id || record.id === second.id)
        .map((record) => record.fields[fieldId]);
      expect(duplicateValues.filter((value) => value === 'same-project')).toHaveLength(2);
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  });
});
