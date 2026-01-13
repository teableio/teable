import { useEffect, useMemo, useRef, useState } from 'react';
import { Connection } from 'sharedb/lib/client';
import type { Doc, Query } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';

export type ShareDbDocStatus = 'idle' | 'connecting' | 'ready' | 'error';

export type ShareDbDocState<T> = {
  status: ShareDbDocStatus;
  data: T | null;
  error: string | null;
};

export type ShareDbQueryState<T> = {
  status: ShareDbDocStatus;
  collection: string | null;
  data: ReadonlyArray<T>;
  ids: ReadonlyArray<string>;
  removedIds: ReadonlyArray<string>;
  error: string | null;
};

type SharedConnection = {
  url: string;
  socket: WebSocket;
  connection: Connection;
  refs: number;
};

const connections = new Map<string, SharedConnection>();

const resolveShareDbUrl = (url?: string): string | null => {
  if (url) return url;
  const envUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SHAREDB_URL : undefined;
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const basePort = Number(window.location.port || '0');
  const port = Number.isNaN(basePort) || basePort === 0 ? 3101 : basePort + 1;
  return `${protocol}//${host}:${port}/socket`;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'ShareDB error';
};

const acquireConnection = (url: string): SharedConnection => {
  const existing = connections.get(url);
  if (existing) {
    existing.refs += 1;
    console.log('[ShareDB] reusing existing connection', { url, refs: existing.refs });
    return existing;
  }
  console.log('[ShareDB] creating new connection', { url });
  const socket = new WebSocket(url);
  socket.onopen = () => console.log('[ShareDB] WebSocket opened', { url });
  socket.onclose = (e) =>
    console.log('[ShareDB] WebSocket closed', { url, code: e.code, reason: e.reason });
  socket.onerror = (e) => console.error('[ShareDB] WebSocket error', { url, error: e });
  socket.onmessage = (e) => console.log('[ShareDB] WebSocket message', { url, data: e.data });
  const connection = new Connection(socket as Socket);
  const shared = { url, socket, connection, refs: 1 };
  connections.set(url, shared);
  return shared;
};

const releaseConnection = (url: string): void => {
  const shared = connections.get(url);
  if (!shared) return;
  shared.refs -= 1;
  if (shared.refs > 0) return;
  shared.connection.close();
  shared.socket.close();
  connections.delete(url);
};

export const useShareDbDoc = <T>(params: {
  collection?: string;
  docId?: string;
  url?: string;
  enabled?: boolean;
}): ShareDbDocState<T> => {
  const { collection, docId, url, enabled = true } = params;
  const [state, setState] = useState<ShareDbDocState<T>>({
    status: 'idle',
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !collection || !docId) {
      setState({ status: 'idle', data: null, error: null });
      return;
    }

    const wsUrl = resolveShareDbUrl(url);
    if (!wsUrl) return;

    let isActive = true;
    const shared = acquireConnection(wsUrl);
    const connection = shared.connection;
    const doc = connection.get(collection, docId) as Doc<T>;

    setState((prev) => ({ ...prev, status: 'connecting', error: null }));

    let updatePending = false;
    let lastUpdateTime = 0;
    const UPDATE_THROTTLE_MS = 16; // ~60fps

    const updateSnapshot = (source?: string) => {
      if (!isActive) return;

      console.log(`[ShareDB] updateSnapshot called from ${source}`, {
        collection,
        docId,
        docType: doc.type,
        docData: doc.data,
        docVersion: doc.version,
      });

      const now = Date.now();
      const timeSinceLastUpdate = now - lastUpdateTime;

      // Throttle updates to prevent excessive re-renders
      if (timeSinceLastUpdate < UPDATE_THROTTLE_MS) {
        if (!updatePending) {
          updatePending = true;
          setTimeout(() => {
            updatePending = false;
            if (isActive) {
              doUpdateSnapshot();
            }
          }, UPDATE_THROTTLE_MS - timeSinceLastUpdate);
        }
        return;
      }

      doUpdateSnapshot();
    };

    const doUpdateSnapshot = () => {
      lastUpdateTime = Date.now();
      console.log('[ShareDB] doUpdateSnapshot', {
        collection,
        docId,
        data: doc.data,
      });
      setState({ status: 'ready', data: doc.data ?? null, error: null });
    };

    const handleError = (error: unknown) => {
      if (!isActive) return;
      console.error('[ShareDB] error', { collection, docId, error });
      setState({ status: 'error', data: null, error: toErrorMessage(error) });
    };

    doc.subscribe((error) => {
      console.log('[ShareDB] subscribe callback', {
        collection,
        docId,
        error,
        docType: doc.type,
        docData: doc.data,
        docVersion: doc.version,
      });
      if (error) {
        handleError(error);
        return;
      }
      updateSnapshot('subscribe');
    });

    const onConnectionError = (error: unknown) => {
      handleError(error);
    };

    connection.on('error', onConnectionError);
    doc.on('create', () => updateSnapshot('create'));
    doc.on('op', (op) => {
      console.log('[ShareDB] received op', { collection, docId, op, docData: doc.data });
      updateSnapshot('op');
    });
    doc.on('del', () => updateSnapshot('del'));

    return () => {
      isActive = false;
      connection.removeListener('error', onConnectionError);
      doc.removeListener('create', () => updateSnapshot('create'));
      doc.removeListener('op', () => updateSnapshot('op'));
      doc.removeListener('del', () => updateSnapshot('del'));
      doc.unsubscribe();
      doc.destroy();
      releaseConnection(wsUrl);
    };
  }, [collection, docId, enabled, url]);

  return state;
};

