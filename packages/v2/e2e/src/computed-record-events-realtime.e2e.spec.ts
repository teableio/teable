/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ShareDbBackendPublisher,
  ShareDbWebSocketServer,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';
import { type IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { NoopLogger } from '@teable/v2-core';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import express from 'express';
import ShareDb from 'sharedb';
import type { Doc } from 'sharedb/lib/client';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createE2eTestContainer } from './shared/createE2eTestContainer';

type ShareDbRuntime = {
  backend: ShareDb;
  wsServer: WebSocketServer;
  port: number;
};

type RecordSnapshot = {
  id: string;
  fields: Record<string, unknown>;
};

type DomainEventLike = {
  name?: { toString(): string };
  tableId?: { toString(): string };
  updates?: Array<{
    changes?: Array<{ fieldId?: string }>;
  }>;
  source?: string;
};

type ComputedCaseContext = {
  hostTableId: string;
  hostRecordId: string;
  computedFieldId: string;
  initialValue: unknown;
  expectedValue: unknown;
  trigger: () => Promise<void>;
};

type ComputedCase = {
  label: string;
  setup: () => Promise<ComputedCaseContext>;
};

const logger = new NoopLogger();
let fieldIdCounter = 0;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getEventName = (event: unknown): string | undefined => {
  if (!isObjectRecord(event)) return undefined;
  const name = event['name'];
  if (!isObjectRecord(name) || typeof name.toString !== 'function') {
    return undefined;
  }
  return name.toString();
};

const getEventTableId = (event: unknown): string | undefined => {
  if (!isObjectRecord(event)) return undefined;
  const tableId = event['tableId'];
  if (!isObjectRecord(tableId) || typeof tableId.toString !== 'function') {
    return undefined;
  }
  return tableId.toString();
};

const getChangedFieldIds = (event: DomainEventLike): string[] => {
  if (!Array.isArray(event.updates)) {
    return [];
  }

  return event.updates.flatMap((update) =>
    Array.isArray(update.changes)
      ? update.changes.flatMap((change) =>
          typeof change.fieldId === 'string' ? [change.fieldId] : []
        )
      : []
  );
};

const startShareDbRuntime = async (): Promise<ShareDbRuntime> => {
  const backend = new ShareDb();
  const wsServer = new WebSocketServer({ port: 0, host: '127.0.0.1', path: '/socket' });
  const shareDbWebSocket = new ShareDbWebSocketServer(backend, logger);
  shareDbWebSocket.attach(wsServer);

  const port = await new Promise<number>((resolve, reject) => {
    wsServer.once('listening', () => {
      const address = wsServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve ShareDB server port'));
        return;
      }
      resolve(address.port);
    });
    wsServer.once('error', (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });

  return { backend, wsServer, port };
};

const stopShareDbRuntime = async (runtime: ShareDbRuntime | undefined): Promise<void> => {
  if (!runtime) return;
  await new Promise<void>((resolve) => runtime.wsServer.close(() => resolve()));
};

const fetchShareDbDoc = async <T>(params: {
  url: string;
  collection: string;
  docId: string;
  timeoutMs?: number;
}): Promise<T> => {
  const { url, collection, docId, timeoutMs = 5000 } = params;
  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(url);
    const connection = new Connection(socket as Socket);
    const doc = connection.get(collection, docId) as Doc<T>;
    let settled = false;

    const cleanup = () => {
      connection.removeListener('error', onError);
      socket.removeListener('error', onError);
      doc.removeListener('error', onError);
      doc.destroy();
      try {
        connection.close();
      } catch {
        socket.close();
      }
    };

    const onError = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const timeout = setTimeout(() => {
      onError(new Error('ShareDB doc subscribe timed out'));
    }, timeoutMs);

    connection.on('error', onError);
    socket.on('error', onError);
    doc.on('error', onError);

    doc.subscribe((error) => {
      if (settled) return;
      if (error) {
        onError(error);
        return;
      }
      if (doc.data == null) {
        onError(new Error('ShareDB doc has no data'));
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const snapshot = doc.data as T;
      cleanup();
      resolve(snapshot);
    });
  });
};

const drainOutbox = async (testContainer: IV2NodeTestContainer, rounds = 6): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    const processed = await testContainer.processOutbox();
    if (processed === 0) {
      return;
    }
  }
};

