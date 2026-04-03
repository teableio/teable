import { FieldKeyType, IdPrefix, type IRecord, getActionTriggerChannel } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { getRecords } from '@teable/openapi';
import { isEqual } from 'lodash';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Doc, Query } from 'sharedb/lib/client';
import type { Presence } from 'sharedb/lib/sharedb';
import { useConnection } from '../../hooks/use-connection';
import { OpListenersManager } from './opListener';
import type { IInstanceAction, IInstanceState } from './reducer';
import { instanceReducer } from './reducer';

export interface IUseInstancesProps<T, R> {
  collection: string;
  initData?: T[];
  factory: (data: T, doc?: Doc<T>) => R;
  queryParams: unknown;
}

const queryDestroy = (query: Query | undefined, cb?: () => void) => {
  if (!query) {
    return;
  }
  if (!query.sent || query.ready) {
    query?.destroy(() => {
      query.removeAllListeners();
      cb?.();
      query.results?.forEach((doc) => doc.listenerCount('op batch') === 0 && doc.destroy());
    });
    return;
  }
  query.once('ready', () => {
    query.destroy(() => {
      query.removeAllListeners();
      cb?.();
      query.results?.forEach((doc) => doc.listenerCount('op batch') === 0 && doc.destroy());
    });
  });
};

// Global cache to dedupe identical subscribe queries across hook instances
type CachedQuery = { query: Query; refCount: number };
const subscribeQueryCache = new Map<string, CachedQuery>();

type ActionTriggerPayload = {
  tableId?: string;
  fieldIds?: unknown;
  field?: unknown;
  recordIds?: unknown;
  skipRealtime?: unknown;
};

type ActionTrigger = {
  actionKey?: string;
  payload?: ActionTriggerPayload;
};

type ActionTriggerFieldPayload = {
  id?: unknown;
  updatedProperties?: unknown;
  options?: unknown;
  dbFieldType?: unknown;
  type?: unknown;
};

type DeleteRecordActionPayload = ActionTriggerPayload & {
  tableId: string;
  recordIds: string[];
  skipRealtime: true;
};

type LargeProjectedMutationPayload = ActionTriggerPayload & {
  tableId: string;
  skipRealtime: true;
  totalChunkCount?: number;
  chunkIndex?: number;
};

const schemaRefreshFieldProperties = new Set([
  'type',
  'options',
  'expression',
  'lookupOptions',
  'rollupConfig',
  'linkConfig',
  'linkRelationship',
]);

// Normalize query params into a stable, comparable string key
// - Sort object keys recursively
// - Convert Set to sorted array
// - Leave arrays and primitives as-is (arrays keep order)
// This is intentionally minimal for typical query param shapes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeForKey = (value: any): any => {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(normalizeForKey);
  if (value instanceof Set) return Array.from(value).sort();
  if (value instanceof Map)
    return Array.from(value.entries())
      .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
      .map(([k, v]) => [k, normalizeForKey(v)]);
  if (typeof value === 'object' && value.constructor === Object) {
    const sortedKeys = Object.keys(value).sort();
    const res: Record<string, unknown> = {};
    for (const k of sortedKeys) res[k] = normalizeForKey(value[k]);
    return res;
  }
  return value;
};

const makeQueryScopeKey = (collection: string, queryParams: unknown) =>
  `${collection}|${JSON.stringify(normalizeForKey(queryParams))}`;

const makeQueryKey = (collection: string, queryParams: unknown, refreshToken = 0) =>
  `${makeQueryScopeKey(collection, queryParams)}|refresh:${refreshToken}`;

const acquireQuery = <T>(
  collection: string,
  connection: ReturnType<typeof useConnection>['connection'],
  queryParams: unknown,
  refreshToken = 0
) => {
  const key = makeQueryKey(collection, queryParams, refreshToken);
  const cached = subscribeQueryCache.get(key);
  if (cached) {
    cached.refCount += 1;
    return { key, query: cached.query };
  }
  const query = connection!.createSubscribeQuery<T>(collection, queryParams);
  subscribeQueryCache.set(key, { query, refCount: 1 });
  return { key, query };
};

