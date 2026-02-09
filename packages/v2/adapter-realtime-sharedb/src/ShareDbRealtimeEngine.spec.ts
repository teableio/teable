/* eslint-disable sonarjs/no-duplicate-string */
import { ActorId, RealtimeDocId } from '@teable/v2-core';
import ShareDb from 'sharedb';
import type { Doc } from 'sharedb/lib/client';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import { ShareDbBackendPublisher } from './ShareDbBackendPublisher';
import { ShareDbRealtimeEngine } from './ShareDbRealtimeEngine';
import { ShareDbWebSocketServer } from './ShareDbWebSocketServer';

type ShareDbRuntime = {
  backend: ShareDb;
  wsServer: WebSocketServer;
  url: string;
};

type ShareDbSubscription<T> = {
  ready: Promise<void>;
  snapshot: Promise<T>;
  dispose: () => void;
};

type ShareDbClientDoc<T> = {
  ready: Promise<void>;
  doc: Doc<T>;
  dispose: () => void;
};

const startShareDbRuntime = async (): Promise<ShareDbRuntime> => {
  const backend = new ShareDb();
  const wsServer = new WebSocketServer({ port: 0, host: '127.0.0.1', path: '/socket' });
  const shareDbWebSocket = new ShareDbWebSocketServer(backend);
  shareDbWebSocket.attach(wsServer);

  const url = await new Promise<string>((resolve, reject) => {
    wsServer.once('listening', () => {
      const address = wsServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve ShareDB server address'));
        return;
      }
      resolve(`ws://127.0.0.1:${address.port}/socket`);
    });
    wsServer.once('error', (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });

  return { backend, wsServer, url };
};

const stopShareDbRuntime = async (runtime: ShareDbRuntime | undefined): Promise<void> => {
  if (!runtime) return;
  await new Promise<void>((resolve) => runtime.wsServer.close(() => resolve()));
};

const subscribeShareDbDoc = <T>(params: {
  url: string;
  collection: string;
  docId: string;
  timeoutMs?: number;
}): ShareDbSubscription<T> => {
  const { url, collection, docId, timeoutMs = 5000 } = params;
  const socket = new WebSocket(url);
  const connection = new Connection(socket as unknown as Socket);
  const doc = connection.get(collection, docId) as Doc<T>;

  let settled = false;
  let disposed = false;
  let readyResolved = false;
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    doc.removeListener('create', onSnapshot);
    doc.removeListener('load', onSnapshot);
    doc.removeListener('error', onError);
    connection.removeListener('error', onError);
    socket.removeListener('error', onError);
    doc.destroy();
    connection.close();
    socket.close();
  };

  const settleError = (error: Error) => {
    if (!readyResolved) {
      readyResolved = true;
      rejectReady(error);
    }
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    dispose();
    rejectSnapshot(error);
  };

  let resolveSnapshot: (value: T) => void;
  let rejectSnapshot: (error: Error) => void;

  const snapshot = new Promise<T>((resolve, reject) => {
    resolveSnapshot = resolve;
    rejectSnapshot = reject;
  });

  const onError = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    settleError(err);
  };

  const onSnapshot = () => {
    if (settled) return;
    if (doc.data == null) return;
    if (!readyResolved) {
      readyResolved = true;
      resolveReady();
    }
    settled = true;
    clearTimeout(timeout);
    const data = doc.data as T;
    dispose();
    resolveSnapshot(data);
  };

  const timeout = setTimeout(() => {
    settleError(new Error('ShareDB doc subscribe timed out'));
  }, timeoutMs);

  doc.on('create', onSnapshot);
  doc.on('load', onSnapshot);
  doc.on('error', onError);
  connection.on('error', onError);
  socket.on('error', onError);

  doc.subscribe((error) => {
    if (error) {
      onError(error);
      return;
    }
    if (!readyResolved) {
      readyResolved = true;
      resolveReady();
    }
    onSnapshot();
  });

  return { ready, snapshot, dispose };
};

const createShareDbClientDoc = <T>(params: {
  url: string;
  collection: string;
  docId: string;
  timeoutMs?: number;
}): ShareDbClientDoc<T> => {
  const { url, collection, docId, timeoutMs = 5000 } = params;
  const socket = new WebSocket(url);
  const connection = new Connection(socket as unknown as Socket);
  const doc = connection.get(collection, docId) as Doc<T>;

  let disposed = false;
  let settled = false;

  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    doc.removeListener('error', onError);
    connection.removeListener('error', onError);
    socket.removeListener('error', onError);
    doc.destroy();
    connection.close();
    socket.close();
  };

  const settleError = (error: Error) => {
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      rejectReady(error);
    }
    dispose();
  };

  const onError = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    settleError(err);
  };

  const timeout = setTimeout(() => {
    settleError(new Error('ShareDB client subscribe timed out'));
  }, timeoutMs);

  doc.on('error', onError);
  connection.on('error', onError);
  socket.on('error', onError);

  doc.subscribe((error) => {
    if (settled) return;
    if (error) {
      onError(error);
      return;
    }
    settled = true;
    clearTimeout(timeout);
    resolveReady();
  });

  return { ready, doc, dispose };
};

