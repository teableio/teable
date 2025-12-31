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
  let foreignTableId: string;
  const nameFieldId = `fld${'a'.repeat(16)}`;
  const amountFieldId = `fld${'b'.repeat(16)}`;
  const notesFieldId = `fld${'c'.repeat(16)}`;
  const foreignNameFieldId = `fld${'d'.repeat(16)}`;
  const foreignStatusFieldId = `fld${'e'.repeat(16)}`;
  const linkFieldId = `fld${'f'.repeat(16)}`;
  const lookupFieldId = `fld${'g'.repeat(16)}`;

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

    const foreignPayload = {
      baseId,
      tableId: `tbl${'x'.repeat(16)}`,
      name: 'Foreign',
      fields: [
        { type: 'singleLineText', id: foreignNameFieldId, name: 'Title', isPrimary: true },
        { type: 'singleSelect', id: foreignStatusFieldId, name: 'Status', options: ['Todo'] },
      ],
    };

    const foreignResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(foreignPayload),
    });

    expect(foreignResponse.status).toBe(201);

    const foreignRaw = await foreignResponse.json();
    const foreignParsed = createTableOkResponseSchema.safeParse(foreignRaw);
    expect(foreignParsed.success).toBe(true);
    if (!foreignParsed.success) {
      throw new Error('Failed to parse create foreign table response');
    }

    foreignTableId = foreignParsed.data.data.table.id;

    const payload = {
      baseId,
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
    };

    const response = await fetch(`${baseUrl}/tables/create`, {
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
    const response = await fetch(`${baseUrl}/tables/get?baseId=${baseId}&tableId=${tableId}`, {
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
    expect(body.data.table.views.length).toBeGreaterThan(0);
    const view = body.data.table.views[0];
    const columnMeta = view?.columnMeta ?? {};
    expect(Object.keys(columnMeta).sort()).toEqual(
      [nameFieldId, amountFieldId, notesFieldId].sort()
    );
    expect(columnMeta[amountFieldId]?.order).toBe(0);
    expect(columnMeta[nameFieldId]?.order).toBe(1);
    expect(columnMeta[notesFieldId]?.order).toBe(2);
    expect(columnMeta[linkFieldId]?.order).toBe(3);
    expect(columnMeta[lookupFieldId]?.order).toBe(4);
    expect(columnMeta[amountFieldId]?.visible).toBeUndefined();
  });

  it('returns ok via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.getById({ baseId, tableId });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(tableId);
    expect(body.data.table.baseId).toBe(baseId);
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