const releaseQuery = (key?: string, cb?: () => void) => {
  if (!key) return;
  const cached = subscribeQueryCache.get(key);
  if (!cached) return;
  cached.refCount -= 1;
  if (cached.refCount <= 0) {
    subscribeQueryCache.delete(key);
    queryDestroy(cached.query, cb);
    return;
  }
  cb?.();
};

const getSchemaRefreshCollectionTableId = (collection: string): string | undefined => {
  const [prefix, tableId] = collection.split('_');
  if (
    (prefix !== IdPrefix.Record && prefix !== IdPrefix.Field && prefix !== IdPrefix.View) ||
    !tableId
  ) {
    return undefined;
  }
  return tableId;
};

const hasSchemaRefreshFieldIds = (fieldIds: unknown): boolean =>
  Array.isArray(fieldIds) && fieldIds.length > 0;

const isRecordCollection = (collection: string) => collection.startsWith(`${IdPrefix.Record}_`);

const notifyProjectedRecordDocUpdate = <T>(
  doc: Doc<T>,
  dispatch: (action: IInstanceAction<T>) => void
) => {
  const opBatchListenerCount = doc.listenerCount?.('op batch') ?? 0;

  if (opBatchListenerCount > 0 && typeof (doc as Doc<T> & { emit?: unknown }).emit === 'function') {
    (doc as Doc<T> & { emit: (event: string, payload: unknown[], source?: boolean) => void }).emit(
      'op batch',
      [],
      false
    );
  }

  dispatch({ type: 'update', doc });
};

const collectActionPayloadFieldIds = (
  payload: ActionTriggerPayload | undefined,
  fieldIds: Set<string>
) => {
  if (!payload) {
    return;
  }

  if (Array.isArray(payload.fieldIds)) {
    payload.fieldIds.forEach((fieldId) => {
      if (typeof fieldId === 'string' && fieldId.length > 0) {
        fieldIds.add(fieldId);
      }
    });
  }

  const field = payload.field;
  if (field instanceof Object && typeof (field as ActionTriggerFieldPayload).id === 'string') {
    fieldIds.add((field as ActionTriggerFieldPayload).id as string);
  }
};

const getSchemaRefreshRecordFieldIds = (tableId: string, batch: unknown): string[] | undefined => {
  if (!Array.isArray(batch)) {
    return undefined;
  }

  const fieldIds = new Set<string>();

  for (const item of batch) {
    if (!(item instanceof Object)) {
      return undefined;
    }

    const action = item as ActionTrigger;
    if (action.actionKey !== 'setField') {
      return undefined;
    }

    if (action.payload?.tableId !== tableId) {
      return undefined;
    }

    collectActionPayloadFieldIds(action.payload, fieldIds);
  }

  return fieldIds.size ? Array.from(fieldIds) : undefined;
};

const isSchemaRefreshFieldPayload = (field: unknown): boolean => {
  if (!(field instanceof Object)) {
    return false;
  }

  const actionField = field as ActionTriggerFieldPayload;
  if (typeof actionField.id !== 'string' || actionField.id.length === 0) {
    return false;
  }

  if (Array.isArray(actionField.updatedProperties)) {
    return actionField.updatedProperties.some(
      (property) => typeof property === 'string' && schemaRefreshFieldProperties.has(property)
    );
  }

  // Legacy V1 payloads do not expose updatedProperties; fall back to changed shape keys.
  return actionField.options !== undefined || actionField.dbFieldType !== undefined;
};

