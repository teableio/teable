/* eslint-disable @typescript-eslint/naming-convention */
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http listTables (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Alpha',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Beta',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Gamma',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
  });

  it('returns 200 ok with pagination (fetch)', async () => {
    const tables = await ctx.listTables({
      baseId: ctx.baseId,
      sortBy: 'name',
      sortDirection: 'desc',
      limit: 2,
      offset: 1,
    });

    const names = tables.map((table) => table.name);
    expect(names).toEqual(['Beta', 'Alpha']);
  });

  it('returns ok via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.list({
      baseId: ctx.baseId,
      sortBy: 'name',
      sortDirection: 'asc',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const names = body.data.tables.map((table) => table.name);
    expect(names).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('filters tables by name query', async () => {
    const tables = await ctx.listTables({
      baseId: ctx.baseId,
      q: 'Al',
      sortBy: 'name',
      sortDirection: 'asc',
    });

    const names = tables.map((table) => table.name);
    expect(names).toEqual(['Alpha']);
  });

  it('lists tables that include formula fields', async () => {
    const amountFieldId = createFieldId();
    const scoreFieldId = createFieldId();
    await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Formula List',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        {
          type: 'formula',
          id: scoreFieldId,
          name: 'Score',
          options: { expression: `{${amountFieldId}} * 2` },
        },
      ],
    });

    const tables = await ctx.listTables({
      baseId: ctx.baseId,
      sortBy: 'name',
      sortDirection: 'asc',
    });

    const table = tables.find((item) => item.name === 'Formula List');
    expect(table).toBeTruthy();
  });
});
