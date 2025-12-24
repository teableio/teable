/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import { createTableOkResponseSchema, listTablesOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http listTables (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let fieldIdCounter = 0;

  const createTable = async (name: string) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name,
        fields: [{ type: 'singleLineText', name: 'Name' }],
      }),
    });

    expect(response.status).toBe(201);
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('Failed to parse create table response');
    }
  };

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createFormulaTable = async (name: string) => {
    const amountFieldId = createFieldId();
    const scoreFieldId = createFieldId();
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name,
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
      }),
    });

    expect(response.status).toBe(201);
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('Failed to parse create table response');
    }
  };

  beforeAll(async () => {
    const testContainer = await createV2NodeTestContainer();
    dispose = testContainer.dispose;
    baseId = testContainer.baseId.toString();

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    await createTable('Alpha');
    await createTable('Beta');
    await createTable('Gamma');
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('returns 200 ok with pagination (fetch)', async () => {
    const params = new URLSearchParams({
      baseId,
      sortBy: 'name',
      sortDirection: 'desc',
      limit: '2',
      offset: '1',
    });

    const response = await fetch(`${baseUrl}/tables/list?${params.toString()}`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = listTablesOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const names = body.data.tables.map((table) => table.name);
    expect(names).toEqual(['Beta', 'Alpha']);
  });

  it('returns ok via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.list({
      baseId,
      sortBy: 'name',
      sortDirection: 'asc',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const names = body.data.tables.map((table) => table.name);
    expect(names).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('filters tables by name query', async () => {
    const params = new URLSearchParams({
      baseId,
      q: 'Al',
      sortBy: 'name',
      sortDirection: 'asc',
    });

    const response = await fetch(`${baseUrl}/tables/list?${params.toString()}`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = listTablesOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const names = body.data.tables.map((table) => table.name);
    expect(names).toEqual(['Alpha']);
  });

  it('lists tables that include formula fields', async () => {
    await createFormulaTable('Formula List');

    const params = new URLSearchParams({
      baseId,
      sortBy: 'name',
      sortDirection: 'asc',
    });

    const response = await fetch(`${baseUrl}/tables/list?${params.toString()}`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = listTablesOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const table = body.data.tables.find((item) => item.name === 'Formula List');
    expect(table).toBeTruthy();
  });
});
