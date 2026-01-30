import type { UrlObject } from 'url';
import { Table2 } from '@teable/icons';
import type { IBaseNodeResourceMeta, IBaseNodeVo } from '@teable/openapi';
import { BaseNodeResourceType, LastVisitResourceType, ResourceType } from '@teable/openapi';
import { keyBy } from 'lodash';
import { AppWindowMacIcon, BotIcon, CircleGaugeIcon, FolderClosedIcon } from 'lucide-react';
import type { TreeItemData } from './useBaseNode';

type TreeRootItem = {
  id: typeof ROOT_ID;
  resourceType: BaseNodeResourceType.Folder;
  resourceId: typeof ROOT_ID;
  resourceMeta: IBaseNodeResourceMeta;
  children: string[];
};

export const ROOT_ID = '__root__';

export const BaseNodeResourceIconMap = {
  [BaseNodeResourceType.Folder]: FolderClosedIcon,
  [BaseNodeResourceType.Dashboard]: CircleGaugeIcon,
  [BaseNodeResourceType.Workflow]: BotIcon,
  [BaseNodeResourceType.App]: AppWindowMacIcon,
  [BaseNodeResourceType.Table]: Table2,
};

export const BaseNodeResourceLastVisitMap = {
  [BaseNodeResourceType.Table]: LastVisitResourceType.Table,
  [BaseNodeResourceType.Dashboard]: LastVisitResourceType.Dashboard,
  [BaseNodeResourceType.Workflow]: LastVisitResourceType.Workflow,
  [BaseNodeResourceType.App]: LastVisitResourceType.App,
};

export const getNodeName = (node: { resourceMeta?: IBaseNodeResourceMeta }): string => {
  return node.resourceMeta?.name ?? '';
};

export const getNodeIcon = (node: {
  resourceMeta?: IBaseNodeResourceMeta;
}): string | null | undefined => {
  return node.resourceMeta?.icon;
};

export const getNodeUrl = (props: {
  baseId: string;
  resourceType: string;
  resourceId: string;
  viewId?: string | null;
}): UrlObject | null => {
  const { baseId, resourceId, resourceType, viewId } = props;
  switch (resourceType) {
    case ResourceType.Table:
      if (viewId) {
        return {
          pathname: `/base/${baseId}/table/${resourceId}/${viewId}`,
        };
      }
      return {
        pathname: `/base/${baseId}/table/${resourceId}`,
      };
    case ResourceType.Dashboard:
      return {
        pathname: `/base/${baseId}/dashboard/${resourceId}`,
      };
    case ResourceType.Workflow:
      return {
        pathname: `/base/${baseId}/automation/${resourceId}`,
      };
    case ResourceType.App:
      return {
        pathname: `/base/${baseId}/app/${resourceId}`,
      };
    case ResourceType.Base:
      return {
        pathname: `/base/${resourceId}`,
      };
    default:
      return null;
  }
};

export const parseNodeUrl = (props: {
  baseId: string;
  url: string;
  urlParams: {
    dashboardId?: string;
    automationId?: string;
    appId?: string;
    tableId?: string;
  };
}) => {
  const { baseId, url, urlParams } = props;
  const { dashboardId, automationId, appId, tableId } = urlParams;
  if (url.includes(`/base/${baseId}/dashboard/${dashboardId}`)) {
    return {
      resourceType: BaseNodeResourceType.Dashboard,
      resourceId: dashboardId,
    };
  }
  if (url.includes(`/base/${baseId}/automation/${automationId}`)) {
    return {
      resourceType: BaseNodeResourceType.Workflow,
      resourceId: automationId,
    };
  }
  if (url.includes(`/base/${baseId}/app/${appId}`)) {
    return {
      resourceType: BaseNodeResourceType.App,
      resourceId: appId,
    };
  }
  if (url.includes(`/base/${baseId}/table/${tableId}`)) {
    return {
      resourceType: BaseNodeResourceType.Table,
      resourceId: tableId,
    };
  }
  return null;
};

export const cleanParentId = (parentId?: string | null) => {
  if (parentId === ROOT_ID) {
    return null;
  }
  return parentId;
};

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

