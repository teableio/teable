import { useEffect, useMemo, useState } from 'react';

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
  data: ReadonlyArray<T>;
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
      setState({ status: 'error', data: null, error: hubResult.error });
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
}): BroadcastChannelQueryState<T> => {
  const { collection, enabled = true } = params;
  const [state, setState] = useState<BroadcastChannelQueryState<T>>({
    status: 'idle',
    data: [],
    error: null,
  });

  useEffect(() => {
    if (!enabled || !collection) {
      setState({ status: 'idle', data: [], error: null });
      return;
    }

    const hubResult = getBroadcastChannelRealtimeHub(resolveChannelName());
    if (hubResult.isErr()) {
      setState({ status: 'error', data: [], error: hubResult.error });
      return;
    }

    const hub = hubResult.value;
    const unsubscribe = hub.subscribeCollection(collection, (snapshots) => {
      setState({ status: 'ready', data: snapshots as ReadonlyArray<T>, error: null });
    });

    return () => {
      unsubscribe();
    };
  }, [collection, enabled]);

  return state;
};
