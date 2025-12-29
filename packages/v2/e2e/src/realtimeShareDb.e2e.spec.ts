/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ShareDbBackendPublisher,
  ShareDbWebSocketServer,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createTableOkResponseSchema,
  deleteFieldOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { NoopLogger } from '@teable/v2-core';
import type {
  ICreateTableCommandInput,
  ILogger,
  ITableFieldPersistenceDTO,
  ITablePersistenceDTO,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import express from 'express';
import ShareDb from 'sharedb';
import type { Doc, Query } from 'sharedb/lib/client';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

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
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('ShareDB doc subscribe timed out'));
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

const waitShareDbDocDeleted = async (params: {
  url: string;
  collection: string;
  docId: string;
  timeoutMs?: number;
}): Promise<void> => {
  const { url, collection, docId, timeoutMs = 5000 } = params;
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    const connection = new Connection(socket as Socket);
    const doc = connection.get(collection, docId) as Doc<unknown>;
    let settled = false;

    const cleanup = () => {
      connection.removeListener('error', onError);
      socket.removeListener('error', onError);
      doc.removeListener('error', onError);
      doc.removeListener('del', onDelete);
      doc.destroy();
      try {
        connection.close();
      } catch {
        socket.close();
      }
    };

    const settleError = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const onError = (error: unknown) => {
      settleError(error);
    };

    const onDelete = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      resolve();
    };

    const timeout = setTimeout(() => {
      settleError(new Error('ShareDB doc delete timed out'));
    }, timeoutMs);

    connection.on('error', onError);
    socket.on('error', onError);
    doc.on('error', onError);
    doc.on('del', onDelete);

    doc.subscribe((error) => {
      if (settled) return;
      if (error) {
        onError(error);
        return;
      }
      if (doc.type === null) {
        onDelete();
      }
    });
  });
};

const createShareDbQuery = async <T>(params: {
  url: string;
  collection: string;
  query?: unknown;
  timeoutMs?: number;
}): Promise<{ query: Query<T>; cleanup: () => void }> => {
  const { url, collection, query = {}, timeoutMs = 5000 } = params;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const connection = new Connection(socket as Socket);
    const shareDbQuery = connection.createSubscribeQuery<T>(collection, query) as Query<T>;
    let settled = false;

    const cleanup = () => {
      connection.removeListener('error', onError);
      socket.removeListener('error', onError);
      shareDbQuery.removeListener('error', onError);
      shareDbQuery.removeListener('ready', onReady);
      shareDbQuery.destroy();
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

    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      shareDbQuery.removeListener('ready', onReady);
      resolve({ query: shareDbQuery, cleanup });
    };

    const timeout = setTimeout(() => {
      onError(new Error('ShareDB query subscribe timed out'));
    }, timeoutMs);

    connection.on('error', onError);
    socket.on('error', onError);
    shareDbQuery.on('error', onError);
    shareDbQuery.once('ready', onReady);
  });
};

const deleteShareDbBackendDoc = async (params: {
  backend: ShareDb;
  collection: string;
  docId: string;
}): Promise<void> => {
  const { backend, collection, docId } = params;
  const connection = backend.connect();
  const doc = connection.get(collection, docId) as Doc;
  try {
    await new Promise<void>((resolve, reject) => {
      doc.fetch((fetchError) => {
        if (fetchError) {
          reject(fetchError);
          return;
        }
        if (!doc.type) {
          resolve();
          return;
        }
        doc.del((deleteError) => {
          if (deleteError) {
            reject(deleteError);
            return;
          }
          resolve();
        });
      });
    });
  } finally {
    connection.close();
  }
};

