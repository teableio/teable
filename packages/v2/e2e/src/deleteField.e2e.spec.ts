/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createTableOkResponseSchema,
  deleteFieldOkResponseSchema,
  getTableByIdOkResponseSchema,
  type ITableDto,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http deleteField (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

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
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
    }

    const table = parsed.data.data.table;
    const primaryField = table.fields.find((field) => field.isPrimary);
    if (!primaryField) throw new Error('Missing primary field');

    return { tableId: table.id, primaryFieldId: primaryField.id };
  };

  const getTableById = async (tableId: string): Promise<ITableDto> => {
    const response = await fetch(`${baseUrl}/tables/get?baseId=${baseId}&tableId=${tableId}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const rawBody = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse get table response');
    }

    return parsed.data.data.table;
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
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('deletes a field and returns FieldDeleted events', async () => {
    const { tableId } = await createTable('Delete Field');
    const fieldId = createFieldId();

    const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId,
        field: {
          type: 'singleLineText',
          id: fieldId,
          name: 'Status',
        },
      }),
    });

    expect(createFieldResponse.status).toBe(200);
    const createFieldRaw = await createFieldResponse.json();
    const createFieldParsed = createFieldOkResponseSchema.safeParse(createFieldRaw);
    expect(createFieldParsed.success).toBe(true);
    if (!createFieldParsed.success || !createFieldParsed.data.ok) return;

    const deleteResponse = await fetch(`${baseUrl}/tables/deleteField`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId,
        fieldId,
      }),
    });

    expect(deleteResponse.status).toBe(200);
    const rawBody = await deleteResponse.json();
    const parsed = deleteFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    const body = parsed.data;
    expect(body.data.table.fields.some((field) => field.id === fieldId)).toBe(false);
    expect(body.data.events.some((event) => event.name === 'FieldDeleted')).toBe(true);

    const refreshed = await getTableById(tableId);
    expect(refreshed.fields.some((field) => field.id === fieldId)).toBe(false);
  });

  it('removes symmetric link fields when deleting links', async () => {
    const host = await createTable('Host');
    const foreign = await createTable('Foreign');
    const linkFieldId = createFieldId();

    const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId: host.tableId,
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreign.tableId,
            lookupFieldId: foreign.primaryFieldId,
          },
        },
      }),
    });

    expect(createFieldResponse.status).toBe(200);
    const createFieldRaw = await createFieldResponse.json();
    const createFieldParsed = createFieldOkResponseSchema.safeParse(createFieldRaw);
    expect(createFieldParsed.success).toBe(true);
    if (!createFieldParsed.success || !createFieldParsed.data.ok) return;

    const hostTable = createFieldParsed.data.data.table;
    const linkField = hostTable.fields.find((field) => field.id === linkFieldId);
    expect(linkField?.type).toBe('link');
    if (!linkField || linkField.type !== 'link') return;

    const symmetricFieldId = linkField.options.symmetricFieldId;
    expect(symmetricFieldId).toBeTruthy();
    if (!symmetricFieldId) return;

    const foreignBefore = await getTableById(foreign.tableId);
    expect(foreignBefore.fields.some((field) => field.id === symmetricFieldId)).toBe(true);

    const deleteResponse = await fetch(`${baseUrl}/tables/deleteField`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId: host.tableId,
        fieldId: linkFieldId,
      }),
    });

    expect(deleteResponse.status).toBe(200);
    const deleteRaw = await deleteResponse.json();
    const deleteParsed = deleteFieldOkResponseSchema.safeParse(deleteRaw);
    expect(deleteParsed.success).toBe(true);
    if (!deleteParsed.success || !deleteParsed.data.ok) return;

    const foreignAfter = await getTableById(foreign.tableId);
    expect(foreignAfter.fields.some((field) => field.id === symmetricFieldId)).toBe(false);
  });
});
