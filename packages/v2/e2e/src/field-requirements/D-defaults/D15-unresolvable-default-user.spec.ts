/**
 * D15 — a default user that cannot be resolved.
 *
 * D15 (待定口径): the requirement document asks whether a default user that is
 * deactivated, deleted or unauthorized should reject, skip or be preserved, and
 * whether notifications must not double-fire. v2 answer: the configuration is
 * accepted and preserved on the field, and record creation silently leaves the
 * cell empty — no rejection, no partial write, and no notification path is
 * entered for a user that does not resolve.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('D15: unresolvable default user', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  const ids: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'D15 User Defaults',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'user', name: 'Known', options: { defaultValue: 'usrTestUserId' } },
        { type: 'user', name: 'Missing', options: { defaultValue: 'usrDoesNotExist' } },
        {
          type: 'user',
          name: 'MissingMulti',
          options: { isMultiple: true, defaultValue: ['usrDoesNotExist'] },
        },
        {
          type: 'user',
          name: 'MixedMulti',
          options: {
            isMultiple: true,
            defaultValue: ['usrDoesNotExist', 'usrTestUserId'],
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    for (const field of table.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  it('keeps the unresolvable configuration on the field', async () => {
    const table = await ctx.getTableById(tableId);
    expect(fieldOptions(fieldByName(table, 'Missing')).defaultValue).toBe('usrDoesNotExist');
  });

  it('creates the record with an empty cell instead of failing', async () => {
    const record = await ctx.createRecord(tableId, {});
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    expect(findRow(rows, record.id)?.fields[ids.Missing] ?? null).toBeNull();
  });

  it('still resolves the usable default on the same record', async () => {
    const record = await ctx.createRecord(tableId, {});
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    expect(findRow(rows, record.id)?.fields[ids.Known]).toMatchObject({ id: 'usrTestUserId' });
  });

  it('drops only the unresolvable entry of a multi-user default', async () => {
    const record = await ctx.createRecord(tableId, {});
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    const row = findRow(rows, record.id);

    // Every entry is unresolvable, so the default contributes nothing — but a
    // multi-user field reports the empty list rather than a cleared cell.
    expect(row?.fields[ids.MissingMulti] ?? null).toEqual([]);
    const mixed = row?.fields[ids.MixedMulti];
    expect(Array.isArray(mixed)).toBe(true);
    expect((mixed as Array<{ id: string }>).map((user) => user.id)).toEqual(['usrTestUserId']);
  });

  it('accepts an unresolvable default on a newly created field too', async () => {
    seq += 1;
    const name = `LateMissing-${seq}`;
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'user', name, options: { defaultValue: 'usrAlsoMissing' } },
    });
    const fieldId = fieldByName(created, name).id;
    expect(fieldOptions(fieldByName(created, name)).defaultValue).toBe('usrAlsoMissing');

    const record = await ctx.createRecord(tableId, {});
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    expect(findRow(rows, record.id)?.fields[fieldId] ?? null).toBeNull();
  });
});
