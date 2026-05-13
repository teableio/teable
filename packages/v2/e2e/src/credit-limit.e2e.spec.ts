/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  createTablesOkResponseSchema,
  duplicateRecordOkResponseSchema,
  duplicateTableOkResponseSchema,
  importCsvOkResponseSchema,
  importRecordsOkResponseSchema,
  pasteOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { registerV2ImportServices } from '@teable/v2-import';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createE2eTestContainer } from './shared/createE2eTestContainer';

/**
 * NOTE: This test cannot use the shared test context because it requires
 * a custom tableMaxRowLimit configuration.
 */
describe('v2 table row limit (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let testContainer: IV2NodeTestContainer;
  let baseId: string;

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateTable failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  const createTables = async (payload: Record<string, unknown>, expectedStatus = 201) => {
    const response = await fetch(`${baseUrl}/tables/createTables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.json().catch(async () => response.text());

    expect(response.status, JSON.stringify(rawBody)).toBe(expectedStatus);
    if (expectedStatus !== 201) return;

    const parsed = createTablesOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create tables: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.tables;
  };

  const duplicateTable = async (payload: Record<string, unknown>, expectedStatus = 201) => {
    const response = await fetch(`${baseUrl}/tables/duplicateTable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.json().catch(async () => response.text());

    expect(response.status, JSON.stringify(rawBody)).toBe(expectedStatus);
    if (expectedStatus !== 201) return;

    const parsed = duplicateTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to duplicate table: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  const createRecords = async (
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>,
    expectedStatus = 201
  ) => {
    const response = await fetch(`${baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, records }),
    });

    const rawBody = await response.json().catch(async () => response.text());

    expect(response.status, JSON.stringify(rawBody)).toBe(expectedStatus);
    if (expectedStatus !== 201) return;

    const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create records: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data;
  };

  const duplicateRecord = async (payload: Record<string, unknown>, expectedStatus = 201) => {
    const response = await fetch(`${baseUrl}/tables/duplicateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.json().catch(async () => response.text());

    expect(response.status, JSON.stringify(rawBody)).toBe(expectedStatus);
    if (expectedStatus !== 201) return;

    const parsed = duplicateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to duplicate record: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.record;
  };

  const paste = async (payload: Record<string, unknown>, expectedStatus = 200) => {
    const response = await fetch(`${baseUrl}/tables/paste`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.json().catch(async () => response.text());

    expect(response.status, JSON.stringify(rawBody)).toBe(expectedStatus);
    if (expectedStatus !== 200) return;

    const parsed = pasteOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to paste: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data;
  };

  const importCsv = async (payload: Record<string, unknown>, expectedStatus = 201) => {
    const response = await fetch(`${baseUrl}/tables/importCsv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.json().catch(async () => response.text());

    expect(response.status, JSON.stringify(rawBody)).toBe(expectedStatus);
    if (expectedStatus !== 201) return;

    const parsed = importCsvOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to import csv: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data;
  };

  const importRecords = async (payload: Record<string, unknown>, expectedStatus = 200) => {
    const response = await fetch(`${baseUrl}/tables/importRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.json().catch(async () => response.text());

    expect(response.status, JSON.stringify(rawBody)).toBe(expectedStatus);
    if (expectedStatus !== 200) return;

    const parsed = importRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to import records: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data;
  };

  beforeAll(async () => {
    testContainer = await createE2eTestContainer({ tableMaxRowLimit: 10 });
    baseId = testContainer.baseId.toString();
    registerV2ImportServices(testContainer.container);

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
    server?.close();
    await testContainer.dispose();
  });

  it('enforces the configured table row limit for createRecords', async () => {
    const table = await createTable({
      baseId,
      name: 'CreditLimit_Default',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    await createRecords(
      table.id,
      Array.from({ length: 10 }, () => ({ fields: {} }))
    );

    await createRecords(table.id, [{ fields: {} }], 400);
  });

  it('rejects createTable seed records when they exceed the row limit', async () => {
    await createTable({
      baseId,
      name: 'CreditLimit_CreateTableRecords',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      records: Array.from({ length: 11 }, () => ({ fields: {} })),
    }).then(
      () => {
        throw new Error('Expected createTable with seed records to fail');
      },
      (error: unknown) => {
        expect(String(error)).toContain('max row limit');
      }
    );
  });

  it('allows createTable seed records up to the row limit', async () => {
    const table = await createTable({
      baseId,
      name: 'CreditLimit_CreateTableRecordsAllowed',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      records: Array.from({ length: 10 }, () => ({ fields: {} })),
    });

    await createRecords(table.id, [{ fields: {} }], 400);
  });

  it('rejects createTables seed records when they exceed the row limit', async () => {
    await createTables(
      {
        baseId,
        tables: [
          {
            name: 'CreditLimit_CreateTablesRecords',
            fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
            records: Array.from({ length: 11 }, () => ({ fields: {} })),
          },
        ],
      },
      400
    );
  });

  it('allows createTables seed records up to the row limit', async () => {
    const tables = await createTables({
      baseId,
      tables: [
        {
          name: 'CreditLimit_CreateTablesRecordsAllowed',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          records: Array.from({ length: 10 }, () => ({ fields: {} })),
        },
      ],
    });

    const table = tables?.[0];
    if (!table) {
      throw new Error('Expected createTables to return a table');
    }
    await createRecords(table.id, [{ fields: {} }], 400);
  });

  it('applies the row limit to duplicateTable includeRecords output', async () => {
    const source = await createTable({
      baseId,
      name: 'CreditLimit_DuplicateTableSource',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    await createRecords(
      source.id,
      Array.from({ length: 10 }, () => ({ fields: {} }))
    );

    const copied = await duplicateTable({
      baseId,
      tableId: source.id,
      name: 'CreditLimit_DuplicateTableCopy',
      includeRecords: true,
    });

    if (!copied) {
      throw new Error('Expected duplicate table to succeed');
    }
    await createRecords(copied.id, [{ fields: {} }], 400);
  });

  it('applies the row limit to duplicateRecord output', async () => {
    const table = await createTable({
      baseId,
      name: 'CreditLimit_DuplicateRecord',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const created = await createRecords(
      table.id,
      Array.from({ length: 9 }, () => ({ fields: {} }))
    );
    const sourceRecordId = created?.records[0]?.id;
    if (!sourceRecordId) {
      throw new Error('Expected source record');
    }

    await duplicateRecord({ tableId: table.id, recordId: sourceRecordId });
    await duplicateRecord({ tableId: table.id, recordId: sourceRecordId }, 400);
  });

  it('allows paste when it reaches the row limit exactly', async () => {
    const table = await createTable({
      baseId,
      name: 'CreditLimit_PasteAllowed',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id;
    if (!primaryFieldId) {
      throw new Error('Expected primary field');
    }

    await createRecords(
      table.id,
      Array.from({ length: 9 }, () => ({ fields: {} }))
    );

    await paste({
      tableId: table.id,
      viewId: table.views[0].id,
      ranges: [
        [0, 9],
        [0, 9],
      ],
      content: [['Paste 10']],
    });

    await createRecords(table.id, [{ fields: {} }], 400);
  });

  it('rejects paste when it would create rows beyond the row limit', async () => {
    const table = await createTable({
      baseId,
      name: 'CreditLimit_Paste',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id;
    if (!primaryFieldId) {
      throw new Error('Expected primary field');
    }

    await createRecords(
      table.id,
      Array.from({ length: 9 }, () => ({ fields: {} }))
    );

    await paste(
      {
        tableId: table.id,
        viewId: table.views[0].id,
        ranges: [
          [0, 9],
          [0, 10],
        ],
        content: [['Paste 10'], ['Paste 11']],
        projection: [primaryFieldId],
      },
      400
    );
  });

  it('rejects importCsv table creation when it would exceed the row limit', async () => {
    const csvRows = Array.from({ length: 11 }, (_, index) => `Name ${index + 1}`).join('\n');

    await importCsv(
      {
        baseId,
        tableName: 'CreditLimit_ImportCsv',
        csvData: `Name\n${csvRows}`,
      },
      400
    );
  });

  it('allows chunked importCsv table creation up to the row limit', async () => {
    const csvRows = Array.from(
      { length: 10 },
      (_, index) => `Name ${index + 1},name-${index + 1}@example.com`
    ).join('\n');

    const result = await importCsv({
      baseId,
      tableName: 'CreditLimit_ImportCsvChunked',
      csvData: `Name,Email\n${csvRows}`,
      batchSize: 5,
    });

    expect(result?.totalImported).toBe(10);
  });

  it('allows importRecords append when it reaches the row limit exactly', async () => {
    const table = await createTable({
      baseId,
      name: 'CreditLimit_ImportRecordsAllowed',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Email' },
      ],
    });
    const nameFieldId = table.fields.find((field) => field.name === 'Name')?.id;
    const emailFieldId = table.fields.find((field) => field.name === 'Email')?.id;
    if (!nameFieldId || !emailFieldId) {
      throw new Error('Expected import fields');
    }

    await createRecords(
      table.id,
      Array.from({ length: 9 }, () => ({ fields: {} }))
    );

    await importRecords({
      tableId: table.id,
      fileType: 'csv',
      sourceColumnMap: {
        [nameFieldId]: 0,
        [emailFieldId]: 1,
      },
      csvData: 'Name,Email\nAlice,alice@example.com',
    });

    await createRecords(table.id, [{ fields: {} }], 400);
  });

  it('rejects importRecords append when it would exceed the row limit', async () => {
    const table = await createTable({
      baseId,
      name: 'CreditLimit_ImportRecords',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Email' },
      ],
    });
    const nameFieldId = table.fields.find((field) => field.name === 'Name')?.id;
    const emailFieldId = table.fields.find((field) => field.name === 'Email')?.id;
    if (!nameFieldId || !emailFieldId) {
      throw new Error('Expected import fields');
    }

    await createRecords(
      table.id,
      Array.from({ length: 9 }, () => ({ fields: {} }))
    );

    await importRecords(
      {
        tableId: table.id,
        fileType: 'csv',
        sourceColumnMap: {
          [nameFieldId]: 0,
          [emailFieldId]: 1,
        },
        csvData: 'Name,Email\nAlice,alice@example.com\nBob,bob@example.com',
      },
      400
    );
  });
});