const submitOp = <T>(doc: Doc<T>, op: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    doc.submitOp(op as never, undefined, (error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve();
    });
  });

const waitNothingPending = <T>(doc: Doc<T>): Promise<void> =>
  new Promise((resolve) => {
    doc.whenNothingPending(() => resolve());
  });

const waitDocDeleted = <T>(doc: Doc<T>, timeoutMs = 5000): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      doc.removeListener('del', onDelete);
      doc.removeListener('error', onError);
      clearTimeout(timeout);
    };

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const onError = (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      settle(err);
    };

    const onDelete = () => {
      settle();
    };

    const timeout = setTimeout(() => {
      settle(new Error('ShareDB doc delete timed out'));
    }, timeoutMs);

    doc.on('del', onDelete);
    doc.on('error', onError);

    if (doc.type === null) {
      settle();
    }
  });

describe('ShareDbRealtimeEngine', () => {
  let runtime: ShareDbRuntime | undefined;

  beforeAll(async () => {
    runtime = await startShareDbRuntime();
  });

  afterAll(async () => {
    await stopShareDbRuntime(runtime);
  });

  it('delivers create ops to subscribed clients', async () => {
    if (!runtime) throw new Error('Missing ShareDB runtime');

    const actorId = ActorId.create('test-actor')._unsafeUnwrap();
    const context = { actorId };
    const collection = 'tbl_test';
    const documentId = 'doc_1';
    const docId = RealtimeDocId.fromParts(collection, documentId)._unsafeUnwrap();
    const initial = { id: documentId, name: 'Realtime Table' };

    const engine = new ShareDbRealtimeEngine(new ShareDbBackendPublisher(runtime.backend));
    const subscription = subscribeShareDbDoc<typeof initial>({
      url: runtime.url,
      collection,
      docId: documentId,
    });

    try {
      await subscription.ready;
      const ensureResult = await engine.ensure(context, docId, initial);
      expect(ensureResult.isOk()).toBe(true);
      if (ensureResult.isErr()) return;

      const snapshot = await subscription.snapshot;
      expect(snapshot).toEqual(initial);
    } finally {
      subscription.dispose();
    }
  });

  it('merges concurrent json0 ops across clients', async () => {
    if (!runtime) throw new Error('Missing ShareDB runtime');

    const actorId = ActorId.create('test-actor')._unsafeUnwrap();
    const context = { actorId };
    const collection = 'tbl_test';
    const documentId = 'doc_ot';
    const docId = RealtimeDocId.fromParts(collection, documentId)._unsafeUnwrap();
    const initial = { title: 'Hi' };

    const engine = new ShareDbRealtimeEngine(new ShareDbBackendPublisher(runtime.backend));
    const ensureResult = await engine.ensure(context, docId, initial);
    expect(ensureResult.isOk()).toBe(true);
    if (ensureResult.isErr()) return;

    const clientA = createShareDbClientDoc<{ title: string }>({
      url: runtime.url,
      collection,
      docId: documentId,
    });
    const clientB = createShareDbClientDoc<{ title: string }>({
      url: runtime.url,
      collection,
      docId: documentId,
    });

    try {
      await Promise.all([clientA.ready, clientB.ready]);

      const opA = [{ p: ['title', 0], si: 'A' }];
      const opB = [{ p: ['title', 2], si: 'B' }];

      await Promise.all([submitOp(clientA.doc, opA), submitOp(clientB.doc, opB)]);
      await Promise.all([waitNothingPending(clientA.doc), waitNothingPending(clientB.doc)]);

      expect(clientA.doc.data?.title).toBe('AHiB');
      expect(clientB.doc.data?.title).toBe('AHiB');
    } finally {
      clientA.dispose();
      clientB.dispose();
    }
  });

  it('delivers delete ops to subscribed clients', async () => {
    if (!runtime) throw new Error('Missing ShareDB runtime');

    const actorId = ActorId.create('test-actor')._unsafeUnwrap();
    const context = { actorId };
    const collection = 'tbl_test';
    const documentId = 'doc_delete';
    const docId = RealtimeDocId.fromParts(collection, documentId)._unsafeUnwrap();
    const initial = { id: documentId, name: 'To Delete' };

    const engine = new ShareDbRealtimeEngine(new ShareDbBackendPublisher(runtime.backend));
    const ensureResult = await engine.ensure(context, docId, initial);
    expect(ensureResult.isOk()).toBe(true);
    if (ensureResult.isErr()) return;

    const client = createShareDbClientDoc<typeof initial>({
      url: runtime.url,
      collection,
      docId: documentId,
    });

    try {
      await client.ready;
      const deleted = waitDocDeleted(client.doc);
      const deleteResult = await engine.delete(context, docId);
      expect(deleteResult.isOk()).toBe(true);
      if (deleteResult.isErr()) return;
      await deleted;
      expect(client.doc.type).toBe(null);
      expect(client.doc.data).toBeUndefined();
    } finally {
      client.dispose();
    }
  });
});
