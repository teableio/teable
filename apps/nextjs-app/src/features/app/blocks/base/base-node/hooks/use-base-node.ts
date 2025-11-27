import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBaseNodeChannel } from '@teable/core';
import type { IBaseNodeVo, IBaseNodePresencePayload } from '@teable/openapi';
import { BaseNodeResourceType, getBaseNodeTree } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useConnection } from '@teable/sdk/hooks';
import { isEmpty, get, keyBy } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROOT_ID } from './helper';

type TreeRootItem = { id: typeof ROOT_ID; name: string; children: string[] };
export type TreeItemData = Omit<IBaseNodeVo, 'children'> & { children: string[] };

const cleanNodes = (nodes: IBaseNodeVo[], nodeMap: Record<string, IBaseNodeVo>): IBaseNodeVo[] => {
  return nodes.map((node) => {
    let parentId = null;
    if (node.parentId) {
      const parentNode = nodeMap[node.parentId];
      if (
        parentNode?.id === node.parentId &&
        parentNode.resourceType === BaseNodeResourceType.Folder
      ) {
        parentId = node.parentId;
      } else {
        console.error(
          `base menu node ${node.id} parentId is not valid, node: ${JSON.stringify(node)}, parentNode: ${JSON.stringify(parentNode)}`
        );
      }
    }
    const originalChildren = node.children ?? [];
    let children = originalChildren;
    if (children) {
      children = children.filter((child) => nodeMap[child.id]?.id === child.id);
      if (children.length !== originalChildren.length) {
        console.error('base menu node children is not valid', node);
      }
    }
    return {
      ...node,
      parentId,
      children,
    };
  });
};

const buildTreeItems = (nodes: IBaseNodeVo[]): Record<string, TreeItemData> => {
  const nodeMap = keyBy(nodes, 'id');
  const cleanedNodes = cleanNodes(nodes, nodeMap);
  const result: Record<string, TreeRootItem | TreeItemData> = {
    [ROOT_ID]: {
      id: ROOT_ID,
      name: 'Base Menu',
      children: [],
    },
  };

  for (const node of cleanedNodes) {
    if (!node.parentId) {
      result[ROOT_ID].children.push(node.id);
    }
    result[node.id] = {
      ...node,
      children: (node.children ?? []).map((child) => child.id),
    };
  }
  return result as Record<string, TreeItemData>;
};

export const useBaseNode = () => {
  const baseId = useBaseId() as string;
  const { connection } = useConnection();
  const channel = getBaseNodeChannel(baseId);
  const presence = connection?.getPresence(channel);
  const [nodes, setNodes] = useState<IBaseNodeVo[]>([]);
  const [treeItems, setTreeItems] = useState<Record<string, TreeItemData>>({});

  const queryClient = useQueryClient();
  const { data: queryData } = useQuery({
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
      console.log('queryData?.nodes', queryData?.nodes);
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
      maxFolderDepth,
      treeItems,
      setTreeItems,
      invalidateMenu,
    };
  }, [maxFolderDepth, treeItems, setTreeItems, invalidateMenu]);
};
