/* eslint-disable @typescript-eslint/naming-convention */
import { deleteTableOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http deleteTable (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let secondTableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Delete Me',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    tableId = table1.id;

    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Delete Me Too',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    secondTableId = table2.id;
  });

  it('returns 200 ok and hides deleted tables (fetch)', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = deleteTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(tableId);
    expect(body.data.events.some((event) => event.name === 'TableDeleted')).toBe(true);

    const getResponse = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${tableId}`
    );
    expect(getResponse.status).toBe(404);
  });

  it('returns ok via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.delete({ baseId: ctx.baseId, tableId: secondTableId });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(secondTableId);
    expect(body.data.events.some((event) => event.name === 'TableDeleted')).toBe(true);
  });
});
