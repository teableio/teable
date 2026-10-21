/* eslint-disable @typescript-eslint/naming-convention */
import { renameTableOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http renameTable (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let secondTableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rename Me',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    tableId = table1.id;

    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rename Me Too',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    secondTableId = table2.id;
  });

  it('returns 200 ok and updates table name (fetch)', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
        name: 'Renamed Table',
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = renameTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(tableId);
    expect(body.data.table.name).toBe('Renamed Table');
    expect(body.data.events.some((event) => event.name === 'TableRenamed')).toBe(true);
  });

  it('returns ok via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.rename({
      baseId: ctx.baseId,
      tableId: secondTableId,
      name: 'Renamed',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(secondTableId);
    expect(body.data.table.name).toBe('Renamed');
    expect(body.data.events.some((event) => event.name === 'TableRenamed')).toBe(true);
  });

  it('[V1 PARITY][table.e2e-spec.ts] rename persists across getTableById and listTables', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Simple Props Table',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });

    await ctx.renameTable(table.id, 'newTableName');

    const fetched = await ctx.getTableById(table.id);
    expect(fetched.name).toBe('newTableName');

    const listed = await ctx.listTables();
    expect(listed.find((listedTable) => listedTable.id === table.id)?.name).toBe('newTableName');
  });

  it('[V1 PARITY][table.e2e-spec.ts] updates and clears table description and icon', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Table Properties',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });

    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    const updated = await client.tables.updateProperties({
      baseId: ctx.baseId,
      tableId: table.id,
      description: 'A useful table description',
      icon: '📊',
    });
    expect(updated).toMatchObject({
      ok: true,
      data: {
        table: {
          id: table.id,
          description: 'A useful table description',
          icon: '📊',
        },
      },
    });
    expect(updated.data?.events.some((event) => event.name === 'TablePropertiesUpdated')).toBe(
      true
    );

    const fetched = await ctx.getTableById(table.id);
    expect(fetched).toMatchObject({
      description: 'A useful table description',
      icon: '📊',
    });
    await expect(ctx.listTables()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: table.id,
          description: 'A useful table description',
          icon: '📊',
        }),
      ])
    );

    const partiallyUpdated = await client.tables.updateProperties({
      baseId: ctx.baseId,
      tableId: table.id,
      description: 'A revised description',
    });
    expect(partiallyUpdated).toMatchObject({
      ok: true,
      data: {
        table: {
          description: 'A revised description',
          icon: '📊',
        },
      },
    });

    const cleared = await client.tables.updateProperties({
      baseId: ctx.baseId,
      tableId: table.id,
      description: null,
      icon: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.data?.table).not.toHaveProperty('description');
    expect(cleared.data?.table).not.toHaveProperty('icon');
    expect(await ctx.getTableById(table.id)).not.toMatchObject({
      description: expect.anything(),
      icon: expect.anything(),
    });
  });

  it('[V2 CONTRACT] rejects missing properties and invalid table icons', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Invalid Table Properties',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });

    const request = async (body: Record<string, unknown>) => {
      const response = await fetch(`${ctx.baseUrl}/tables/updateProperties`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseId: ctx.baseId, tableId: table.id, ...body }),
      });
      return { status: response.status, body: await response.json() };
    };

    expect(await request({})).toMatchObject({ status: 400, body: { ok: false } });
    expect(await request({ icon: 'not-an-emoji' })).toMatchObject({
      status: 400,
      body: { ok: false },
    });
  });
});