const isSchemaRefreshAction = (tableId: string, batch: unknown): boolean => {
  if (!Array.isArray(batch)) {
    return false;
  }

  return batch.some((item) => {
    if (!(item instanceof Object)) {
      return false;
    }

    const action = item as ActionTrigger;
    if (action.actionKey !== 'setRecord' && action.actionKey !== 'setField') {
      return false;
    }

    const payload = action.payload;
    if (payload?.tableId !== tableId) {
      return false;
    }

    if (action.actionKey === 'setRecord') {
      return hasSchemaRefreshFieldIds(payload?.fieldIds);
    }

    if (action.actionKey === 'setField') {
      return (
        hasSchemaRefreshFieldIds(payload?.fieldIds) || isSchemaRefreshFieldPayload(payload?.field)
      );
    }

    return false;
  });
};

const toDeleteRecordActionPayload = (
  tableId: string,
  payload: ActionTriggerPayload | undefined
): DeleteRecordActionPayload | undefined => {
  if (payload?.tableId !== tableId || payload?.skipRealtime !== true) {
    return undefined;
  }

  if (!Array.isArray(payload.recordIds)) {
    return undefined;
  }

  const recordIds = payload.recordIds.filter(
    (recordId): recordId is string => typeof recordId === 'string' && recordId.length > 0
  );

  if (!recordIds.length) {
    return undefined;
  }

  return {
    ...payload,
    tableId,
    recordIds,
    skipRealtime: true,
  };
};

const getProjectedDeleteRecordIds = (tableId: string, batch: unknown): string[] | undefined => {
  if (!Array.isArray(batch)) {
    return undefined;
  }

  const deletedIds = new Set<string>();

  for (const item of batch) {
    if (!(item instanceof Object)) {
      continue;
    }

    const action = item as ActionTrigger;
    if (action.actionKey !== 'deleteRecord') {
      continue;
    }

    const payload = toDeleteRecordActionPayload(tableId, action.payload);
    if (!payload) {
      continue;
    }

    for (const recordId of payload.recordIds) {
      deletedIds.add(recordId);
    }
  }

  return deletedIds.size ? [...deletedIds] : undefined;
};

const toLargeProjectedMutationPayload = (
  tableId: string,
  payload: ActionTriggerPayload | undefined
): LargeProjectedMutationPayload | undefined => {
  if (payload?.tableId !== tableId || payload?.skipRealtime !== true) {
    return undefined;
  }

  return {
    ...payload,
    tableId,
    skipRealtime: true,
  };
};

const shouldRefreshAfterProjectedMutation = (
  tableId: string,
  batch: unknown,
  actionKey: 'setRecord' | 'addRecord'
) => {
  if (!Array.isArray(batch)) {
    return false;
  }

  for (const item of batch) {
    if (!(item instanceof Object)) {
      continue;
    }

    const action = item as ActionTrigger;
    if (action.actionKey !== actionKey) {
      continue;
    }

    const payload = toLargeProjectedMutationPayload(tableId, action.payload);
    if (!payload) {
      continue;
    }

    if (
      typeof payload.chunkIndex === 'number' &&
      typeof payload.totalChunkCount === 'number' &&
      payload.totalChunkCount > 0
    ) {
      if (payload.chunkIndex === payload.totalChunkCount - 1) {
        return true;
      }
      continue;
    }

    return true;
  }

  return false;
};

/**
 * Manage instances of a collection, auto subscribe the update and change event, auto create instance,
 * keep every instance the latest data
 * @returns instance[]
 */