describe('v2 realtime sharedb (e2e)', () => {
  let server: Server | undefined;
  let shareDbRuntime: ShareDbRuntime | undefined;
  let baseUrl: string;
  let shareDbUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  const logger = new NoopLogger();
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const registerRealtime = async (
    container: DependencyContainer,
    runtime: ShareDbRuntime
  ): Promise<void> => {
    registerV2ShareDbRealtime(container, {
      publisher: new ShareDbBackendPublisher(runtime.backend, logger),
    });
  };

  beforeAll(async () => {
    const runtime = await startShareDbRuntime(logger);
    shareDbRuntime = runtime;
    shareDbUrl = `ws://127.0.0.1:${runtime.port}/socket`;

    const testContainer = await createV2NodeTestContainer({
      registerDb: async (container) => registerRealtime(container, runtime),
    });
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
    await stopShareDbRuntime(shareDbRuntime);
  });

  it('publishes table snapshot to ShareDB over websocket', async () => {
    const payload: ICreateTableCommandInput = {
      baseId,
      name: 'Realtime Table',
      fields: [{ type: 'singleLineText', name: 'Name' }],
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
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const table = body.data.table;
    const collection = `tbl_${baseId}`;
    const snapshot = await fetchShareDbDoc<ITablePersistenceDTO>({
      url: shareDbUrl,
      collection,
      docId: table.id,
    });

    expect(snapshot.id).toBe(table.id);
    expect(snapshot.baseId).toBe(baseId);
    expect(snapshot.name).toBe('Realtime Table');
  });

  it('publishes field snapshot to ShareDB over websocket', async () => {
    const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name: 'Realtime Fields',
        fields: [{ type: 'singleLineText', name: 'Name' }],
      } satisfies ICreateTableCommandInput),
    });

    expect(createTableResponse.status).toBe(201);

    const createTableRaw = await createTableResponse.json();
    const createTableParsed = createTableOkResponseSchema.safeParse(createTableRaw);
    expect(createTableParsed.success).toBe(true);
    if (!createTableParsed.success || !createTableParsed.data.ok) return;

    const tableId = createTableParsed.data.data.table.id;
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

    const collection = `fld_${tableId}`;
    const snapshot = await fetchShareDbDoc<ITableFieldPersistenceDTO>({
      url: shareDbUrl,
      collection,
      docId: fieldId,
    });

    expect(snapshot.id).toBe(fieldId);
    expect(snapshot.name).toBe('Status');
    expect(snapshot.type).toBe('singleLineText');
  });

  it('removes initial fields from ShareDB queries on delete', async () => {
    const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name: 'Realtime Field Removal',
        fields: [
          { type: 'singleLineText', name: 'Name' },
          { type: 'number', name: 'Count' },
        ],
      } satisfies ICreateTableCommandInput),
    });

    expect(createTableResponse.status).toBe(201);

    const createTableRaw = await createTableResponse.json();
    const createTableParsed = createTableOkResponseSchema.safeParse(createTableRaw);
    expect(createTableParsed.success).toBe(true);
    if (!createTableParsed.success || !createTableParsed.data.ok) {
      throw new Error('Failed to create table');
    }

    const table = createTableParsed.data.data.table;
    const deletableField = table.fields.find((field) => !field.isPrimary);
    if (!deletableField) {
      throw new Error('Missing deletable field');
    }

    const collection = `fld_${table.id}`;
    const querySession = await createShareDbQuery<ITableFieldPersistenceDTO>({
      url: shareDbUrl,
      collection,
    });

    try {
      const initialIds = (querySession.query.results ?? []).map((doc) => doc.id);
      expect(initialIds).toContain(deletableField.id);

      const removalPromise = new Promise<void>((resolve, reject) => {
        let settled = false;
        const onRemove = (docs: ReadonlyArray<Doc<ITableFieldPersistenceDTO>>) => {
          if (settled) return;
          if (docs.some((doc) => doc.id === deletableField.id)) {
            settled = true;
            clearTimeout(timeout);
            querySession.query.removeListener('remove', onRemove);
            querySession.query.removeListener('error', onError);
            resolve();
          }
        };
        const onError = (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          querySession.query.removeListener('remove', onRemove);
          querySession.query.removeListener('error', onError);
          reject(error instanceof Error ? error : new Error(String(error)));
        };
        const timeout = setTimeout(() => {
          onError(new Error('ShareDB query remove timed out'));
        }, 5000);

        querySession.query.on('remove', onRemove);
        querySession.query.on('error', onError);
      });

      const deleteResponse = await fetch(`${baseUrl}/tables/deleteField`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          fieldId: deletableField.id,
        }),
      });

      expect(deleteResponse.status).toBe(200);
      const deleteRaw = await deleteResponse.json();
      const deleteParsed = deleteFieldOkResponseSchema.safeParse(deleteRaw);
      expect(deleteParsed.success).toBe(true);
      if (!deleteParsed.success || !deleteParsed.data.ok) {
        throw new Error('Failed to delete field');
      }

      await removalPromise;
    } finally {
      querySession.cleanup();
    }
  });

  it('publishes field deletes to ShareDB over websocket', async () => {
    const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name: 'Realtime Delete',
        fields: [{ type: 'singleLineText', name: 'Name' }],
      } satisfies ICreateTableCommandInput),
    });

    expect(createTableResponse.status).toBe(201);

    const createTableRaw = await createTableResponse.json();
    const createTableParsed = createTableOkResponseSchema.safeParse(createTableRaw);
    expect(createTableParsed.success).toBe(true);
    if (!createTableParsed.success || !createTableParsed.data.ok) return;

    const tableId = createTableParsed.data.data.table.id;
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
          name: 'To Delete',
        },
      }),
    });

    expect(createFieldResponse.status).toBe(200);
    const createFieldRaw = await createFieldResponse.json();
    const createFieldParsed = createFieldOkResponseSchema.safeParse(createFieldRaw);
    expect(createFieldParsed.success).toBe(true);
    if (!createFieldParsed.success || !createFieldParsed.data.ok) return;

    const collection = `fld_${tableId}`;
    await fetchShareDbDoc<ITableFieldPersistenceDTO>({
      url: shareDbUrl,
      collection,
      docId: fieldId,
    });

    const deletePromise = waitShareDbDocDeleted({
      url: shareDbUrl,
      collection,
      docId: fieldId,
    });

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
    const deleteRaw = await deleteResponse.json();
    const deleteParsed = deleteFieldOkResponseSchema.safeParse(deleteRaw);
    expect(deleteParsed.success).toBe(true);
    if (!deleteParsed.success || !deleteParsed.data.ok) return;

    await deletePromise;
  });

  it('deletes fields when ShareDB doc was removed early', async () => {
    if (!shareDbRuntime) {
      throw new Error('Missing ShareDB runtime');
    }

    const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name: 'Realtime Delete Missing Doc',
        fields: [{ type: 'singleLineText', name: 'Name' }],
      } satisfies ICreateTableCommandInput),
    });

    expect(createTableResponse.status).toBe(201);

    const createTableRaw = await createTableResponse.json();
    const createTableParsed = createTableOkResponseSchema.safeParse(createTableRaw);
    expect(createTableParsed.success).toBe(true);
    if (!createTableParsed.success || !createTableParsed.data.ok) return;

    const tableId = createTableParsed.data.data.table.id;
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
          name: 'To Delete',
        },
      }),
    });

    expect(createFieldResponse.status).toBe(200);
    const createFieldRaw = await createFieldResponse.json();
    const createFieldParsed = createFieldOkResponseSchema.safeParse(createFieldRaw);
    expect(createFieldParsed.success).toBe(true);
    if (!createFieldParsed.success || !createFieldParsed.data.ok) return;

    const collection = `fld_${tableId}`;
    await fetchShareDbDoc<ITableFieldPersistenceDTO>({
      url: shareDbUrl,
      collection,
      docId: fieldId,
    });

    await deleteShareDbBackendDoc({
      backend: shareDbRuntime.backend,
      collection,
      docId: fieldId,
    });

    const deletePromise = waitShareDbDocDeleted({
      url: shareDbUrl,
      collection,
      docId: fieldId,
    });

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
    const deleteRaw = await deleteResponse.json();
    const deleteParsed = deleteFieldOkResponseSchema.safeParse(deleteRaw);
    expect(deleteParsed.success).toBe(true);
    if (!deleteParsed.success || !deleteParsed.data.ok) return;

    await deletePromise;
  });
});
