/**
 * D18 — the creation-entry matrix.
 *
 * D18 (待定口径): the requirement document asks for a per-entry decision on
 * whether the default value is applied. The table below characterises v2 for
 * every entry point the backend can reach.
 *
 * | entry point                     | default applied |
 * | ------------------------------- | --------------- |
 * | createRecord (single)           | yes, when key omitted |
 * | createRecords (batch)           | yes, when key omitted |
 * | paste (new rows)                | yes |
 * | importRecords                   | yes |
 * | updateRecord / updateRecords    | no |
 * | duplicateRecord                 | no, stored values are copied |
 *
 * Two entries share the same `now` value on a batch create: the batch is
 * stamped once, which is the "批量创建时间口径" item the document leaves open.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  findRow,
  firstGridId,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('D18: creation-entry default matrix', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let viewId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'D18 Entry Matrix',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text', options: { defaultValue: 'D' } },
        { type: 'number', name: 'Number', options: { defaultValue: 42 } },
        { type: 'date', name: 'Date', options: { defaultValue: 'now' } },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    viewId = firstGridId(table);
    for (const field of table.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('D18 createRecord applies the default when the key is omitted', async () => {
    const record = await ctx.createRecord(tableId, {});
    await expect(readValue(ctx, tableId, record.id, ids.Text)).resolves.toBe('D');
    await expect(readValue(ctx, tableId, record.id, ids.Number)).resolves.toBe(42);
  });

  test('D18 createRecords applies the default per record in the batch', async () => {
    const records = await ctx.createRecords(tableId, [
      { fields: {} },
      { fields: { [ids.Number]: 0 } },
      { fields: { [ids.Text]: 'explicit' } },
    ]);

    await expect(readValue(ctx, tableId, records[0].id, ids.Text)).resolves.toBe('D');
    await expect(readValue(ctx, tableId, records[0].id, ids.Number)).resolves.toBe(42);
    await expect(readValue(ctx, tableId, records[1].id, ids.Number)).resolves.toBe(0);
    await expect(readValue(ctx, tableId, records[1].id, ids.Text)).resolves.toBe('D');
    await expect(readValue(ctx, tableId, records[2].id, ids.Text)).resolves.toBe('explicit');
  });

  test('D18 a batch stamps one `now` value shared by every record in it', async () => {
    const records = await ctx.createRecords(tableId, [
      { fields: {} },
      { fields: {} },
      { fields: {} },
    ]);
    const instants = await Promise.all(
      records.map((record) => readValue(ctx, tableId, record.id, ids.Date))
    );
    expect(new Set(instants).size).toBe(1);
  });

  test('D18 paste into new rows applies the default', async () => {
    const before = (await ctx.listRecords(tableId, { limit: 1000 })).length;

    const result = await ctx.paste({
      tableId,
      viewId,
      ranges: [
        [0, before],
        [0, before],
      ],
      content: [['pasted via D18']],
    });
    expect(result.createdCount).toBe(1);

    const createdId = result.createdRecordIds?.[0];
    expect(createdId).toBeTruthy();
    await expect(readValue(ctx, tableId, createdId as string, ids.Text)).resolves.toBe('D');
    await expect(readValue(ctx, tableId, createdId as string, ids.Number)).resolves.toBe(42);
  });

  test('D18 importRecords applies the default to unmapped columns', async () => {
    await ctx.importRecords({
      tableId,
      fileType: 'csv',
      sourceColumnMap: { [ids.Title]: 0 },
      csvData: 'title\nimported-d18-row',
    });

    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    const imported = rows.filter((row) => row.fields[ids.Title] === 'imported-d18-row');
    expect(imported).toHaveLength(1);
    expect(imported[0].fields[ids.Text]).toBe('D');
    expect(imported[0].fields[ids.Number]).toBe(42);
  });

  test('D18 updateRecord and updateRecords never apply the default', async () => {
    const record = await ctx.createRecord(tableId, {});
    await ctx.updateRecord(tableId, record.id, { [ids.Text]: null });
    await expect(readValue(ctx, tableId, record.id, ids.Text)).resolves.toBeNull();

    await ctx.updateRecords({
      tableId,
      records: [{ id: record.id, fields: { [ids.Number]: null } }],
    });
    await expect(readValue(ctx, tableId, record.id, ids.Number)).resolves.toBeNull();
  });

  test('D18 duplicateRecord copies stored values instead of re-running defaults', async () => {
    const source = await ctx.createRecord(tableId, { [ids.Number]: 11 });
    const duplicate = await ctx.duplicateRecord(tableId, source.id);

    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    const duplicatedRow = findRow(rows, duplicate.id);
    expect(duplicatedRow?.fields[ids.Number]).toBe(11);
    expect(duplicatedRow?.fields[ids.Text]).toBe('D');
  });

  test('D18 a required field without a default blocks a create that omits it', async () => {
    const table = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleLineText',
        name: 'RequiredNoDefault',
        notNull: true,
        // Give it a default transiently so the column can be added to a
        // non-empty table, then clear the default.
        options: { defaultValue: 'placeholder' },
      },
    });
    await ctx.updateField({
      tableId,
      fieldId: fieldByName(table, 'RequiredNoDefault').id,
      field: { notNull: false, options: { defaultValue: null } },
    });
    const requiredTable = await ctx.updateField({
      tableId,
      fieldId: fieldByName(table, 'RequiredNoDefault').id,
      field: { notNull: true },
    });
    const requiredId = fieldByName(requiredTable, 'RequiredNoDefault').id;

    await expect(ctx.createRecord(tableId, {})).rejects.toThrow(/not_null|not-null|violates/i);

    // Providing the value explicitly satisfies the constraint.
    const record = await ctx.createRecord(tableId, { [requiredId]: 'provided' });
    await expect(readValue(ctx, tableId, record.id, requiredId)).resolves.toBe('provided');
  });
});
