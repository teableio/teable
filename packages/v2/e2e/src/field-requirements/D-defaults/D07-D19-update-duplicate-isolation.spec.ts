/**
 * D02 / D07 / D19 — the default value is a create-time fill only.
 *
 * D02 (建议需求): editing unrelated field configuration must not wipe or
 * resurrect the configured default.
 * D07 (待定口径): the requirement document asks whether clearing an existing
 * record re-applies the default. v2 answer: no — updates never fill defaults.
 * D19 (待定口径): duplicating a record copies the stored value; it does not
 * re-evaluate dynamic defaults such as the date `now`.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('D02/D07/D19: updates and duplicates never re-apply defaults', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'D07 Update Semantics',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text', options: { defaultValue: 'DEFAULT' } },
        { type: 'number', name: 'Number', options: { defaultValue: 42 } },
        {
          type: 'singleSelect',
          name: 'Select',
          options: { choices: [{ name: 'A' }, { name: 'B' }], defaultValue: 'A' },
        },
        { type: 'date', name: 'Date', options: { defaultValue: 'now' } },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    for (const field of table.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('D07 clearing a value on an existing record persists as empty', async () => {
    const record = await ctx.createRecord(tableId, {});
    // Sanity: the create filled the defaults.
    await expect(readValue(ctx, tableId, record.id, ids.Text)).resolves.toBe('DEFAULT');
    await expect(readValue(ctx, tableId, record.id, ids.Number)).resolves.toBe(42);

    await ctx.updateRecord(tableId, record.id, {
      [ids.Text]: null,
      [ids.Number]: null,
      [ids.Select]: null,
    });

    await expect(readValue(ctx, tableId, record.id, ids.Text)).resolves.toBeNull();
    await expect(readValue(ctx, tableId, record.id, ids.Number)).resolves.toBeNull();
    await expect(readValue(ctx, tableId, record.id, ids.Select)).resolves.toBeNull();
  });

  test('D07 a batch update leaves untouched fields alone and clears explicit ones', async () => {
    const target = await ctx.createRecord(tableId, {});
    const untouched = await ctx.createRecord(tableId, {});

    await ctx.updateRecords({
      tableId,
      records: [
        { id: target.id, fields: { [ids.Text]: null, [ids.Number]: null } },
        // A record with no field payload at all keeps everything.
        { id: untouched.id, fields: {} },
      ],
    });

    await expect(readValue(ctx, tableId, target.id, ids.Text)).resolves.toBeNull();
    await expect(readValue(ctx, tableId, target.id, ids.Number)).resolves.toBeNull();
    await expect(readValue(ctx, tableId, untouched.id, ids.Text)).resolves.toBe('DEFAULT');
    await expect(readValue(ctx, tableId, untouched.id, ids.Number)).resolves.toBe(42);
  });

  test('D19 duplicating a record copies the stored value instead of re-evaluating the default', async () => {
    const source = await ctx.createRecord(tableId, {});
    await new Promise((resolve) => setTimeout(resolve, 25));

    const duplicate = await ctx.duplicateRecord(tableId, source.id);

    const sourceDate = await readValue(ctx, tableId, source.id, ids.Date);
    const duplicateDate = await readValue(ctx, tableId, duplicate.id, ids.Date);

    // The duplicate carries the source instant; a fresh `now` default would be
    // strictly later than the source record.
    expect(duplicateDate).toBe(sourceDate);
    expect(new Date(duplicateDate as string).getTime()).toBeLessThan(Date.now());
  });

  test('D19 duplicating a record carries statically configured defaults through', async () => {
    const source = await ctx.createRecord(tableId, { [ids.Number]: 7 });
    const duplicate = await ctx.duplicateRecord(tableId, source.id);

    await expect(readValue(ctx, tableId, duplicate.id, ids.Number)).resolves.toBe(7);
    await expect(readValue(ctx, tableId, duplicate.id, ids.Text)).resolves.toBe('DEFAULT');
  });

  test('D02 renaming a field and changing its style keeps the default value', async () => {
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', name: 'Amount', options: { defaultValue: 12.5 } },
    });
    const fieldId = fieldByName(created, 'Amount').id;

    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        name: 'Amount renamed',
        description: 'renamed',
        options: { formatting: { type: 'currency', precision: 2, symbol: 'USD' } },
      },
    });

    const field = updated.fields.find((candidate) => candidate.id === fieldId);
    expect(field?.name).toBe('Amount renamed');
    expect(fieldOptions(field).defaultValue).toBe(12.5);

    // Re-read through the read API so the assertion is not just echo of the
    // update response.
    const reloaded = await ctx.getTableById(tableId);
    const reloadedField = reloaded.fields.find((candidate) => candidate.id === fieldId);
    expect(fieldOptions(reloadedField).defaultValue).toBe(12.5);

    const record = await ctx.createRecord(tableId, {});
    expect(findRow(await ctx.listRecords(tableId), record.id)?.fields[fieldId]).toBe(12.5);
  });
});
