import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBaseNodeChannel } from '@teable/core';
import type { IBaseNodeVo } from '@teable/openapi';
import { getBaseNodeTree } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useConnection } from '@teable/sdk/hooks';
import { isEmpty, get } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounce } from 'react-use';
import { buildTreeItems } from './helper';

export type TreeItemData = Omit<IBaseNodeVo, 'children'> & { children: string[] };

export const useBaseNode = (baseId: string) => {
  const { connection } = useConnection();
  const channel = getBaseNodeChannel(baseId);
  const presence = connection?.getPresence(channel);
  const [nodes, setNodes] = useState<IBaseNodeVo[]>([]);
  const [treeItems, setTreeItems] = useState<Record<string, TreeItemData>>({});
  const [shouldInvalidate, setShouldInvalidate] = useState(0);

  const queryClient = useQueryClient();
  const { data: queryData, isLoading } = useQuery({
    queryKey: ReactQueryKeys.baseNodeTree(baseId),
    queryFn: ({ queryKey }) => getBaseNodeTree(queryKey[1]).then((res) => res.data),
    enabled: Boolean(baseId),
  });

  const invalidateMenu = useCallback(() => {
    if (baseId) {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseNodeTree(baseId) });
    }
  }, [baseId, queryClient]);

  useDebounce(
    () => {
      if (shouldInvalidate > 0) {
        invalidateMenu();
      }
    },
    500,
    [shouldInvalidate]
  );

  const maxFolderDepth = useMemo(() => {
    return queryData?.maxFolderDepth ?? 2;
  }, [queryData?.maxFolderDepth]);

  useEffect(() => {
    if (queryData?.nodes) {
      setNodes(queryData?.nodes);
    }
  }, [queryData?.nodes, setNodes]);

  useEffect(() => {
    if (nodes.length > 0) {
      setTreeItems(buildTreeItems(nodes));
    } else {
      setTreeItems({});
    }
  }, [nodes, setTreeItems]);

  useEffect(() => {
    if (!presence || !channel) {
      return;
    }

    if (presence.subscribed) {
      return;
    }

    presence.subscribe();

    const receiveHandler = () => {
      const { remotePresences } = presence;
      if (!isEmpty(remotePresences)) {
        const remotePayload = get(remotePresences, channel);
        if (remotePayload) {
          setShouldInvalidate((prev) => prev + 1);
        }
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [connection, presence, channel, setNodes]);

  return useMemo(() => {
    return {
      isLoading,
      maxFolderDepth,
      treeItems,
      setTreeItems,
      invalidateMenu,
    };
  }, [isLoading, maxFolderDepth, treeItems, setTreeItems, invalidateMenu]);
};
