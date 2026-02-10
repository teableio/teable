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
});
