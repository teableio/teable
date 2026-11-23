import { HttpErrorCode } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { ResourceLevel, resourceDescriptorOf } from '../resource/resource-descriptor';
import type { IBaseNodePermissionContext, IBaseNodeVisibilityContext } from './types';
import { BaseNodeAction } from './types';

const ACTION_OF: Record<BaseNodeAction, 'read' | 'create' | 'update' | 'delete'> = {
  [BaseNodeAction.Read]: 'read',
  [BaseNodeAction.Create]: 'create',
  [BaseNodeAction.Update]: 'update',
  [BaseNodeAction.Delete]: 'delete',
};

export const checkBaseNodePermission = (
  node: { resourceType: BaseNodeResourceType; resourceId: string },
  action: BaseNodeAction,
  permissionContext: IBaseNodePermissionContext
): boolean => {
  const { resourceType, resourceId } = node;
  const descriptor = resourceDescriptorOf(resourceType);
  // A type no edition knows (a row written by a newer edition, or a corrupt one) has no
  // permission anyone could hold; it must not throw.
  if (descriptor?.level !== ResourceLevel.Node) return false;
  const checkAction = descriptor.actions[ACTION_OF[action]];
  const grants = permissionContext.nodePermissionMaps?.[resourceType];
  if (grants) return grants[resourceId]?.includes(checkAction) ?? false;
  return permissionContext.permissionSet.has(checkAction);
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
