import { useBaseId } from '@teable/sdk/hooks';
import { useMemo } from 'react';
import { useShareNodeId } from '@/features/app/context/ShareContext';
import { BaseNodeContext } from './BaseNodeContext';
import { useBaseNode } from './hooks';
import { ROOT_ID } from './hooks/helper';

export const BaseNodeProvider: React.FC<{
  children: React.ReactNode;
  isRestrictedAuthority?: boolean;
}> = ({ children, isRestrictedAuthority }) => {
  const baseId = useBaseId() as string;
  const context = useBaseNode(baseId, isRestrictedAuthority);
  const shareNodeId = useShareNodeId();

  // Filter treeItems based on share nodeId (include the node and all its descendants)
  const filteredContext = useMemo(() => {
    if (!shareNodeId) {
      // No filtering needed
      return context;
    }

    const filteredTreeItems: typeof context.treeItems = {};

    // Helper to collect all descendant node IDs
    const collectDescendants = (nodeId: string, descendantIds: Set<string>) => {
      descendantIds.add(nodeId);
      const node = context.treeItems[nodeId];
      if (!node) return;
      for (const childId of node.children) {
        collectDescendants(childId, descendantIds);
      }
    };

    // Collect the shared node and all its descendants
    const allowedNodeIds = new Set<string>();
    collectDescendants(shareNodeId, allowedNodeIds);

    // Add all allowed nodes
    for (const nodeId of allowedNodeIds) {
      if (context.treeItems[nodeId]) {
        filteredTreeItems[nodeId] = {
          ...context.treeItems[nodeId],
          // Filter children to only include allowed nodes
          children: context.treeItems[nodeId].children.filter((childId) =>
            allowedNodeIds.has(childId)
          ),
        };
      }
    }

    // Add ROOT_ID with filtered children (only the shared node at root level)
    if (context.treeItems[ROOT_ID]) {
      filteredTreeItems[ROOT_ID] = {
        ...context.treeItems[ROOT_ID],
        children: [shareNodeId],
      };
    }

    return {
      ...context,
      treeItems: filteredTreeItems,
    };
  }, [context, shareNodeId]);

  return <BaseNodeContext.Provider value={filteredContext}>{children}</BaseNodeContext.Provider>;
};
