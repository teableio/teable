/**
 * D06 / D17 — backfill rules when the field configuration changes.
 *
 * D06 (待定口径): the requirement document asks whether adding a field, changing
 * its default value, or turning on "required" backfills existing rows. The
 * cases below characterise v2: only a **required** field with a valid default
 * backfills, because the backfill exists to satisfy the NOT NULL constraint.
 *
 * D17 (建议需求): default + required + unique must interact legally and fail
 * loudly rather than silently.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  getSharedTestContext,
  readAllValues,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('D06/D17: field configuration changes and existing rows', () => {
  let ctx: SharedTestContext;
  let tableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'D06 Backfill',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    // Three pre-existing rows with no value for any later field.
    await ctx.createRecords(tableId, [
      { fields: { [fieldByName(table, 'Title').id]: 'row-1' } },
      { fields: { [fieldByName(table, 'Title').id]: 'row-2' } },
      { fields: { [fieldByName(table, 'Title').id]: 'row-3' } },
    ]);
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('D06 an optional field with a default does not backfill existing rows', async () => {
    const table = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', name: 'OptionalDefault', options: { defaultValue: 5 } },
    });
    const fieldId = fieldByName(table, 'OptionalDefault').id;

    await expect(readAllValues(ctx, tableId, fieldId)).resolves.toEqual([null, null, null]);

    // New rows still receive the default.
    const fresh = await ctx.createRecord(tableId, {});
    const rows = await ctx.listRecords(tableId);
    expect(rows.find((row) => row.id === fresh.id)?.fields[fieldId]).toBe(5);
    // ...and the pre-existing rows are left untouched by that later create.
    await expect(readAllValues(ctx, tableId, fieldId)).resolves.toEqual([null, null, null, 5]);
  });

  test('D06 a required field with a default backfills every existing row', async () => {
    const table = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        name: 'RequiredDefault',
        notNull: true,
        options: { defaultValue: 9 },
      },
    });
    const fieldId = fieldByName(table, 'RequiredDefault').id;

    await expect(readAllValues(ctx, tableId, fieldId)).resolves.toEqual([9, 9, 9, 9]);
  });

  test('D06/D17 a required field without a default is rejected on a non-empty table', async () => {
    // Silently creating the column would leave the table permanently invalid,
    // so the command must fail with a locatable error.
    await expect(
      ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'RequiredNoDefault', notNull: true },
      })
    ).rejects.toThrow(/required_existing_values|existing records contain empty values/i);
  });

  test('D06 changing the default value does not rewrite existing rows', async () => {
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', name: 'ChangeDefault', options: { defaultValue: 1 } },
    });
    const fieldId = fieldByName(created, 'ChangeDefault').id;
    await expect(readAllValues(ctx, tableId, fieldId)).resolves.toEqual([null, null, null, null]);

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { defaultValue: 99 } },
    });

    // Unchanged for existing rows...
    await expect(readAllValues(ctx, tableId, fieldId)).resolves.toEqual([null, null, null, null]);

    // ...but the new default applies to the next created row.
    const fresh = await ctx.createRecord(tableId, {});
    const rows = await ctx.listRecords(tableId);
    expect(rows.find((row) => row.id === fresh.id)?.fields[fieldId]).toBe(99);
  });

  test('D17 enabling required after clearing is rejected while empty rows remain', async () => {
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', name: 'LaterRequired', options: { defaultValue: 3 } },
    });
    const fieldId = fieldByName(created, 'LaterRequired').id;

    // Optional field: existing rows are still empty, so promoting it to
    // required must be refused.
    await expect(ctx.updateField({ tableId, fieldId, field: { notNull: true } })).rejects.toThrow(
      /required_existing_values|existing records contain empty values/i
    );
  });
});
