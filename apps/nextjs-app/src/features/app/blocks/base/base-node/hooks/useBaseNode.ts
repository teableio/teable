import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBaseNodeChannel } from '@teable/core';
import type { IBaseNodeTreeVo, IBaseNodeVo } from '@teable/openapi';
import { BaseNodeResourceType, getBaseNodeTree } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useConnection } from '@teable/sdk/hooks';
import { isEmpty, get } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildTreeItems, hasChildrenNode } from './helper';

export type TreeItemData = Omit<IBaseNodeVo, 'children'> & { children: string[] };

export const useBaseNode = (baseId: string, isRestrictedAuthority?: boolean) => {
  const { connection } = useConnection();
  const channel = getBaseNodeChannel(baseId);
  const presence = connection?.getPresence(channel);
  const [nodes, setNodes] = useState<IBaseNodeVo[]>([]);
  const queryClient = useQueryClient();

  // Initialize treeItems from cache to avoid flash of empty state on remount
  const [treeItems, setTreeItems] = useState<Record<string, TreeItemData>>(() => {
    const cachedData = queryClient.getQueryData<IBaseNodeTreeVo>(
      ReactQueryKeys.baseNodeTree(baseId)
    );
    if (cachedData?.nodes && cachedData.nodes.length > 0) {
      return buildTreeItems(cachedData.nodes);
    }
    return {};
  });

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
      setTreeItems(
        buildTreeItems(
          isRestrictedAuthority
            ? nodes.filter((node) => {
                if (node.resourceType === BaseNodeResourceType.Folder) {
                  return hasChildrenNode(node.id, nodes);
                }
                return true;
              })
            : nodes
        )
      );
    } else {
      setTreeItems({});
    }
  }, [nodes, setTreeItems, isRestrictedAuthority]);

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
          invalidateMenu();
        }
      }
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence?.removeListener('receive', receiveHandler);
      presence?.listenerCount('receive') === 0 && presence?.unsubscribe();
      presence?.listenerCount('receive') === 0 && presence?.destroy();
    };
  }, [connection, presence, channel, setNodes, invalidateMenu]);

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
