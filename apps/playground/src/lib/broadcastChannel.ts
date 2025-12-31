import { useEffect, useMemo, useRef, useState } from 'react';

import {
  broadcastChannelDefaults,
  getBroadcastChannelRealtimeHub,
} from '@teable/v2-adapter-realtime-broadcastchannel';

export type BroadcastChannelStatus = 'idle' | 'ready' | 'error';

export type BroadcastChannelDocState<T> = {
  status: BroadcastChannelStatus;
  data: T | null;
  error: string | null;
};

export type BroadcastChannelQueryState<T> = {
  status: BroadcastChannelStatus;
  collection: string | null;
  data: ReadonlyArray<T>;
  ids: ReadonlyArray<string>;
  removedIds: ReadonlyArray<string>;
  error: string | null;
};

const resolveChannelName = (): string => {
  return import.meta.env.VITE_BROADCAST_CHANNEL ?? broadcastChannelDefaults.channelName;
};

export const useBroadcastChannelDoc = <T>(params: {
  collection?: string;
  docId?: string;
  enabled?: boolean;
}): BroadcastChannelDocState<T> => {
  const { collection, docId, enabled = true } = params;
  const docKey = useMemo(() => {
    if (!collection || !docId) return null;
    return `${collection}/${docId}`;
  }, [collection, docId]);
  const [state, setState] = useState<BroadcastChannelDocState<T>>({
    status: 'idle',
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !docKey) {
      setState({ status: 'idle', data: null, error: null });
      return;
    }

    const hubResult = getBroadcastChannelRealtimeHub(resolveChannelName());
    if (hubResult.isErr()) {
      setState({ status: 'error', data: null, error: hubResult.error.message });
      return;
    }

    const hub = hubResult.value;
    const unsubscribe = hub.subscribeDoc(docKey, (snapshot) => {
      setState({ status: 'ready', data: (snapshot as T) ?? null, error: null });
    });

    return () => {
      unsubscribe();
    };
  }, [docKey, enabled]);

  return state;
};

export const useBroadcastChannelQuery = <T>(params: {
  collection?: string;
  enabled?: boolean;
  getId?: (snapshot: T) => string | null;
}): BroadcastChannelQueryState<T> => {
  const { collection, enabled = true, getId } = params;
  const [state, setState] = useState<BroadcastChannelQueryState<T>>({
    status: 'idle',
    collection: null,
    data: [],
    ids: [],
    removedIds: [],
    error: null,
  });
  const previousIdsRef = useRef<Set<string>>(new Set());

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

    const hubResult = getBroadcastChannelRealtimeHub(resolveChannelName());
    if (hubResult.isErr()) {
      previousIdsRef.current = new Set();
      setState({
        status: 'error',
        collection,
        data: [],
        ids: [],
        removedIds: [],
        error: hubResult.error.message ?? 'Unknown error',
      });
      return;
    }

    const hub = hubResult.value;
    previousIdsRef.current = new Set();
    const subscribedCollection = collection;
    const unsubscribe = hub.subscribeCollection(collection, (snapshots, removedDocIds) => {
      const data = snapshots as ReadonlyArray<T>;
      const ids =
        getId != null
          ? data.flatMap((snapshot) => {
              const id = getId(snapshot);
              return id ? [id] : [];
            })
          : data.flatMap((snapshot) => {
              if (
                snapshot &&
                typeof snapshot === 'object' &&
                'id' in snapshot &&
                typeof (snapshot as { id?: unknown }).id === 'string'
              ) {
                return [(snapshot as { id: string }).id];
              }
              return [];
            });
      const nextIds = new Set(ids);
      const diffRemovedIds = [...previousIdsRef.current].filter((id) => !nextIds.has(id));
      const normalizedRemovedIds = removedDocIds.filter((id) => !nextIds.has(id));
      const removedIds = [...new Set([...diffRemovedIds, ...normalizedRemovedIds])];
      previousIdsRef.current = nextIds;
      setState({
        status: 'ready',
        collection: subscribedCollection,
        data,
        ids,
        removedIds,
        error: null,
      });
    });

    return () => {
      unsubscribe();
      previousIdsRef.current = new Set();
    };
  }, [collection, enabled]);

  return state;
};
