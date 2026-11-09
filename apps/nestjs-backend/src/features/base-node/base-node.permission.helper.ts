/* eslint-disable sonarjs/no-duplicate-string */
import type { TableAction, AppAction, AutomationAction, RoutineAction } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import type { IBaseNodePermissionContext, IBaseNodeVisibilityContext } from './types';
import { BaseNodeAction } from './types';

const map: Record<BaseNodeResourceType, Record<BaseNodeAction, string>> = {
  [BaseNodeResourceType.Folder]: {
    [BaseNodeAction.Read]: 'base|read',
    [BaseNodeAction.Create]: 'base|update',
    [BaseNodeAction.Update]: 'base|update',
    [BaseNodeAction.Delete]: 'base|update',
  },
  [BaseNodeResourceType.Table]: {
    [BaseNodeAction.Read]: 'table|read',
    [BaseNodeAction.Create]: 'table|create',
    [BaseNodeAction.Update]: 'table|update',
    [BaseNodeAction.Delete]: 'table|delete',
  },
  [BaseNodeResourceType.Dashboard]: {
    [BaseNodeAction.Read]: 'base|read',
    [BaseNodeAction.Create]: 'base|update',
    [BaseNodeAction.Update]: 'base|update',
    [BaseNodeAction.Delete]: 'base|update',
  },
  [BaseNodeResourceType.Workflow]: {
    [BaseNodeAction.Read]: 'automation|read',
    [BaseNodeAction.Create]: 'automation|create',
    [BaseNodeAction.Update]: 'automation|update',
    [BaseNodeAction.Delete]: 'automation|delete',
  },
  [BaseNodeResourceType.App]: {
    [BaseNodeAction.Read]: 'app|read',
    [BaseNodeAction.Create]: 'app|create',
    [BaseNodeAction.Update]: 'app|update',
    [BaseNodeAction.Delete]: 'app|delete',
  },
  [BaseNodeResourceType.Routine]: {
    [BaseNodeAction.Read]: 'routine|read',
    [BaseNodeAction.Create]: 'routine|create',
    [BaseNodeAction.Update]: 'routine|update',
    [BaseNodeAction.Delete]: 'routine|delete',
  },
};

export const checkBaseNodePermission = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  action: BaseNodeAction,
  permissionContext: IBaseNodePermissionContext
): boolean => {
  const { resourceType } = node;
  const { resourceId } = node;
  const {
    tablePermissionMap,
    permissionSet,
    appPermissionMap,
    workflowPermissionMap,
    routinePermissionMap,
  } = permissionContext;
  // A type the map does not know (a row written by a newer edition, or a
  // corrupt one) has no permission anyone could hold; it must not throw.
  const checkAction = map[resourceType]?.[action];
  if (!checkAction) return false;
  if (resourceType === BaseNodeResourceType.Table && tablePermissionMap) {
    return tablePermissionMap[resourceId]?.includes(checkAction as TableAction) ?? false;
  }
  if (resourceType === BaseNodeResourceType.App && appPermissionMap) {
    return appPermissionMap[resourceId]?.includes(checkAction as AppAction) ?? false;
  }
  if (resourceType === BaseNodeResourceType.Workflow && workflowPermissionMap) {
    return workflowPermissionMap[resourceId]?.includes(checkAction as AutomationAction) ?? false;
  }
  if (resourceType === BaseNodeResourceType.Routine && routinePermissionMap) {
    return routinePermissionMap[resourceId]?.includes(checkAction as RoutineAction) ?? false;
  }
  return permissionSet.has(checkAction);
};

/** As much of a node as deciding who may see it takes. */
type IBaseNodeVisibilityEntry = {
  id: string;
  parentId?: string | null;
  resourceType: BaseNodeResourceType;
  resourceId: string;
};

/**
 * Drops the folders the member cannot access, given the nodes they can read. A folder has no
 * permission of its own, so it is accessible only while some readable non-folder node lies below
 * it. Mirrors `filterAutoHiddenFolders` in the nextjs-app base-node helper, which applies the same
 * rule on the client; run here, those folders never leave the server.
 */
export const filterAutoHiddenFolders = <T extends IBaseNodeVisibilityEntry>(nodes: T[]): T[] => {
  const childrenByParent = new Map<string, T[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  const hasContent = new Map<string, boolean>();
  const folderHasContent = (folderId: string): boolean => {
    const known = hasContent.get(folderId);
    if (known !== undefined) return known;
    // Mark first so a corrupt parent cycle ends instead of recursing forever
    hasContent.set(folderId, false);
    const result = (childrenByParent.get(folderId) ?? []).some(
      (child) => child.resourceType !== BaseNodeResourceType.Folder || folderHasContent(child.id)
    );
    hasContent.set(folderId, result);
    return result;
  };
  return nodes.filter(
    (node) => node.resourceType !== BaseNodeResourceType.Folder || folderHasContent(node.id)
  );
};

/** The shared node and every node below it; none at all when the shared node is gone. */
const filterShareScope = <T extends IBaseNodeVisibilityEntry>(
  nodes: T[],
  shareNodeId: string
): T[] => {
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node.id);
    childrenByParent.set(node.parentId, siblings);
  }
  const inScope = new Set<string>();
  const queue = nodes.some((node) => node.id === shareNodeId) ? [shareNodeId] : [];
  while (queue.length) {
    const current = queue.shift() as string;
    if (inScope.has(current)) continue;
    inScope.add(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return nodes.filter((node) => inScope.has(node.id));
};

/**
 * The nodes the caller can see: inside their node share if they came through one, those they can
 * read, less the folders they cannot access. The sidebar tree and everything said about a node
 * (its share, for one) answer to this same set.
 */
export const filterVisibleNodes = <T extends IBaseNodeVisibilityEntry>(
  nodes: T[],
  context: IBaseNodeVisibilityContext
): T[] => {
  const scopedNodes = context.shareNodeId ? filterShareScope(nodes, context.shareNodeId) : nodes;
  const readableNodes = scopedNodes.filter((node) =>
    checkBaseNodePermission(node, BaseNodeAction.Read, context)
  );
  return context.hideInaccessibleFolders ? filterAutoHiddenFolders(readableNodes) : readableNodes;
};

export const checkBaseNodePermissionCreate = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  baseNodePermissions: BaseNodeAction[],
  permissionContext: IBaseNodePermissionContext
): boolean => {
  const checkCreate = baseNodePermissions.includes(BaseNodeAction.Create);
  if (!checkCreate) {
    return true;
  }
  const { resourceType } = node;
  if (!resourceType) {
    throw new CustomHttpException(
      'Cannot create project node with empty resource type',
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.baseNode.invalidResourceType',
        },
      }
    );
  }

  return checkBaseNodePermission(node, BaseNodeAction.Create, permissionContext);
};
