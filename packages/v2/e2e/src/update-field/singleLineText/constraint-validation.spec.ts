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

      const uniqueFailure = await updateFieldRaw(ctx, {
        tableId,
        fieldId,
        field: { unique: true },
      });
      expect(uniqueFailure.status).toBe(400);
      const parsedUniqueFailure = updateFieldErrorResponseSchema.safeParse(uniqueFailure.body);
      expect(parsedUniqueFailure.success).toBe(true);
      if (parsedUniqueFailure.success) {
        expect(parsedUniqueFailure.data.error.code).toBe('validation.field.unique_existing_values');
        expect(parsedUniqueFailure.data.error.message).toBe(
          'Cannot mark field "TextField" as unique because existing records contain duplicate values.'
        );
        expect(parsedUniqueFailure.data.error.localization).toEqual({
          i18nKey: 'httpErrors.custom.fieldUniqueExistingValues',
          context: { fieldName: 'TextField' },
        });
      }

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
        expect(parsedFailure.data.error.code).toBe('validation.field.required_existing_values');
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

  /**
   * v1 parity (T6520): a type conversion rebuilds the field definition and
   * clears its validation constraints in the domain model. The in-place
   * ALTER TYPE used to leave the underlying unique index / NOT NULL column
   * constraint alive as a ghost — invisible in the field metadata but still
   * rejecting writes. Conversion now drops them together with the flags.
   */
  test('drops the unique constraint when the field type is converted', async () => {
    const fieldId = createFieldId();
    const tableName = createTableName();
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: tableName,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: fieldId, name: 'Code', unique: true },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      const nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const r1 = await ctx.createRecord(tableId, {
        [nameFieldId]: 'R1',
        [fieldId]: '42',
      });
      expect(r1.id).toBeTruthy();

      // Unique holds before conversion
      const duplicate = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          fields: { [nameFieldId]: 'R2', [fieldId]: '42' },
        }),
      });
      expect(duplicate.status).toBeGreaterThanOrEqual(400);

      // Convert the field type: the constraint is cleared with the flags
      const converted = await ctx.updateField({
        baseId: ctx.baseId,
        tableId,
        fieldId,
        field: { type: 'number' },
      });
      expect(converted.fields.find((f) => f.id === fieldId)?.unique).not.toBe(true);

      const afterConversion = await ctx.createRecord(tableId, {
        [nameFieldId]: 'R3',
        [fieldId]: 42,
      });
      expect(afterConversion.id).toBeTruthy();
      const anotherDuplicate = await ctx.createRecord(tableId, {
        [nameFieldId]: 'R4',
        [fieldId]: 42,
      });
      expect(anotherDuplicate.id).toBeTruthy();
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  });

  test('drops the ghost NOT NULL column constraint when the field type is converted', async () => {
    const fieldId = createFieldId();
    const tableName = createTableName();
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: tableName,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: fieldId, name: 'Req', notNull: true },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      const nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const converted = await ctx.updateField({
        baseId: ctx.baseId,
        tableId,
        fieldId,
        field: { type: 'number' },
      });
      expect(converted.fields.find((f) => f.id === fieldId)?.notNull).not.toBe(true);

      // The field metadata says optional — creating without the field must work
      const created = await ctx.createRecord(tableId, { [nameFieldId]: 'NoReq' });
      expect(created.id).toBeTruthy();
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  });
});
