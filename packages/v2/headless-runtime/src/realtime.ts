import {
  RealtimeDocId,
  type DomainError,
  type IExecutionContext,
  type IRealtimeEngine,
  type RealtimeApplyChangeOptions,
  type RealtimeChange,
  type RealtimeEnsureOptions,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

type DocListener = (snapshot: unknown | undefined) => void;
type CollectionListener = (
  snapshots: ReadonlyArray<unknown>,
  removedDocIds: ReadonlyArray<string>
) => void;
type ActivityListener = (tableId: string) => void;

type DocState = {
  collection: string;
  docId: string;
  snapshot: unknown;
};

const cloneSnapshot = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return structuredClone(value);
};

const updateAtPath = (
  current: unknown,
  path: ReadonlyArray<string | number>,
  updater: (value: unknown) => unknown
): unknown => {
  if (path.length === 0) {
    return updater(current);
  }

  const [head, ...rest] = path;
  const base = Array.isArray(current)
    ? [...current]
    : typeof current === 'object' && current !== null
      ? { ...(current as Record<string, unknown>) }
      : {};
  (base as Record<string | number, unknown>)[head] = updateAtPath(
    (base as Record<string | number, unknown>)[head],
    rest,
    updater
  );
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

/**
 * In-process realtime engine for the headless runtime. It keeps the latest
 * document snapshots and exposes subscriptions; there is no cross-process
 * transport and no collaboration conflict resolution.
 */
export class LocalRealtimeEngine implements IRealtimeEngine {
  private readonly docs = new Map<string, DocState>();
  private readonly removedDocsByCollection = new Map<string, Set<string>>();
  private readonly docListeners = new Map<string, Set<DocListener>>();
  private readonly collectionListeners = new Map<string, Set<CollectionListener>>();
  private readonly activityListeners = new Set<ActivityListener>();

  async ensure(
    _context: IExecutionContext,
    docId: RealtimeDocId,
    initial: unknown,
    _options?: RealtimeEnsureOptions
  ): Promise<Result<void, DomainError>> {
    const parsed = RealtimeDocId.parse(docId);
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    const key = docId.toString();
    const { collection, docId: id } = parsed.value;
    this.docs.set(key, { collection, docId: id, snapshot: cloneSnapshot(initial) });
    this.removedDocsByCollection.get(collection)?.delete(id);
    this.notifyDoc(key, initial);
    this.notifyCollection(collection, []);
    return ok(undefined);
  }

  async applyChange(
    _context: IExecutionContext,
    docId: RealtimeDocId,
    change: RealtimeChange | ReadonlyArray<RealtimeChange>,
    _options?: RealtimeApplyChangeOptions
  ): Promise<Result<void, DomainError>> {
    const parsed = RealtimeDocId.parse(docId);
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    const key = docId.toString();
    const { collection, docId: id } = parsed.value;
    const current = this.docs.get(key) ?? { collection, docId: id, snapshot: {} };
    let snapshot = current.snapshot;
    for (const item of Array.isArray(change) ? change : [change]) {
      snapshot = applyRealtimeChange(snapshot, item);
    }
    this.docs.set(key, { collection, docId: id, snapshot });
    this.notifyDoc(key, snapshot);
    this.notifyCollection(collection, []);
    return ok(undefined);
  }

  async delete(
    _context: IExecutionContext,
    docId: RealtimeDocId
  ): Promise<Result<void, DomainError>> {
    const parsed = RealtimeDocId.parse(docId);
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    const key = docId.toString();
    const { collection, docId: id } = parsed.value;
    this.docs.delete(key);
    const removed = this.removedDocsByCollection.get(collection) ?? new Set<string>();
    removed.add(id);
    this.removedDocsByCollection.set(collection, removed);
    this.notifyDoc(key, undefined);
    this.notifyCollection(collection, [id]);
    return ok(undefined);
  }

  async invalidateCollection(
    _context: IExecutionContext,
    collection: string,
    _change: RealtimeChange
  ): Promise<Result<void, DomainError>> {
    this.notifyCollection(collection, []);
    return ok(undefined);
  }

  async notifyTableComputeActivity(
    _context: IExecutionContext,
    tableId: string
  ): Promise<Result<void, DomainError>> {
    for (const listener of this.activityListeners) {
      listener(tableId);
    }
    return ok(undefined);
  }

  getSnapshot(docId: string): unknown | undefined {
    return this.docs.get(docId)?.snapshot;
  }

  subscribeDoc(docId: string, listener: DocListener): () => void {
    const listeners = this.docListeners.get(docId) ?? new Set<DocListener>();
    listeners.add(listener);
    this.docListeners.set(docId, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  subscribeCollection(collection: string, listener: CollectionListener): () => void {
    const listeners = this.collectionListeners.get(collection) ?? new Set<CollectionListener>();
    listeners.add(listener);
    this.collectionListeners.set(collection, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  subscribeActivity(listener: ActivityListener): () => void {
    this.activityListeners.add(listener);
    return () => {
      this.activityListeners.delete(listener);
    };
  }

  private notifyDoc(docId: string, snapshot: unknown | undefined): void {
    const listeners = this.docListeners.get(docId);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  private notifyCollection(collection: string, removedDocIds: ReadonlyArray<string>): void {
    const listeners = this.collectionListeners.get(collection);
    if (!listeners) {
      return;
    }
    const snapshots = [...this.docs.values()]
      .filter((doc) => doc.collection === collection)
      .map((doc) => doc.snapshot);
    for (const listener of listeners) {
      listener(snapshots, removedDocIds);
    }
  }
}
