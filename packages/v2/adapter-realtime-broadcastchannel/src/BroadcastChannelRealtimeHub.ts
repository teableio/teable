import type { ILogger, RealtimeChange, RealtimeDocId } from '@teable/v2-core';
import { NoopLogger, RealtimeDocId as RealtimeDocIdValue } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

const defaultChannelName = 'teable.v2.realtime';

type SnapshotMessage = {
  type: 'snapshot';
  docKey: string;
  collection: string;
  docId: string;
  snapshot: unknown | null;
};

type BroadcastMessage = SnapshotMessage;

type DocListener = (snapshot: unknown | null) => void;
type CollectionListener = (snapshots: ReadonlyArray<unknown>) => void;

type DocState = {
  collection: string;
  docId: string;
  snapshot: unknown;
};

const cloneSnapshot = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
};

const updateAtPath = (
  current: unknown,
  path: ReadonlyArray<string | number>,
  updater: (value: unknown) => unknown
): unknown => {
  if (path.length === 0) return updater(current);

  const [head, ...rest] = path;
  const isArray = Array.isArray(current);
  const base = isArray
    ? [...(current as unknown[])]
    : typeof current === 'object' && current !== null
      ? { ...(current as Record<string, unknown>) }
      : {};

  const nextValue = updateAtPath((base as Record<string | number, unknown>)[head], rest, updater);
  (base as Record<string | number, unknown>)[head] = nextValue;
  return base;
};

const applyRealtimeChange = (snapshot: unknown, change: RealtimeChange): unknown => {
  switch (change.type) {
    case 'set':
      return updateAtPath(snapshot, change.path, () => change.value);
    case 'insert':
      return updateAtPath(snapshot, change.path, (target) => {
        const list = Array.isArray(target) ? [...target] : [];
        list.splice(change.index, 0, change.value);
        return list;
      });
    case 'delete':
      return updateAtPath(snapshot, change.path, (target) => {
        const list = Array.isArray(target) ? [...target] : [];
        list.splice(change.index, change.count);
        return list;
      });
  }
};

export class BroadcastChannelRealtimeHub {
  private readonly channel: BroadcastChannel;
  private readonly docs = new Map<string, DocState>();
  private readonly docListeners = new Map<string, Set<DocListener>>();
  private readonly collectionListeners = new Map<string, Set<CollectionListener>>();
  private logger: ILogger;

  constructor(
    private readonly channelName: string,
    logger?: ILogger
  ) {
    this.channel = new BroadcastChannel(channelName);
    this.logger = logger ?? new NoopLogger();
    this.channel.addEventListener('message', (event) => {
      this.handleMessage(event.data as BroadcastMessage);
    });
    this.logger.debug('BroadcastChannel realtime hub initialized', { channelName });
  }

  static resolve(
    channelName = defaultChannelName,
    logger?: ILogger
  ): Result<BroadcastChannelRealtimeHub, string> {
    if (typeof BroadcastChannel === 'undefined') {
      return err('BroadcastChannel is not available in this environment');
    }
    return ok(new BroadcastChannelRealtimeHub(channelName, logger));
  }

  ensure(docId: RealtimeDocId, snapshot: unknown): Result<void, string> {
    const parsed = RealtimeDocIdValue.parse(docId);
    if (parsed.isErr()) {
      this.logger.warn('BroadcastChannel realtime ensure failed', {
        error: parsed.error,
        docId: docId.toString(),
      });
      return err(parsed.error);
    }
    const docKey = docId.toString();
    const nextSnapshot = cloneSnapshot(snapshot);
    this.docs.set(docKey, {
      collection: parsed.value.collection,
      docId: parsed.value.docId,
      snapshot: nextSnapshot,
    });
    this.logger.debug('BroadcastChannel realtime ensure', {
      docKey,
      collection: parsed.value.collection,
      docId: parsed.value.docId,
    });
    this.broadcast({
      type: 'snapshot',
      docKey,
      collection: parsed.value.collection,
      docId: parsed.value.docId,
      snapshot: nextSnapshot,
    });
    this.notifyDoc(docKey);
    this.notifyCollection(parsed.value.collection);
    return ok(undefined);
  }

  applyChange(docId: RealtimeDocId, change: RealtimeChange): Result<void, string> {
    const parsed = RealtimeDocIdValue.parse(docId);
    if (parsed.isErr()) {
      this.logger.warn('BroadcastChannel realtime applyChange failed', {
        error: parsed.error,
        docId: docId.toString(),
      });
      return err(parsed.error);
    }
    const docKey = docId.toString();
    const current = this.docs.get(docKey);
    if (!current) {
      this.logger.warn('BroadcastChannel realtime snapshot missing', { docKey });
      return err('Realtime snapshot missing');
    }

    const nextSnapshot = applyRealtimeChange(current.snapshot, change);
    this.docs.set(docKey, {
      collection: parsed.value.collection,
      docId: parsed.value.docId,
      snapshot: nextSnapshot,
    });
    this.logger.debug('BroadcastChannel realtime applyChange', {
      docKey,
      collection: parsed.value.collection,
      docId: parsed.value.docId,
      changeType: change.type,
    });
    this.broadcast({
      type: 'snapshot',
      docKey,
      collection: parsed.value.collection,
      docId: parsed.value.docId,
      snapshot: nextSnapshot,
    });
    this.notifyDoc(docKey);
    this.notifyCollection(parsed.value.collection);
    return ok(undefined);
  }