export const useShareDbQuery = <T>(params: {
  collection?: string;
  query?: unknown;
  url?: string;
  enabled?: boolean;
  filter?: (doc: Doc<T>) => boolean;
}): ShareDbQueryState<T> => {
  const { collection, query, url, enabled = true, filter } = params;
  const queryKey = useMemo(() => {
    if (query == null) return 'null';
    if (typeof query !== 'object') return String(query);
    try {
      return JSON.stringify(query);
    } catch {
      return 'unserializable';
    }
  }, [query]);
  const queryValue = useMemo(() => (query == null ? {} : query), [queryKey]);
  const [state, setState] = useState<ShareDbQueryState<T>>({
    status: 'idle',
    collection: null,
    data: [],
    ids: [],
    removedIds: [],
    error: null,
  });
  const previousIdsRef = useRef<Set<string>>(new Set());
  // Use ref to always access the latest filter function without adding it to effect dependencies
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    if (!enabled || !collection) {
      previousIdsRef.current = new Set();
      setState({
        status: 'idle',
        collection: null,
        data: [],
        ids: [],
        removedIds: [],
        error: null,
      });
      return;
    }

    const wsUrl = resolveShareDbUrl(url);
    if (!wsUrl) return;

    let isActive = true;
    previousIdsRef.current = new Set();
    const shared = acquireConnection(wsUrl);
    const connection = shared.connection;
    const subscribeQuery = connection.createSubscribeQuery<T>(collection, queryValue) as Query<T>;

    const subscribedCollection = collection;
    setState((prev) => ({
      ...prev,
      status: 'connecting',
      collection: subscribedCollection,
      error: null,
    }));

    const docListeners = new Map<Doc<T>, () => void>();

    const attachDocListener = (doc: Doc<T>) => {
      if (docListeners.has(doc)) return;
      const handler = () => {
        console.log('[ShareDB Query] doc event', {
          collection,
          docId: doc.id,
          docType: doc.type,
          docData: doc.data,
        });
        updateResults();
      };
      docListeners.set(doc, handler);
      doc.on('create', handler);
      doc.on('op', handler);
      doc.on('del', handler);
    };

    const detachDocListener = (doc: Doc<T>) => {
      const handler = docListeners.get(doc);
      if (!handler) return;
      doc.removeListener('create', handler);
      doc.removeListener('op', handler);
      doc.removeListener('del', handler);
      docListeners.delete(doc);
    };

    let updatePending = false;
    let lastUpdateTime = 0;
    const UPDATE_THROTTLE_MS = 16; // ~60fps

    const updateResults = () => {
      if (!isActive) return;

      const now = Date.now();
      const timeSinceLastUpdate = now - lastUpdateTime;

      // Throttle updates to prevent excessive re-renders
      if (timeSinceLastUpdate < UPDATE_THROTTLE_MS) {
        if (!updatePending) {
          updatePending = true;
          setTimeout(() => {
            updatePending = false;
            if (isActive) {
              doUpdateResults();
            }
          }, UPDATE_THROTTLE_MS - timeSinceLastUpdate);
        }
        return;
      }

      doUpdateResults();
    };

    const doUpdateResults = () => {
      lastUpdateTime = Date.now();
      const docFilter =
        filterRef.current ?? ((doc: Doc<T>) => Boolean(doc.type) && doc.data != null);
      const docs = subscribeQuery.results ?? [];
      const nextDocs = new Set(docs);
      for (const doc of docs) attachDocListener(doc);
      for (const doc of docListeners.keys()) {
        if (!nextDocs.has(doc)) detachDocListener(doc);
      }
      const results = docs.filter(docFilter).map((doc: Doc<T>) => doc.data as T);
      const ids = docs.map((doc) => doc.id);
      const nextIds = new Set(ids);
      const removedIds = [...previousIdsRef.current].filter((id) => !nextIds.has(id));
      previousIdsRef.current = nextIds;
      console.log('[ShareDB Query] doUpdateResults', {
        collection,
        docsCount: docs.length,
        resultsCount: results.length,
        ids,
      });
      setState({
        status: 'ready',
        collection: subscribedCollection,
        data: results,
        ids,
        removedIds,
        error: null,
      });
    };

    const handleError = (error: unknown) => {
      if (!isActive) return;
      previousIdsRef.current = new Set();
      setState({
        status: 'error',
        collection: subscribedCollection,
        data: [],
        ids: [],
        removedIds: [],
        error: toErrorMessage(error),
      });
    };

    subscribeQuery.on('ready', () => {
      console.log('[ShareDB Query] ready', {
        collection,
        resultsCount: subscribeQuery.results?.length,
      });
      updateResults();
    });
    subscribeQuery.on('changed', () => {
      console.log('[ShareDB Query] changed', {
        collection,
        resultsCount: subscribeQuery.results?.length,
      });
      updateResults();
    });
    subscribeQuery.on('error', handleError);

    return () => {
      isActive = false;
      subscribeQuery.removeAllListeners('ready');
      subscribeQuery.removeAllListeners('changed');
      subscribeQuery.removeAllListeners('error');
      for (const doc of docListeners.keys()) {
        detachDocListener(doc);
      }
      subscribeQuery.destroy();
      releaseConnection(wsUrl);
      previousIdsRef.current = new Set();
    };
  }, [collection, enabled, queryKey, queryValue, url]);

  return state;
};
