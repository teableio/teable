import type { UrlObject } from 'url';
import { Table2 } from '@teable/icons';
import type { IBaseNodeResourceMeta, IBaseNodeVo } from '@teable/openapi';
import { BaseNodeResourceType, LastVisitResourceType } from '@teable/openapi';
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
  [BaseNodeResourceType.Workflow]: LastVisitResourceType.Automation,
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
  resourceType: BaseNodeResourceType;
  resourceId: string;
  viewId?: string | null;
}): UrlObject | null => {
  const { baseId, resourceId, resourceType, viewId } = props;
  switch (resourceType) {
    case BaseNodeResourceType.Table:
      if (viewId) {
        return {
          pathname: `/base/${baseId}/table/${resourceId}/${viewId}`,
        };
      }
      return {
        pathname: `/base/${baseId}/table/${resourceId}`,
      };
    case BaseNodeResourceType.Dashboard:
      return {
        pathname: `/base/${baseId}/dashboard/${resourceId}`,
      };
    case BaseNodeResourceType.Workflow:
      return {
        pathname: `/base/${baseId}/automation/${resourceId}`,
      };
    case BaseNodeResourceType.App:
      return {
        pathname: `/base/${baseId}/app/${resourceId}`,
      };
    case BaseNodeResourceType.Folder:
      return null;
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

export const getChildrenNodes = (
  parentId: string,
  nodes: IBaseNodeVo[],
  opts: { filterFolder?: boolean } = {}
): IBaseNodeVo[] => {
  const { filterFolder = false } = opts;
  const parentNode = nodes.find((node) => node.id === parentId);
  if (!parentNode) return [];
  const children = [];
  for (const child of parentNode.children ?? []) {
    const childNode = nodes.find((node) => node.id === child.id);
    if (!childNode) continue;
    if (childNode.children && childNode.children.length > 0) {
      children.push(...getChildrenNodes(childNode.id, nodes, { filterFolder }));
    }
    if (filterFolder && childNode.resourceType === BaseNodeResourceType.Folder) {
      continue;
    }
    children.push(childNode);
  }
  return children;
};