export const buildTreeItems = (nodes: IBaseNodeVo[]): Record<string, TreeItemData> => {
  const nodeMap = keyBy(nodes, 'id');
  const cleanedNodes = cleanNodes(nodes, nodeMap);
  const result: Record<string, TreeRootItem | TreeItemData> = {
    [ROOT_ID]: {
      id: ROOT_ID,
      resourceType: BaseNodeResourceType.Folder,
      resourceId: ROOT_ID,
      resourceMeta: {
        name: 'baseMenuRoot',
      },
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

/**
 * Find adjacent non-folder node after deletion using alternating below/above traversal.
 * This matches the exact behavior of BaseNodeTree's deleteSuccefulyCallback.
 *
 * Uses depth-first traversal order (visual tree order):
 * - getItemBelow: first child > next sibling > parent's next sibling
 * - getItemAbove: previous sibling's last descendant > parent
 *
 * Note: Assumes treeItems is already validated by buildTreeItems/cleanNodes.
 */
export const findAdjacentNonFolderNode = (
  treeItems: Record<string, TreeItemData>,
  currentNodeId: string
  // eslint-disable-next-line sonarjs/cognitive-complexity
): TreeItemData | null => {
  const isFolder = (nodeId: string) =>
    treeItems[nodeId]?.resourceType === BaseNodeResourceType.Folder;

  /**
   * Get the next node in depth-first (visual) order
   * Order: first child > next sibling > parent's next sibling (recursive)
   */
  const getItemBelow = (nodeId: string): string | null => {
    const node = treeItems[nodeId];
    if (!node) return null;

    // 1. If has children, return first child
    if (node.children.length > 0) {
      return node.children[0];
    }

    // 2. Find next sibling or ancestor's next sibling
    let currentId: string | null = nodeId;
    let levels = 0;

    while (currentId && levels < 100) {
      const current: TreeItemData | undefined = treeItems[currentId];
      if (!current) return null;

      const parentId: string = current.parentId ?? ROOT_ID;
      const parent: TreeItemData | undefined = treeItems[parentId];
      if (!parent) return null;

      const currentIndex = parent.children.indexOf(currentId);

      // If has next sibling, return it
      if (currentIndex >= 0 && currentIndex < parent.children.length - 1) {
        return parent.children[currentIndex + 1];
      }

      // Go up to parent and continue searching
      if (parentId === ROOT_ID) return null;
      currentId = parentId;
      levels++;
    }

    return null;
  };

  /**
   * Get the previous node in depth-first (visual) order
   * Order: previous sibling's last descendant > parent
   */
  const getItemAbove = (nodeId: string): string | null => {
    const node = treeItems[nodeId];
    if (!node) return null;

    const parentId = node.parentId ?? ROOT_ID;
    const parent = treeItems[parentId];
    if (!parent) return null;

    const currentIndex = parent.children.indexOf(nodeId);

    // 1. If has previous sibling, return its last descendant
    if (currentIndex > 0) {
      const prevSiblingId = parent.children[currentIndex - 1];
      return getLastDescendant(prevSiblingId);
    }

    // 2. Return parent (if not root)
    if (parentId === ROOT_ID) return null;
    return parentId;
  };

  /**
   * Get the last descendant of a node (depth-first, rightmost)
   */
  const getLastDescendant = (nodeId: string, depth = 0): string => {
    // Depth limit as safety net (tree shouldn't be deeper than reasonable limit)
    if (depth > 100) return nodeId;

    const node = treeItems[nodeId];
    if (!node || node.children.length === 0) return nodeId;

    const lastChildId = node.children[node.children.length - 1];
    return getLastDescendant(lastChildId, depth + 1);
  };

  // Alternating search: below first, then above, repeat
  // visited set prevents revisiting nodes in case of data anomalies
  const visited = new Set<string>([currentNodeId]);
  let belowId: string | null = currentNodeId;
  let aboveId: string | null = currentNodeId;

  while (belowId || aboveId) {
    // Try below first
    if (belowId) {
      belowId = getItemBelow(belowId);
      if (belowId && !visited.has(belowId)) {
        visited.add(belowId);
        if (!isFolder(belowId)) {
          return treeItems[belowId];
        }
      } else {
        belowId = null; // Stop this direction
      }
    }

    // Then try above
    if (aboveId) {
      aboveId = getItemAbove(aboveId);
      if (aboveId && !visited.has(aboveId)) {
        visited.add(aboveId);
        if (!isFolder(aboveId)) {
          return treeItems[aboveId];
        }
      } else {
        aboveId = null; // Stop this direction
      }
    }
  }

  return null;
};

export const hasChildrenNode = (parentId: string, nodes: IBaseNodeVo[]): boolean => {
  const parentNode = nodes.find((node) => node.id === parentId);
  if (!parentNode) return false;

  // Check if parent has any children
  if (!parentNode.children || parentNode.children.length === 0) {
    return false;
  }

  // Check each child node
  for (const child of parentNode.children) {
    const childNode = nodes.find((node) => node.id === child.id);
    if (!childNode) continue;

    // If child is not a folder, we found a non-folder node
    if (childNode.resourceType !== BaseNodeResourceType.Folder) {
      return true;
    }

    // If child is a folder, recursively check if it has non-folder children
    if (hasChildrenNode(childNode.id, nodes)) {
      return true;
    }
  }

  return false;
};

export const getChildrenNodes = (parentId: string, nodes: IBaseNodeVo[]): IBaseNodeVo[] => {
  const parentNode = nodes.find((node) => node.id === parentId);
  if (!parentNode) return [];
  const children = [];
  for (const child of parentNode.children ?? []) {
    const childNode = nodes.find((node) => node.id === child.id);
    if (!childNode) continue;
    if (childNode.children && childNode.children.length > 0) {
      children.push(...getChildrenNodes(childNode.id, nodes));
    }
    if (childNode.resourceType === BaseNodeResourceType.Folder) {
      continue;
    }
    children.push(childNode);
  }
  return children;
};
