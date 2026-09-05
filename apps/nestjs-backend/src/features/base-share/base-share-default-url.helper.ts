import type { Prisma } from '@teable/db-main-prisma';

interface IBaseNodeRow {
  id: string;
  parentId: string | null;
  resourceType: string;
  resourceId: string;
  order: number;
}

/**
 * Find the first accessible non-folder node within a folder hierarchy.
 * Uses depth-first search with order-based sorting.
 * @param parentNodeId - null means find from root level
 */
const findFirstAccessibleNode = (
  allNodes: IBaseNodeRow[],
  parentNodeId: string | null
): { resourceType: string; resourceId: string } | null => {
  const children = allNodes
    .filter((n) => n.parentId === parentNodeId)
    .sort((a, b) => a.order - b.order);

  for (const child of children) {
    if (child.resourceType.toLowerCase() !== 'folder') {
      return { resourceType: child.resourceType, resourceId: child.resourceId };
    }
    const found = findFirstAccessibleNode(allNodes, child.id);
    if (found) return found;
  }
  return null;
};

/**
 * Table URLs carry the first view id (by order) so the browser reaches the final
 * page in a single redirect (T6802). Deliberately deterministic — no per-user
 * last-visit data: callers (share default url, short links) are shared and
 * cached across users.
 */
const buildTableUrl = async (
  prisma: Prisma.TransactionClient,
  baseId: string,
  tableId: string
): Promise<string> => {
  const view = await prisma.view.findFirst({
    where: { tableId, deletedTime: null },
    select: { id: true },
    orderBy: { order: 'asc' },
  });
  return view ? `/base/${baseId}/table/${tableId}/${view.id}` : `/base/${baseId}/table/${tableId}`;
};

/**
 * base_node rows are synced lazily (only when the node tree is first listed),
 * so a base can have tables but no nodes yet. Fall back to the first table so
 * whole-base shares still land somewhere.
 */
const buildFallbackDefaultUrl = async (
  prisma: Prisma.TransactionClient,
  baseId: string,
  nodeId: string | null
): Promise<string | undefined> => {
  if (nodeId !== null) {
    return undefined;
  }
  const firstTable = await prisma.tableMeta.findFirst({
    where: { baseId, deletedTime: null },
    select: { id: true },
    orderBy: { order: 'asc' },
  });
  return firstTable ? buildTableUrl(prisma, baseId, firstTable.id) : undefined;
};

/**
 * Build the default landing URL for a base share.
 * Returns a URL like "/base/xxx/table/yyy/zzz" or "/base/xxx/dashboard/yyy".
 * Shared by the base-share open API and short-link resolution so both produce
 * the same canonical target.
 */
export const buildBaseShareDefaultUrl = async (
  prisma: Prisma.TransactionClient,
  baseId: string,
  nodeId: string | null
): Promise<string | undefined> => {
  // Get all nodes in the base
  const allNodes = await prisma.baseNode.findMany({
    where: { baseId },
    select: {
      id: true,
      parentId: true,
      resourceType: true,
      resourceId: true,
      order: true,
    },
    orderBy: { order: 'asc' },
  });

  if (allNodes.length === 0) {
    return buildFallbackDefaultUrl(prisma, baseId, nodeId);
  }

  let targetNode: { resourceType: string; resourceId: string } | null = null;

  if (nodeId === null) {
    // Whole base share: find first accessible node from root
    targetNode = findFirstAccessibleNode(allNodes, null);
  } else {
    // Find the shared node
    const sharedNode = allNodes.find((n) => n.id === nodeId);
    if (sharedNode) {
      // If the shared node is a folder, find the first accessible non-folder child
      if (sharedNode.resourceType.toLowerCase() === 'folder') {
        targetNode = findFirstAccessibleNode(allNodes, nodeId);
      } else {
        targetNode = {
          resourceType: sharedNode.resourceType,
          resourceId: sharedNode.resourceId,
        };
      }
    }
  }

  if (!targetNode) {
    return undefined;
  }

  // Build URL based on resource type
  const resourceType = targetNode.resourceType.toLowerCase();
  const resourceId = targetNode.resourceId;

  switch (resourceType) {
    case 'table':
      return buildTableUrl(prisma, baseId, resourceId);
    case 'dashboard':
      return `/base/${baseId}/dashboard/${resourceId}`;
    case 'workflow':
      return `/base/${baseId}/automation/${resourceId}`;
    case 'app':
      return `/base/${baseId}/app/${resourceId}`;
    default:
      return undefined;
  }
};
