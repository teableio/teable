/**
 * E2E: compute activity domain event → ShareDB cmp_* projection.
 *
 * Isolated container + ShareDB (like realtimeShareDb.e2e) so registering ShareDB
 * does not affect the shared test context.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ShareDbPubSubPublisher,
  ShareDbWebSocketServer,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';
import {
  buildOutboxTaskInput,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdatePlan,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import {
  BaseId,
  FieldId,
  NoopLogger,
  RecordId,
  TableId,
  v2CoreTokens,
  type IHasher,
  type ILogger,
} from '@teable/v2-core';
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

const startShareDbRuntime = async (logger: ILogger): Promise<ShareDbRuntime> => {
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

const observeDoc = <T>(params: { url: string; collection: string; docId: string }) => {
  const { url, collection, docId } = params;
  const socket = new WebSocket(url);
  const connection = new Connection(socket as Socket);
  const doc = connection.get(collection, docId) as Doc<T>;
  let closed = false;
  let resolveSubscribed: () => void;
  let rejectSubscribed: (error: unknown) => void;
  const subscribed = new Promise<void>((resolve, reject) => {
    resolveSubscribed = resolve;
    rejectSubscribed = reject;
  });

  doc.subscribe((error) => {
    if (error) {
      rejectSubscribed(error);
      return;
    }
    resolveSubscribed();
  });

  const waitFor = async (
    predicate: (data: T | undefined) => boolean,
    timeoutMs = 12_000
  ): Promise<T> => {
    await subscribed;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        doc.removeListener('op', check);
        doc.removeListener('op batch', check);
        doc.removeListener('create', check);
      };
      const check = () => {
        if (!predicate(doc.data)) return;
        cleanup();
        resolve(doc.data as T);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${collection}/${docId}`));
      }, timeoutMs);
      doc.on('op', check);
      doc.on('op batch', check);
      doc.on('create', check);
      check();
    });
  };

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      doc.destroy();
    } catch {
      // ignore
    }
    try {
      connection.close();
    } catch {
      socket.close();
    }
  };

  return { subscribed, waitFor, close };
};

const unwrap = <T>(result: { isErr(): boolean; error?: { message: string }; value: T }): T => {
  if (result.isErr()) throw new Error(result.error?.message ?? 'unwrap failed');
  return result.value;
};

describe('computed activity realtime cmp_* (e2e)', () => {
  let testContainer: Awaited<ReturnType<typeof createE2eTestContainer>>;
  let runtime: ShareDbRuntime | undefined;
  let httpServer: Server | undefined;
  let baseUrl = '';
  let baseId = '';
  let shareDbUrl = '';
  const logger = new NoopLogger();

  beforeAll(async () => {
    runtime = await startShareDbRuntime(logger);
    shareDbUrl = `ws://127.0.0.1:${runtime.port}/socket`;

    testContainer = await createE2eTestContainer();
    registerV2ShareDbRealtime(testContainer.container as DependencyContainer, {
      publisher: new ShareDbPubSubPublisher(runtime.backend.pubsub),
    });
    baseId = testContainer.baseId.toString();

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );
    httpServer = await new Promise<Server>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 120_000);

  afterAll(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    await testContainer?.dispose?.();
    await stopShareDbRuntime(runtime);
  });

  it('delivers versioned projection operations through ShareDB pubsub', async () => {
    const collection = 'cmp_probe';
    const docId = 'table';
    const observer = observeDoc<{ status: string }>({ url: shareDbUrl, collection, docId });
    try {
      await observer.subscribed;
      const received = observer.waitFor((data) => data?.status === 'running');
      const publisher = new ShareDbPubSubPublisher(runtime!.backend.pubsub);
      const result = await publisher.publish([collection, `${collection}.${docId}`], {
        c: collection,
        d: docId,
        v: 0,
        src: '@@v2-projection:probe',
        seq: 1,
        create: { type: 'json0', data: { status: 'running' } },
        del: undefined,
        op: undefined,
        m: { ts: Date.now() },
      });
      expect(result.isOk()).toBe(true);
      expect((await received).status).toBe('running');
    } finally {
      observer.close();
    }
  });

  it('publishes cmp_{tableId} field/table docs on enqueue and idle on done', async () => {
    const createTableRes = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name: `activity-rt-${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Amount' },
        ],
      }),
    });
    expect(createTableRes.status).toBe(201);
    const tableBody = createTableOkResponseSchema.parse(await createTableRes.json());
    const tableId = tableBody.data.table.id;
    const amountField = tableBody.data.table.fields.find((f) => f.name === 'Amount');
    const nameField = tableBody.data.table.fields.find((f) => f.isPrimary);
    expect(amountField && nameField).toBeTruthy();

    const createFieldRes = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'Double',
          options: { expression: `{${amountField!.id}} * 2` },
        },
      }),
    });
    expect(createFieldRes.status).toBe(200);
    const fieldBody = createFieldOkResponseSchema.parse(await createFieldRes.json());
    const formulaField = fieldBody.data.table.fields.find((f) => f.name === 'Double');
    expect(formulaField).toBeTruthy();

    const createRecordRes = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        record: {
          fields: {
            [nameField!.id]: 'r1',
            [amountField!.id]: 7,
          },
        },
      }),
    });
    expect(createRecordRes.status).toBe(201);
    const recordBody = createRecordOkResponseSchema.parse(await createRecordRes.json());
    const recordId = recordBody.data.record.id;

    await testContainer.processOutbox();
    await testContainer.processOutbox();

    const plan: ComputedUpdatePlan = {
      baseId: unwrap(BaseId.create(baseId)),
      seedTableId: unwrap(TableId.create(tableId)),
      seedRecordIds: [unwrap(RecordId.create(recordId))],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [
        {
          tableId: unwrap(TableId.create(tableId)),
          fieldIds: [unwrap(FieldId.create(formulaField!.id))],
          level: 0,
        },
      ],
      edges: [],
      estimatedComplexity: 9,
      changeType: 'update',
      sameTableBatches: [],
    };

    const hasher = testContainer.container.resolve<IHasher>(v2CoreTokens.hasher);
    const runId = `run_activity_rt_${Date.now()}`;
    const task = buildOutboxTaskInput({
      plan,
      hasher,
      runId,
      originRunIds: [runId],
      runTotalSteps: 1,
      runCompletedStepsBefore: 0,
      syncMaxLevel: 0,
      dirtyStats: [{ tableId, recordCount: 1 }],
    });

    const outbox = testContainer.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );

    const collection = `cmp_${tableId}`;

    const fieldObserver = observeDoc<{ status: string }>({
      url: shareDbUrl,
      collection,
      docId: formulaField!.id,
    });
    const tableObserver = observeDoc<{ status: string }>({
      url: shareDbUrl,
      collection,
      docId: 'table',
    });

    try {
      await Promise.all([fieldObserver.subscribed, tableObserver.subscribed]);
      const fieldActivePromise = fieldObserver.waitFor(
        (data) => data?.status === 'queued' || data?.status === 'running'
      );
      const tableActivePromise = tableObserver.waitFor((data) => data?.status === 'calculating');

      const enqueueResult = await outbox.enqueueOrMerge(task);
      if (enqueueResult.isErr()) {
        throw new Error(enqueueResult.error.message);
      }

      const fieldDoc = await fieldActivePromise;
      expect(['queued', 'running']).toContain(fieldDoc.status);

      const tableDoc = await tableActivePromise;
      expect(tableDoc.status).toBe('calculating');

      const idlePromise = fieldObserver.waitFor((data) => data?.status === 'idle', 20_000);
      const tableIdlePromise = tableObserver.waitFor((data) => data?.status === 'idle', 20_000);
      const processed = await testContainer.processOutbox();
      expect(processed).toBeGreaterThan(0);
      await testContainer.processOutbox();

      const idleDoc = await idlePromise;
      expect(idleDoc.status).toBe('idle');
      const idleTableDoc = await tableIdlePromise;
      expect(idleTableDoc.status).toBe('idle');
    } finally {
      fieldObserver.close();
      tableObserver.close();
    }
  }, 90_000);
});
