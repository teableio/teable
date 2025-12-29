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
    return existing;
  }
  const socket = new WebSocket(url);
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

    const updateSnapshot = () => {
      if (!isActive) return;
      setState({ status: 'ready', data: doc.data ?? null, error: null });
    };

    const handleError = (error: unknown) => {
      if (!isActive) return;
      setState({ status: 'error', data: null, error: toErrorMessage(error) });
    };

    doc.subscribe((error) => {
      if (error) {
        handleError(error);
        return;
      }
      updateSnapshot();
    });

    const onConnectionError = (error: unknown) => {
      handleError(error);
    };

    connection.on('error', onConnectionError);
    doc.on('create', updateSnapshot);
    doc.on('op', updateSnapshot);
    doc.on('del', updateSnapshot);

    return () => {
      isActive = false;
      connection.removeListener('error', onConnectionError);
      doc.removeListener('create', updateSnapshot);
      doc.removeListener('op', updateSnapshot);
      doc.removeListener('del', updateSnapshot);
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
    data: [],
    ids: [],
    removedIds: [],
    error: null,
  });
  const previousIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !collection) {
      previousIdsRef.current = new Set();
      setState({ status: 'idle', data: [], ids: [], removedIds: [], error: null });
      return;
    }

    const wsUrl = resolveShareDbUrl(url);
    if (!wsUrl) return;

    let isActive = true;
    previousIdsRef.current = new Set();
    const shared = acquireConnection(wsUrl);
    const connection = shared.connection;
    const subscribeQuery = connection.createSubscribeQuery<T>(collection, queryValue) as Query<T>;

    setState((prev) => ({ ...prev, status: 'connecting', error: null }));

    const docListeners = new Map<Doc<T>, () => void>();

    const attachDocListener = (doc: Doc<T>) => {
      if (docListeners.has(doc)) return;
      const handler = () => updateResults();
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

    const updateResults = () => {
      if (!isActive) return;
      const docFilter = filter ?? ((doc: Doc<T>) => Boolean(doc.type) && doc.data != null);
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
      setState({ status: 'ready', data: results, ids, removedIds, error: null });
    };

    const handleError = (error: unknown) => {
      if (!isActive) return;
      previousIdsRef.current = new Set();
      setState({
        status: 'error',
        data: [],
        ids: [],
        removedIds: [],
        error: toErrorMessage(error),
      });
    };

    subscribeQuery.on('ready', updateResults);
    subscribeQuery.on('changed', updateResults);
    subscribeQuery.on('error', handleError);

    return () => {
      isActive = false;
      subscribeQuery.removeListener('ready', updateResults);
      subscribeQuery.removeListener('changed', updateResults);
      subscribeQuery.removeListener('error', handleError);
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
