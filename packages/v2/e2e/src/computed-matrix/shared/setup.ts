/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Test setup and API helpers for computed matrix tests
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  deleteRecordsOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import type { TestContext } from './types';

// =============================================================================
// Test Context Factory
// =============================================================================

export const createTestContext = async (): Promise<TestContext> => {
  const testContainer = await createV2NodeTestContainer();
  const baseId = testContainer.baseId.toString();

  const app = express();
  app.use(
    createV2ExpressRouter({
      createContainer: () => testContainer.container,
    })
  );

  const server: Server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // API Helpers
  const createTable = async (payload: unknown) => {
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

  const createField = async (payload: unknown) => {
    const response = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create field: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createFieldOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create field response');
    }
    return parsed.data.data.table;
  };

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fields }),
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

  const updateRecord = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse update record response');
    }
    return parsed.data.data.record;
  };

  const deleteRecord = async (tableId: string, recordId: string) => {
    const response = await fetch(`${baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordIds: [recordId] }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = deleteRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse delete record response');
    }
  };

  const drainOutbox = async (maxRounds = 10) => {
    for (let i = 0; i < maxRounds; i += 1) {
      const drained = await testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listRecords = async (tableId: string) => {
    await drainOutbox();
    const params = new URLSearchParams({ tableId });
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

  const getTableById = async (tableId: string) => {
    const params = new URLSearchParams({ baseId, tableId });
    const response = await fetch(`${baseUrl}/tables/get?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse get table response');
    }
    return parsed.data.data.table;
  };

  const dispose = async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await testContainer.dispose();
  };

  return {
    testContainer,
    baseId,
    baseUrl,
    dispose,
    createTable,
    createField,
    createRecord,
    updateRecord,
    deleteRecord,
    listRecords,
    getTableById,
    drainOutbox,
    clearLogs: () => testContainer.clearLogs(),
    getLastComputedPlan: () => testContainer.getLastComputedPlan(),
  };
};
