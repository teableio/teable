/**
 * E2E: compute activity changes reach subscribers as a presence invalidation on
 * the table's action-trigger channel. The authoritative snapshot is read over
 * HTTP (`getComputeActivity`); the realtime channel only says "changed".
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
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
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
import type { Result } from 'neverthrow';
import ShareDb from 'sharedb';
import { Connection } from 'sharedb/lib/client';
import type { Presence } from 'sharedb/lib/sharedb';
import type { Socket } from 'sharedb/lib/sharedb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createE2eTestContainer } from './shared/createE2eTestContainer';
import { createShareDbRealtimeConfig } from './shared/shareDbRealtimeConfig';

type ShareDbRuntime = {
  backend: ShareDb;
  wsServer: WebSocketServer;
  port: number;
};

const startShareDbRuntime = async (logger: ILogger): Promise<ShareDbRuntime> => {
  const backend = new ShareDb({ presence: true });
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

type PresenceMessage = Array<{ actionKey?: string; payload?: Record<string, unknown> }>;

const observePresence = (params: { url: string; channel: string }) => {
  const { url, channel } = params;
  const socket = new WebSocket(url);
  const connection = new Connection(socket as Socket);
  const presence = connection.getPresence(channel) as Presence;
  const received: PresenceMessage[] = [];
  let closed = false;
  let resolveSubscribed: () => void;
  let rejectSubscribed: (error: unknown) => void;
  const subscribed = new Promise<void>((resolve, reject) => {
    resolveSubscribed = resolve;
    rejectSubscribed = reject;
  });

  presence.subscribe((error?: unknown) => {
    if (error) {
      rejectSubscribed(error);
      return;
    }
    resolveSubscribed();
  });

  const onReceive = (_id: string, data: unknown) => {
    if (Array.isArray(data)) {
      received.push(data as PresenceMessage);
    }
  };
  presence.addListener('receive', onReceive);

  const waitFor = async (
    predicate: (messages: PresenceMessage[]) => boolean,
    timeoutMs = 12_000
  ): Promise<PresenceMessage[]> => {
    await subscribed;
    return new Promise<PresenceMessage[]>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        presence.removeListener('receive', check);
      };
      const check = () => {
        if (!predicate(received)) return;
        cleanup();
        resolve(received);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for presence on ${channel}`));
      }, timeoutMs);
      presence.addListener('receive', check);
      check();
    });
  };

  const close = () => {
    if (closed) return;
    closed = true;
    presence.removeListener('receive', onReceive);
    try {
      presence.destroy();
    } catch {
      // ignore
    }
    try {
      connection.close();
    } catch {
      socket.close();
    }
  };

  return { subscribed, waitFor, close, getReceived: () => received };
};

const unwrap = <T, E extends { message: string }>(result: Result<T, E>): T => {
  if (result.isErr()) throw new Error(result.error.message);
  return result.value;
};

const COMPUTE_ACTIVITY_CHANGED = 'computeActivityChanged';
const actionTriggerChannel = (tableId: string) => `__action_trigger_${tableId}`;

describe('computed activity realtime presence (e2e)', () => {
  let testContainer: IV2NodeTestContainer;
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
    registerV2ShareDbRealtime(
      testContainer.container as DependencyContainer,
      createShareDbRealtimeConfig(
        runtime.backend,
        new ShareDbPubSubPublisher(runtime.backend.pubsub)
      )
    );
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

  it('notifies the table channel on enqueue and on completion instead of publishing cmp_ docs', async () => {
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

    const observer = observePresence({ url: shareDbUrl, channel: actionTriggerChannel(tableId) });
    try {
      await observer.subscribed;

      const enqueuedPing = observer.waitFor((messages) =>
        messages.some((batch) =>
          batch.some((message) => message.actionKey === COMPUTE_ACTIVITY_CHANGED)
        )
      );

      const enqueueResult = await outbox.enqueueOrMerge(task);
      if (enqueueResult.isErr()) {
        throw new Error(enqueueResult.error.message);
      }

      const firstPings = await enqueuedPing;
      expect(
        firstPings.some((batch) =>
          batch.some((message) => message.actionKey === COMPUTE_ACTIVITY_CHANGED)
        )
      ).toBe(true);

      const completionPing = observer.waitFor(
        (messages) =>
          messages.filter((batch) =>
            batch.some((message) => message.actionKey === COMPUTE_ACTIVITY_CHANGED)
          ).length >= 2,
        20_000
      );

      const processed = await testContainer.processOutbox();
      expect(processed).toBeGreaterThan(0);
      await testContainer.processOutbox();

      const pings = await completionPing;
      expect(pings.length).toBeGreaterThanOrEqual(2);
    } finally {
      observer.close();
    }
  }, 90_000);
});