describe('v2 computed record events and realtime projection (e2e)', () => {
  let server: Server | undefined;
  let shareDbRuntime: ShareDbRuntime | undefined;
  let shareDbUrl: string;
  let baseUrl: string;
  let testContainer: IV2NodeTestContainer;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;

  const registerRealtime = (container: DependencyContainer, runtime: ShareDbRuntime): void => {
    registerV2ShareDbRealtime(container, {
      publisher: new ShareDbBackendPublisher(runtime.backend, logger),
    });
  };

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Failed to create table: ${await response.text()}`);
    }

    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
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
      throw new Error(`Failed to create record: ${await response.text()}`);
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
      throw new Error(`Failed to update record: ${await response.text()}`);
    }

    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse update record response');
    }
    return parsed.data.data.record;
  };

  const listRecords = async (tableId: string) => {
    const response = await fetch(`${baseUrl}/tables/listRecords?tableId=${tableId}`);
    if (!response.ok) {
      throw new Error(`Failed to list records: ${await response.text()}`);
    }

    const rawBody = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse list records response');
    }
    return parsed.data.data.records;
  };

  const getRecordSnapshot = async (tableId: string, recordId: string): Promise<RecordSnapshot> => {
    return fetchShareDbDoc<RecordSnapshot>({
      url: shareDbUrl,
      collection: `rec_${tableId}`,
      docId: recordId,
    });
  };

  const cases: ComputedCase[] = [
    {
      label: 'formula',
      setup: async () => {
        const primaryFieldId = createFieldId();
        const sourceFieldId = createFieldId();
        const formulaFieldId = createFieldId();
        const table = await createTable({
          baseId,
          name: `Computed Event Formula ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: primaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: sourceFieldId, name: 'Amount' },
            {
              type: 'formula',
              id: formulaFieldId,
              name: 'Formula Value',
              options: { expression: `{${sourceFieldId}} + 1` },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const record = await createRecord(table.id, {
          [primaryFieldId]: 'Row 1',
          [sourceFieldId]: 1,
        });
        await drainOutbox(testContainer);

        return {
          hostTableId: table.id,
          hostRecordId: record.id,
          computedFieldId: formulaFieldId,
          initialValue: 2,
          expectedValue: 6,
          trigger: async () => {
            await updateRecord(table.id, record.id, { [sourceFieldId]: 5 });
          },
        };
      },
    },
    {
      label: 'lookup',
      setup: async () => {
        const foreignPrimaryFieldId = createFieldId();
        const foreignValueFieldId = createFieldId();
        const foreignTable = await createTable({
          baseId,
          name: `Computed Event Lookup Foreign ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: foreignValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const hostPrimaryFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const hostTable = await createTable({
          baseId,
          name: `Computed Event Lookup Host ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignPrimaryFieldId,
                isOneWay: true,
              },
            },
            {
              type: 'lookup',
              id: lookupFieldId,
              name: 'Lookup Value',
              options: {
                linkFieldId,
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const foreignRecord = await createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Source 1',
          [foreignValueFieldId]: 1,
        });
        const hostRecord = await createRecord(hostTable.id, {
          [hostPrimaryFieldId]: 'Host 1',
          [linkFieldId]: { id: foreignRecord.id },
        });
        await drainOutbox(testContainer);

        return {
          hostTableId: hostTable.id,
          hostRecordId: hostRecord.id,
          computedFieldId: lookupFieldId,
          initialValue: [1],
          expectedValue: [9],
          trigger: async () => {
            await updateRecord(foreignTable.id, foreignRecord.id, { [foreignValueFieldId]: 9 });
          },
        };
      },
    },
    {
      label: 'rollup',
      setup: async () => {
        const foreignPrimaryFieldId = createFieldId();
        const foreignValueFieldId = createFieldId();
        const foreignTable = await createTable({
          baseId,
          name: `Computed Event Rollup Foreign ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: foreignValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const hostPrimaryFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const rollupFieldId = createFieldId();
        const hostTable = await createTable({
          baseId,
          name: `Computed Event Rollup Host ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignPrimaryFieldId,
                isOneWay: true,
              },
            },
            {
              type: 'rollup',
              id: rollupFieldId,
              name: 'Rollup Value',
              options: {
                expression: 'sum({values})',
              },
              config: {
                linkFieldId,
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const foreignRecord = await createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Source 1',
          [foreignValueFieldId]: 1,
        });
        const hostRecord = await createRecord(hostTable.id, {
          [hostPrimaryFieldId]: 'Host 1',
          [linkFieldId]: { id: foreignRecord.id },
        });
        await drainOutbox(testContainer);

        return {
          hostTableId: hostTable.id,
          hostRecordId: hostRecord.id,
          computedFieldId: rollupFieldId,
          initialValue: 1,
          expectedValue: 9,
          trigger: async () => {
            await updateRecord(foreignTable.id, foreignRecord.id, { [foreignValueFieldId]: 9 });
          },
        };
      },
    },
    {
      label: 'conditionalLookup',
      setup: async () => {
        const foreignPrimaryFieldId = createFieldId();
        const foreignStatusFieldId = createFieldId();
        const foreignValueFieldId = createFieldId();
        const foreignTable = await createTable({
          baseId,
          name: `Computed Event Conditional Lookup Foreign ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
            { type: 'number', id: foreignValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const hostPrimaryFieldId = createFieldId();
        const conditionalLookupFieldId = createFieldId();
        const hostTable = await createTable({
          baseId,
          name: `Computed Event Conditional Lookup Host ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'conditionalLookup',
              id: conditionalLookupFieldId,
              name: 'Active Values',
              options: {
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignValueFieldId,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignStatusFieldId,
                        operator: 'is',
                        value: 'Active',
                      },
                    ],
                  },
                },
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const activeRecord = await createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Active',
          [foreignStatusFieldId]: 'Active',
          [foreignValueFieldId]: 1,
        });
        await createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Inactive',
          [foreignStatusFieldId]: 'Inactive',
          [foreignValueFieldId]: 100,
        });
        const hostRecord = await createRecord(hostTable.id, {
          [hostPrimaryFieldId]: 'Host 1',
        });
        await drainOutbox(testContainer);

        return {
          hostTableId: hostTable.id,
          hostRecordId: hostRecord.id,
          computedFieldId: conditionalLookupFieldId,
          initialValue: [1],
          expectedValue: [9],
          trigger: async () => {
            await updateRecord(foreignTable.id, activeRecord.id, { [foreignValueFieldId]: 9 });
          },
        };
      },
    },
    {
      label: 'conditionalRollup',
      setup: async () => {
        const foreignPrimaryFieldId = createFieldId();
        const foreignStatusFieldId = createFieldId();
        const foreignValueFieldId = createFieldId();
        const foreignTable = await createTable({
          baseId,
          name: `Computed Event Conditional Rollup Foreign ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
            { type: 'number', id: foreignValueFieldId, name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        });

        const hostPrimaryFieldId = createFieldId();
        const conditionalRollupFieldId = createFieldId();
        const hostTable = await createTable({
          baseId,
          name: `Computed Event Conditional Rollup Host ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'conditionalRollup',
              id: conditionalRollupFieldId,
              name: 'Active Sum',
              options: {
                expression: 'sum({values})',
              },
              config: {
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignValueFieldId,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignStatusFieldId,
                        operator: 'is',
                        value: 'Active',
                      },
                    ],
                  },
                },
              },
            },
          ],
          views: [{ type: 'grid' }],
        });

        const activeRecord = await createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Active',
          [foreignStatusFieldId]: 'Active',
          [foreignValueFieldId]: 1,
        });
        await createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Inactive',
          [foreignStatusFieldId]: 'Inactive',
          [foreignValueFieldId]: 100,
        });
        const hostRecord = await createRecord(hostTable.id, {
          [hostPrimaryFieldId]: 'Host 1',
        });
        await drainOutbox(testContainer);

        return {
          hostTableId: hostTable.id,
          hostRecordId: hostRecord.id,
          computedFieldId: conditionalRollupFieldId,
          initialValue: 1,
          expectedValue: 9,
          trigger: async () => {
            await updateRecord(foreignTable.id, activeRecord.id, { [foreignValueFieldId]: 9 });
          },
        };
      },
    },
  ];

  beforeAll(async () => {
    shareDbRuntime = await startShareDbRuntime();
    shareDbUrl = `ws://127.0.0.1:${shareDbRuntime.port}/socket`;

    testContainer = await createE2eTestContainer();
    registerRealtime(testContainer.container, shareDbRuntime);
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
    if (dispose) {
      await dispose();
    }
    await stopShareDbRuntime(shareDbRuntime);
  });

  for (const testCase of cases) {
    it(`emits computed record updates and projects ${testCase.label} changes`, async () => {
      const context = await testCase.setup();

      const initialSnapshot = await getRecordSnapshot(context.hostTableId, context.hostRecordId);
      expect(initialSnapshot.fields[context.computedFieldId]).toEqual(context.initialValue);

      const beforeEventCount = testContainer.eventBus.events().length;

      await context.trigger();
      await drainOutbox(testContainer);

      const newEvents = (testContainer.eventBus.events() as ReadonlyArray<unknown>).slice(
        beforeEventCount
      );
      const computedBatchEvents = newEvents.filter(
        (event): event is DomainEventLike =>
          getEventName(event) === 'RecordsBatchUpdated' &&
          getEventTableId(event) === context.hostTableId &&
          isObjectRecord(event) &&
          event['source'] === 'computed'
      );

      expect(computedBatchEvents.length).toBeGreaterThan(0);
      expect(
        computedBatchEvents.some((event) =>
          getChangedFieldIds(event).includes(context.computedFieldId)
        )
      ).toBe(true);

      const updatedRecords = await listRecords(context.hostTableId);
      const updatedRecord = updatedRecords.find((record) => record.id === context.hostRecordId);
      expect(updatedRecord?.fields[context.computedFieldId]).toEqual(context.expectedValue);

      const updatedSnapshot = await getRecordSnapshot(context.hostTableId, context.hostRecordId);
      expect(updatedSnapshot.fields[context.computedFieldId]).toEqual(context.expectedValue);
    });
  }
});
