import { useQueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useEffect } from 'react';

const CHANNEL_NAME = 'teable-cross-window-sync';

interface ISyncMessage {
  type: 'table-moved';
  fromBaseId: string;
  toBaseId: string;
  tableId: string;
}

// Broadcast channel singleton (created lazily)
let broadcastChannel: BroadcastChannel | null = null;

const getChannel = (): BroadcastChannel | null => {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    return null;
  }
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  }
  return broadcastChannel;
};

/**
 * Broadcast a table move event to other windows
 */
export const broadcastTableMoved = (
  fromBaseId: string,
  toBaseId: string,
  tableId: string
): void => {
  const channel = getChannel();
  if (!channel) return;

  const message: ISyncMessage = {
    type: 'table-moved',
    fromBaseId,
    toBaseId,
    tableId,
  };

  // eslint-disable-next-line no-console
  console.log('[CrossWindowSync] Broadcasting table-moved:', message);
  channel.postMessage(message);
};

/**
 * Hook to listen for cross-window sync messages and refresh data accordingly
 */
export const useCrossWindowSync = (baseId: string): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = getChannel();
    if (!channel) return;

    const handleMessage = (event: MessageEvent<ISyncMessage>) => {
      const message = event.data;

      // eslint-disable-next-line no-console
      console.log('[CrossWindowSync] Received message:', message);

      // If the current base was the source or target, refresh data
      if (
        message.type === 'table-moved' &&
        (message.fromBaseId === baseId || message.toBaseId === baseId)
      ) {
        // eslint-disable-next-line no-console
        console.log('[CrossWindowSync] Refreshing data for base:', baseId);

        queryClient.invalidateQueries({
          queryKey: ReactQueryKeys.tableList(baseId),
        });
        queryClient.invalidateQueries({
          queryKey: ReactQueryKeys.baseNodeTree(baseId),
        });
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
    };
  }, [baseId, queryClient]);
};
