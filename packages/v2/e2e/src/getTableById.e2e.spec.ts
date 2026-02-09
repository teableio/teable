/* eslint-disable @typescript-eslint/naming-convention */
import { getTableByIdOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http getTableById (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let foreignTableId: string;
  const nameFieldId = `fld${'a'.repeat(16)}`;
  const amountFieldId = `fld${'b'.repeat(16)}`;
  const notesFieldId = `fld${'c'.repeat(16)}`;
  const foreignNameFieldId = `fld${'d'.repeat(16)}`;
  const foreignStatusFieldId = `fld${'e'.repeat(16)}`;
  const linkFieldId = `fld${'f'.repeat(16)}`;
  const lookupFieldId = `fld${'g'.repeat(16)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      tableId: `tbl${'x'.repeat(16)}`,
      name: 'Foreign',
      fields: [
        { type: 'singleLineText', id: foreignNameFieldId, name: 'Title', isPrimary: true },
        { type: 'singleSelect', id: foreignStatusFieldId, name: 'Status', options: ['Todo'] },
      ],
    });

    foreignTableId = foreignTable.id;

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Lookup',
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name' },
        {
          type: 'number',
          id: amountFieldId,
          name: 'Amount',
          isPrimary: true,
          notNull: true,
          unique: true,
        },
        { type: 'longText', id: notesFieldId, name: 'Notes' },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Link',
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: foreignNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Lookup',
          options: {
            linkFieldId,
            foreignTableId,
            lookupFieldId: foreignStatusFieldId,
          },
        },
      ],
    });

    tableId = table.id;
  });

  it('returns 200 ok (fetch)', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${tableId}`,
      {
        method: 'GET',
      }
    );

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(tableId);
    expect(body.data.table.baseId).toBe(ctx.baseId);
    expect(body.data.table.name).toBe('Lookup');
    expect(body.data.table.views.length).toBeGreaterThan(0);
    const view = body.data.table.views[0];
    const columnMeta = view?.columnMeta ?? {};
    expect(Object.keys(columnMeta).sort()).toEqual(
      [nameFieldId, amountFieldId, notesFieldId, linkFieldId, lookupFieldId].sort()
    );
    expect(columnMeta[amountFieldId]?.order).toBe(0);
    expect(columnMeta[nameFieldId]?.order).toBe(1);
    expect(columnMeta[notesFieldId]?.order).toBe(2);
    expect(columnMeta[linkFieldId]?.order).toBe(3);
    expect(columnMeta[lookupFieldId]?.order).toBe(4);
    expect(columnMeta[amountFieldId]?.visible).toBeUndefined();
  });

  it('returns ok via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.getById({ baseId: ctx.baseId, tableId });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(tableId);
    expect(body.data.table.baseId).toBe(ctx.baseId);
    const lookupField = body.data.table.fields.find((field) => field.id === lookupFieldId);
    expect(lookupField?.isLookup).toBe(true);
    expect(lookupField?.lookupOptions?.linkFieldId).toBe(linkFieldId);
    expect(lookupField?.lookupOptions?.foreignTableId).toBe(foreignTableId);
    expect(lookupField?.lookupOptions?.lookupFieldId).toBe(foreignStatusFieldId);
    expect(lookupField?.dbFieldName).toBeDefined();

    const amountField = body.data.table.fields.find((field) => field.id === amountFieldId);
    expect(amountField?.notNull).toBe(true);
    expect(amountField?.unique).toBe(true);
    expect(amountField?.dbFieldName).toBeDefined();
  });
});
