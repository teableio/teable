/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http createRecord (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let tableId: string;
  let textFieldId: string;
  let numberFieldId: string;
  let checkboxFieldId: string;

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
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

    // Create a test table for record operations
    const table = await createTable({
      baseId,
      name: 'Record Test Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'checkbox', name: 'Approved' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    const fields = table.fields;
    textFieldId = fields.find((f) => f.name === 'Title')?.id ?? '';
    numberFieldId = fields.find((f) => f.name === 'Amount')?.id ?? '';
    checkboxFieldId = fields.find((f) => f.name === 'Approved')?.id ?? '';
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('returns 201 ok when creating a record (fetch)', async () => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields: {
          [textFieldId]: 'Test Record',
          [numberFieldId]: 42,
          [checkboxFieldId]: true,
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.record.id).toMatch(/^rec/);
    expect(body.data.record.fields[textFieldId]).toBe('Test Record');
    expect(body.data.record.fields[numberFieldId]).toBe(42);
    expect(body.data.record.fields[checkboxFieldId]).toBe(true);
  });

  it('returns ok response via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.createRecord({
      tableId,
      fields: {
        [textFieldId]: 'Client Record',
        [numberFieldId]: 100,
      },
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.record.id).toMatch(/^rec/);
    expect(body.data.record.fields[textFieldId]).toBe('Client Record');
    expect(body.data.record.fields[numberFieldId]).toBe(100);
  });

  it('creates a record with empty fields', async () => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields: {},
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.record.id).toMatch(/^rec/);
  });

  it('creates multiple records with unique IDs', async () => {
    const recordIds: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          fields: { [textFieldId]: `Record ${i + 1}` },
        }),
      });
      expect(response.status).toBe(201);

      const rawBody = await response.json();
      const parsed = createRecordOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      recordIds.push(parsed.data.data.record.id);
    }

    // All record IDs should be unique
    expect(new Set(recordIds).size).toBe(3);
  });

  it('returns 404 when table not found', async () => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: `tbl${'x'.repeat(16)}`,
        fields: {},
      }),
    });

    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid input', async () => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // missing tableId
        fields: {},
      }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 when field validation fails', async () => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields: {
          [numberFieldId]: 'not a number',
        },
      }),
    });

    expect(response.status).toBe(400);
  });
});

describe('v2 http createRecord with link fields (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let foreignTableId: string;
  let mainTableId: string;
  let mainTextFieldId: string;
  let linkFieldId: string;
  let foreignRecordId: string;

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
    }
    return parsed.data.data.table;
  };

  const createRecord = async (tableIdParam: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create record response');
    }
    return parsed.data.data.record;
  };

  const listRecords = async (tableIdParam: string) => {
    const params = new URLSearchParams({ tableId: tableIdParam });
    const response = await fetch(`${baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse list records response');
    }
    return parsed.data.data.records;
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

    // Create a foreign table to link to
    const foreignTable = await createTable({
      baseId,
      name: 'Foreign Table',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Value' },
      ],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreignTable.id;
    const foreignTextFieldId = foreignTable.fields.find((f) => f.name === 'Name')?.id ?? '';

    // Create a record in the foreign table
    const foreignRecord = await createRecord(foreignTableId, {
      [foreignTextFieldId]: 'Foreign Record 1',
    });
    foreignRecordId = foreignRecord.id;

    // Create main table with link field
    const mainTable = await createTable({
      baseId,
      name: 'Main Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: foreignTextFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    mainTableId = mainTable.id;
    mainTextFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    linkFieldId = mainTable.fields.find((f) => f.name === 'Related')?.id ?? '';
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('creates a record with link field value and verifies with listRecords', async () => {
    // Create a record with link field
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        fields: {
          [mainTextFieldId]: 'Main Record With Link',
          [linkFieldId]: [{ id: foreignRecordId, title: 'Foreign Record 1' }],
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const createdRecordId = body.data.record.id;
    expect(createdRecordId).toMatch(/^rec/);

    // Verify with listRecords that link field is correctly saved and retrieved
    const records = await listRecords(mainTableId);
    const foundRecord = records.find((r) => r.id === createdRecordId);

    expect(foundRecord).toBeDefined();
    if (!foundRecord) return;

    expect(foundRecord.fields[mainTextFieldId]).toBe('Main Record With Link');

    // Verify link field value is correctly stored and returned
    const linkValue = foundRecord.fields[linkFieldId] as unknown;
    expect(linkValue).toBeDefined();
    expect(Array.isArray(linkValue)).toBe(true);

    const linkArray = linkValue as Array<{ id: string; title?: string }>;
    expect(linkArray.length).toBeGreaterThanOrEqual(1);
    expect(linkArray.some((link) => link.id === foreignRecordId)).toBe(true);
  });

  it('creates a record with empty link field', async () => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        fields: {
          [mainTextFieldId]: 'Main Record No Link',
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
  });

  it('creates a record with null link field', async () => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        fields: {
          [mainTextFieldId]: 'Main Record Null Link',
          [linkFieldId]: null,
        },
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
  });

  it('returns error when linking to non-existent record (FK constraint enforced)', async () => {
    const nonExistentRecordId = `rec${'x'.repeat(16)}`;
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTableId,
        fields: {
          [mainTextFieldId]: 'Main Record Invalid Link',
          [linkFieldId]: [{ id: nonExistentRecordId, title: 'Non-existent' }],
        },
      }),
    });

    // FK constraint on junction table prevents inserting non-existent record IDs
    // The database returns a foreign key violation error
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.ok).toBe(false);
    // The error message should indicate a foreign key constraint violation
    expect(body.error.message).toContain('Failed to insert record');
  });
});
