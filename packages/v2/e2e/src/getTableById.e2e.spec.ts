/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http getTableById (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let tableId: string;

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

    const payload = {
      baseId,
      name: 'Lookup',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    };

    const response = await fetch(`${baseUrl}/tables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('Failed to parse create table response');
    }

    tableId = parsed.data.data.table.id;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('returns 200 ok (fetch)', async () => {
    const response = await fetch(`${baseUrl}/tables?baseId=${baseId}&tableId=${tableId}`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(tableId);
    expect(body.data.table.baseId).toBe(baseId);
    expect(body.data.table.name).toBe('Lookup');
  });

  it('returns ok via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.getById({ baseId, tableId });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(tableId);
    expect(body.data.table.baseId).toBe(baseId);
  });
});
