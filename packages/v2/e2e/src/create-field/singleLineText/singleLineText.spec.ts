/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { createFieldErrorResponseSchema } from '@teable/v2-contract-http';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: singleLineText v1 parity', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('create/update field preserves dbFieldName', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-dbfield'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const tableAfterCreate = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleLineText',
          name: 'TextField',
          dbFieldName: 'fld_custom_a',
        },
      });
      const createdField = tableAfterCreate.fields.find((f) => f.name === 'TextField');
      if (!createdField) throw new Error('Missing created field');
      expect(createdField.dbFieldName).toBe('fld_custom_a');

      const tableAfterUpdate = await ctx.updateField({
        tableId,
        fieldId: createdField.id,
        field: {
          type: 'singleLineText',
          dbFieldName: 'fld_custom_b',
        },
      });
      const updatedField = tableAfterUpdate.fields.find((f) => f.id === createdField.id);
      expect(updatedField?.dbFieldName).toBe('fld_custom_b');
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('rejects duplicate dbFieldName on create', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-dbfield-duplicate'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const first = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleLineText',
          name: 'TextField-1',
          dbFieldName: 'fld_custom_duplicate',
        },
      });

      expect(first.fields.some((f) => f.dbFieldName === 'fld_custom_duplicate')).toBe(true);

      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'singleLineText',
            name: 'TextField-2',
            dbFieldName: 'fld_custom_duplicate',
          },
        }),
      });

      expect(response.status).toBe(400);
      const raw = await response.json();
      const parsed = createFieldErrorResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ok).toBe(false);
        expect(parsed.data.error.message).toContain('already exists in this table');
      }
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('primary field unique toggles back to false explicitly', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-primary-unique'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Missing primary field');

      await ctx.updateField({
        tableId,
        fieldId: primaryFieldId,
        field: { unique: true },
      });

      const afterDrop = await ctx.updateField({
        tableId,
        fieldId: primaryFieldId,
        field: { unique: false },
      });

      const primaryAfter = afterDrop.fields.find((f) => f.id === primaryFieldId) as
        | { unique?: boolean }
        | undefined;
      expect(primaryAfter?.unique).toBe(false);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });
});
