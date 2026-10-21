import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBaseNodeChannel } from '@teable/core';
import type { IBaseNodeTreeVo, IBaseNodeVo } from '@teable/openapi';
import { getBaseNodeTree } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useConnection } from '@teable/sdk/hooks';
import { isEmpty, get } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildTreeItems, filterAutoHiddenFolders } from './helper';

export type TreeItemData = Omit<IBaseNodeVo, 'children'> & { children: string[] };

export const useBaseNode = (baseId: string, isRestrictedAuthority?: boolean) => {
  const { connection } = useConnection();
  const channel = getBaseNodeChannel(baseId);
  const queryClient = useQueryClient();

  // Initialize treeItems from cache to avoid flash of empty state on remount
  const [treeItems, setTreeItems] = useState<Record<string, TreeItemData>>(() => {
    const cachedData = queryClient.getQueryData<IBaseNodeTreeVo>(
      ReactQueryKeys.baseNodeTree(baseId)
    );
    if (cachedData?.nodes && cachedData.nodes.length > 0) {
      return buildTreeItems(
        isRestrictedAuthority ? filterAutoHiddenFolders(cachedData.nodes) : cachedData.nodes
      );
    }
    return {};
  });

  const {
    data: queryData,
    isLoading,
    isFetching,
    isError,
  } = useQuery({
    queryKey: ReactQueryKeys.baseNodeTree(baseId),
    queryFn: ({ queryKey }) => getBaseNodeTree(queryKey[1]).then((res) => res.data),
    enabled: Boolean(baseId),
  });

  const invalidateMenu = useCallback(() => {
    if (baseId) {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseNodeTree(baseId) });
    }
  }, [baseId, queryClient]);

  const maxFolderDepth = useMemo(() => {
    return queryData?.maxFolderDepth ?? 2;
  }, [queryData?.maxFolderDepth]);

  /** The query result the current treeItems were built from. */
  const [builtFrom, setBuiltFrom] = useState<IBaseNodeVo[] | null>(null);
  useEffect(() => {
    const nodes = queryData?.nodes;
    if (!nodes) return;
    setTreeItems(
      nodes.length > 0
        ? buildTreeItems(isRestrictedAuthority ? filterAutoHiddenFolders(nodes) : nodes)
        : {}
    );
    setBuiltFrom(nodes);
  }, [queryData?.nodes, setTreeItems, isRestrictedAuthority]);

  // The channel's presence is looked up here, not in render, and never destroyed: a destroyed
  // ShareDB presence re-subscribes fine but drops out of the connection's routing once the
  // pending unsubscribe settles, so a mount following a cleanup (Strict Mode, a project's tree
  // handed from the sidebar's provider to the page's) would listen on an orphan and never
  // hear another change. Every instance listens; the last one out unsubscribes.
  useEffect(() => {
    if (!connection || !channel) {
      return;
    }
    const presence = connection.getPresence(channel);

    const receiveHandler = () => {
      const { remotePresences } = presence;
      if (!isEmpty(remotePresences)) {
        const remotePayload = get(remotePresences, channel);
        if (remotePayload) {
          invalidateMenu();
        }
      }
    };

    presence.on('receive', receiveHandler);
    presence.subscribe();

    return () => {
      presence.removeListener('receive', receiveHandler);
      if (presence.listenerCount('receive') === 0) {
        presence.unsubscribe();
      }
    };
  }, [connection, channel, invalidateMenu]);

  // treeItems answers for the latest result once rebuilt from it; a refetch in flight or failed
  // leaves the old result standing, which is no answer.
  const isLoaded = !isFetching && !isError && builtFrom === queryData?.nodes;

  return useMemo(() => {
    return {
      isLoading,
      isLoaded,
      maxFolderDepth,
      treeItems,
      setTreeItems,
      invalidateMenu,
    };
  }, [isLoading, isLoaded, maxFolderDepth, treeItems, setTreeItems, invalidateMenu]);
};