export function useInstances<T, R extends { id: string }>({
  collection,
  factory,
  queryParams,
  initData,
}: IUseInstancesProps<T, R>): IInstanceState<R> {
  const { connection, connected } = useConnection();
  const schemaRefreshCollectionTableId = getSchemaRefreshCollectionTableId(collection);
  const [query, setQuery] = useState<Query<T>>();
  const [schemaRefreshToken, setSchemaRefreshToken] = useState(0);
  const currentKeyRef = useRef<string>();
  const currentScopeKeyRef = useRef<string>();
  const [instances, dispatch] = useReducer(
    (state: IInstanceState<R>, action: IInstanceAction<T>) =>
      instanceReducer(state, action, factory),
    {
      instances: initData && !connected ? initData.map((data) => factory(data)) : [],
      extra: undefined,
    }
  );
  const opListeners = useRef<OpListenersManager<T>>(new OpListenersManager<T>(collection));
  const preQueryRef = useRef<Query<T>>();
  const lastConnectionRef = useRef<typeof connection>();
  const projectedRefreshSeqRef = useRef(0);

  const refreshProjectedRecordFields = useCallback(
    async (fieldIds: string[]) => {
      if (!schemaRefreshCollectionTableId || !isRecordCollection(collection)) {
        return false;
      }

      const currentDocs = (preQueryRef.current?.results ?? []) as Doc<IRecord>[];
      const currentDocIds = currentDocs.map((doc) => doc.id);
      const refreshSeq = ++projectedRefreshSeqRef.current;

      const { type: _type, ...restQueryParams } = (queryParams ?? {}) as Record<string, unknown>;

      try {
        const { data } = await getRecords(schemaRefreshCollectionTableId, {
          ...(restQueryParams as IGetRecordsRo),
          fieldKeyType: FieldKeyType.Id,
          projection: fieldIds,
        });

        if (refreshSeq !== projectedRefreshSeqRef.current) {
          return true;
        }

        const fetchedRecords = data.records ?? [];
        const fetchedRecordIds = fetchedRecords.map((record) => record.id);

        if (
          currentDocIds.length !== fetchedRecordIds.length ||
          currentDocIds.some((id, index) => id !== fetchedRecordIds[index])
        ) {
          return false;
        }

        const fetchedRecordMap = new Map(fetchedRecords.map((record) => [record.id, record]));
        const changedDocs: Doc<T>[] = [];

        currentDocs.forEach((doc) => {
          const fetchedRecord = fetchedRecordMap.get(doc.id);
          if (!fetchedRecord) {
            return;
          }

          let changed = false;
          const docFields = doc.data.fields ?? {};
          const nextFields = fetchedRecord.fields ?? {};

          fieldIds.forEach((fieldId) => {
            const currentValue = docFields[fieldId];
            const nextValue = nextFields[fieldId];

            if (isEqual(currentValue, nextValue)) {
              return;
            }

            changed = true;
            doc.data.fields ??= {};
            if (nextValue === undefined) {
              delete doc.data.fields[fieldId];
            } else {
              doc.data.fields[fieldId] = nextValue;
            }
          });

          if (changed) {
            changedDocs.push(doc as unknown as Doc<T>);
          }
        });

        changedDocs.forEach((doc) => notifyProjectedRecordDocUpdate(doc, dispatch));
        return true;
      } catch {
        return false;
      }
    },
    [collection, queryParams, schemaRefreshCollectionTableId]
  );

  const removeProjectedRecordsByIds = useCallback(
    (recordIds: string[]) => {
      if (!schemaRefreshCollectionTableId || !isRecordCollection(collection)) {
        return false;
      }

      const currentQuery = preQueryRef.current;
      const currentDocs = (currentQuery?.results ?? []) as Doc<IRecord>[];
      if (!currentDocs.length) {
        return false;
      }

      const deletedIds = new Set(recordIds);
      const docsToRemove = currentDocs.filter((doc) => deletedIds.has(doc.id));
      if (!docsToRemove.length) {
        return false;
      }

      const remainingDocs = currentDocs.filter((doc) => !deletedIds.has(doc.id));
      currentQuery!.results = remainingDocs as unknown as Doc<T>[];
      docsToRemove.forEach((doc) => opListeners.current.remove(doc as unknown as Doc<T>));
      dispatch({ type: 'removeByIds', ids: [...deletedIds] });
      return true;
    },
    [collection, schemaRefreshCollectionTableId]
  );

  useEffect(() => {
    if (!connection || !schemaRefreshCollectionTableId || !isRecordCollection(collection)) {
      return;
    }

    const presence: Presence = connection.getPresence(
      getActionTriggerChannel(schemaRefreshCollectionTableId)
    );
    if (!presence.subscribed) {
      presence.subscribe((error) => {
        if (error) {
          console.error('[useInstances] Failed to subscribe schema refresh presence:', error);
        }
      });
    }

    const receiveListener = (_id: string, batch: unknown) => {
      const deletedRecordIds = getProjectedDeleteRecordIds(schemaRefreshCollectionTableId, batch);
      if (deletedRecordIds?.length) {
        removeProjectedRecordsByIds(deletedRecordIds);
        return;
      }

      if (
        shouldRefreshAfterProjectedMutation(schemaRefreshCollectionTableId, batch, 'setRecord') ||
        shouldRefreshAfterProjectedMutation(schemaRefreshCollectionTableId, batch, 'addRecord')
      ) {
        setSchemaRefreshToken((current) => current + 1);
        return;
      }

      if (!isSchemaRefreshAction(schemaRefreshCollectionTableId, batch)) {
        return;
      }

      const fieldIds = getSchemaRefreshRecordFieldIds(schemaRefreshCollectionTableId, batch);
      if (fieldIds?.length) {
        void refreshProjectedRecordFields(fieldIds).then((handled) => {
          if (!handled) {
            setSchemaRefreshToken((current) => current + 1);
          }
        });
        return;
      }

      setSchemaRefreshToken((current) => current + 1);
    };

    presence.addListener('receive', receiveListener);

    return () => {
      presence.removeListener('receive', receiveListener);
      if (presence.listenerCount('receive') === 0) {
        presence.unsubscribe();
        presence.destroy();
      }
    };
  }, [
    collection,
    connection,
    refreshProjectedRecordFields,
    removeProjectedRecordsByIds,
    schemaRefreshCollectionTableId,
  ]);

  const handleReady = useCallback((query: Query<T>) => {
    console.log(
      `${query.collection}:ready:`,
      query.query,
      localStorage.getItem('debug') && query.results.map((doc) => doc.data)
    );
    console.log('extra ready ->', query.extra);
    if (!query.results) {
      return;
    }
    dispatch({ type: 'ready', results: query.results, extra: query.extra });
    query.results.forEach((doc) => {
      opListeners.current.add(doc, (op) => {
        console.log(`${query.collection} on op:`, op, doc);
        dispatch({ type: 'update', doc });
      });
    });
  }, []);

  const handleInsert = useCallback((docs: Doc<T>[], index: number) => {
    console.log(
      `${docs[0]?.collection}:insert:`,
      docs.map((doc) => doc.id),
      index
    );
    dispatch({ type: 'insert', docs, index });

    docs.forEach((doc) => {
      opListeners.current.add(doc, (op) => {
        console.log(`${docs[0]?.collection} on op:`, op);
        dispatch({ type: 'update', doc });
      });
    });
  }, []);

  const handleRemove = useCallback((docs: Doc<T>[], index: number) => {
    console.log(
      `${docs[0]?.collection}:remove:`,
      docs.map((doc) => doc.id),
      index
    );
    dispatch({ type: 'remove', docs, index });
    docs.forEach((doc) => {
      opListeners.current.remove(doc);
    });
  }, []);

  const handleMove = useCallback((docs: Doc<T>[], from: number, to: number) => {
    console.log(
      `${docs[0]?.collection}:move:`,
      docs.map((doc) => doc.id),
      from,
      to
    );
    dispatch({ type: 'move', docs, from, to });
  }, []);

  const handleExtra = useCallback((extra: unknown) => {
    console.log('extra', extra);
    dispatch({ type: 'extra', extra });
  }, []);

  useEffect(() => {
    let canceled = false;

    if (!collection || !connection) {
      const previousKey = currentKeyRef.current;
      currentKeyRef.current = undefined;
      currentScopeKeyRef.current = undefined;
      preQueryRef.current = undefined;
      lastConnectionRef.current = connection;
      dispatch({ type: 'clear' });
      setQuery(undefined);
      if (previousKey) {
        releaseQuery(previousKey, () => opListeners.current.clear());
      }
      return () => {
        canceled = true;
      };
    }

    // Compute normalized key and short-circuit if unchanged and connection didn't change
    const nextKey = makeQueryKey(collection, queryParams, schemaRefreshToken);
    const nextScopeKey = makeQueryScopeKey(collection, queryParams);
    const connectionChanged = lastConnectionRef.current !== connection;

    const acquireNextQuery = () => {
      if (canceled || !collection || !connection) {
        return;
      }

      const { key, query } = acquireQuery<T>(
        collection,
        connection,
        queryParams,
        schemaRefreshToken
      );
      currentKeyRef.current = key;
      currentScopeKeyRef.current = nextScopeKey;
      preQueryRef.current = query as Query<T>;
      lastConnectionRef.current = connection;
      setQuery(query as Query<T>);
    };

    if (!connectionChanged && currentKeyRef.current === nextKey && preQueryRef.current) {
      // Ensure state holds the existing query instance without re-acquiring
      setQuery((prev) => prev ?? (preQueryRef.current as Query<T>));
      return () => {
        canceled = true;
      };
    }

    const previousKey = currentKeyRef.current;
    const previousScopeKey = currentScopeKeyRef.current;
    const shouldClearInstances = connectionChanged || previousScopeKey !== nextScopeKey;
    currentKeyRef.current = undefined;
    currentScopeKeyRef.current = undefined;
    preQueryRef.current = undefined;

    if (shouldClearInstances) {
      dispatch({ type: 'clear' });
      setQuery(undefined);
    }

    if (previousKey && (connectionChanged || previousKey !== nextKey)) {
      releaseQuery(previousKey, () => {
        opListeners.current.clear();
        acquireNextQuery();
      });
    } else {
      acquireNextQuery();
    }

    return () => {
      canceled = true;
    };
  }, [connection, collection, queryParams, schemaRefreshToken]);

  useEffect(() => {
    const listeners = opListeners.current;
    return () => {
      const currentKey = currentKeyRef.current;
      if (!currentKey) {
        return;
      }
      // Reset refs so the main effect re-acquires the query after
      // React Strict Mode unmount/re-mount cycles in development.
      currentKeyRef.current = undefined;
      currentScopeKeyRef.current = undefined;
      preQueryRef.current = undefined;
      lastConnectionRef.current = undefined;
      dispatch({ type: 'clear' });
      setQuery(undefined);
      releaseQuery(currentKey, () => listeners.clear());
    };
  }, []);

  useEffect(() => {
    if (!query) {
      return;
    }

    const readyListener = () => handleReady(query);
    const changedListener = (docs: Doc<T>[]) => {
      console.log(
        `${docs[0]?.collection}:changed:`,
        docs.map((doc) => doc.id)
      );
    };

    if (query.ready) {
      readyListener();
    }

    query.on('ready', readyListener);

    query.on('changed', changedListener);

    query.on('insert', handleInsert);

    query.on('remove', handleRemove);

    query.on('move', handleMove);

    query.on('extra', handleExtra);

    return () => {
      query.removeListener('ready', readyListener);
      query.removeListener('changed', changedListener);
      query.removeListener('insert', handleInsert);
      query.removeListener('remove', handleRemove);
      query.removeListener('move', handleMove);
      query.removeListener('extra', handleExtra);
    };
  }, [query, handleInsert, handleRemove, handleMove, handleReady, handleExtra]);

  return instances;
}