  remove(docId: RealtimeDocId): Result<void, string> {
    const parsed = RealtimeDocIdValue.parse(docId);
    if (parsed.isErr()) {
      this.logger.warn('BroadcastChannel realtime delete failed', {
        error: parsed.error,
        docId: docId.toString(),
      });
      return err(parsed.error);
    }

    const docKey = docId.toString();
    this.docs.delete(docKey);
    this.logger.debug('BroadcastChannel realtime delete', {
      docKey,
      collection: parsed.value.collection,
      docId: parsed.value.docId,
    });
    this.broadcast({
      type: 'snapshot',
      docKey,
      collection: parsed.value.collection,
      docId: parsed.value.docId,
      snapshot: null,
    });
    this.notifyDoc(docKey);
    this.notifyCollection(parsed.value.collection);
    return ok(undefined);
  }

  getSnapshot(docKey: string): unknown | null {
    return this.docs.get(docKey)?.snapshot ?? null;
  }

  getCollectionSnapshots(collection: string): ReadonlyArray<unknown> {
    const results: unknown[] = [];
    for (const entry of this.docs.values()) {
      if (entry.collection === collection) {
        results.push(entry.snapshot);
      }
    }
    return results;
  }

  subscribeDoc(docKey: string, listener: DocListener): () => void {
    const set = this.docListeners.get(docKey) ?? new Set<DocListener>();
    set.add(listener);
    this.docListeners.set(docKey, set);
    this.logger.debug('BroadcastChannel realtime subscribe doc', { docKey });
    listener(this.getSnapshot(docKey));
    return () => {
      const next = this.docListeners.get(docKey);
      if (!next) return;
      next.delete(listener);
      if (next.size === 0) this.docListeners.delete(docKey);
    };
  }

  subscribeCollection(collection: string, listener: CollectionListener): () => void {
    const set = this.collectionListeners.get(collection) ?? new Set<CollectionListener>();
    set.add(listener);
    this.collectionListeners.set(collection, set);
    this.logger.debug('BroadcastChannel realtime subscribe collection', { collection });
    listener(this.getCollectionSnapshots(collection));
    return () => {
      const next = this.collectionListeners.get(collection);
      if (!next) return;
      next.delete(listener);
      if (next.size === 0) this.collectionListeners.delete(collection);
    };
  }

  private broadcast(message: BroadcastMessage): void {
    try {
      this.channel.postMessage(message);
      this.logger.debug('BroadcastChannel realtime broadcast', {
        type: message.type,
        docKey: message.type === 'snapshot' ? message.docKey : undefined,
      });
    } catch (error) {
      this.logger.warn('BroadcastChannel realtime broadcast failed', { error });
    }
  }

  private handleMessage(message: BroadcastMessage): void {
    if (message.type !== 'snapshot') return;
    this.logger.debug('BroadcastChannel realtime message received', {
      docKey: message.docKey,
      collection: message.collection,
      docId: message.docId,
    });
    if (message.snapshot === null) {
      this.docs.delete(message.docKey);
    } else {
      this.docs.set(message.docKey, {
        collection: message.collection,
        docId: message.docId,
        snapshot: message.snapshot,
      });
    }
    this.notifyDoc(message.docKey);
    this.notifyCollection(message.collection);
  }

  private notifyDoc(docKey: string): void {
    const listeners = this.docListeners.get(docKey);
    if (!listeners) return;
    const snapshot = this.getSnapshot(docKey);
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  private notifyCollection(collection: string): void {
    const listeners = this.collectionListeners.get(collection);
    if (!listeners) return;
    const snapshots = this.getCollectionSnapshots(collection);
    for (const listener of listeners) {
      listener(snapshots);
    }
  }

  updateLogger(logger?: ILogger): void {
    if (logger) {
      this.logger = logger;
    }
  }
}

const resolveHubRegistry = (): Map<string, BroadcastChannelRealtimeHub> => {
  const globalScope = globalThis as {
    __v2BroadcastChannelRealtimeRegistry?: Map<string, BroadcastChannelRealtimeHub>;
  };
  if (!globalScope.__v2BroadcastChannelRealtimeRegistry) {
    globalScope.__v2BroadcastChannelRealtimeRegistry = new Map();
  }
  return globalScope.__v2BroadcastChannelRealtimeRegistry;
};

export const getBroadcastChannelRealtimeHub = (
  channelName = defaultChannelName,
  logger?: ILogger
): Result<BroadcastChannelRealtimeHub, string> => {
  const registry = resolveHubRegistry();
  const existing = registry.get(channelName);
  if (existing) {
    existing.updateLogger(logger);
    return ok(existing);
  }
  return BroadcastChannelRealtimeHub.resolve(channelName, logger).map((hub) => {
    registry.set(channelName, hub);
    return hub;
  });
};

export const broadcastChannelDefaults = {
  channelName: defaultChannelName,
};
