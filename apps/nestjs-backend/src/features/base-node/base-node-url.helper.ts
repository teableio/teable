import type { Prisma } from '@teable/db-main-prisma';
import { BaseNodeResourceType } from '@teable/openapi';

/**
 * The page URL of a base node resource; undefined for folders and unknown
 * types, which have no page of their own.
 */
export const buildBaseNodeUrl = (
  baseId: string,
  resourceType: BaseNodeResourceType,
  resourceId: string,
  viewId?: string | null
): string | undefined => {
  switch (resourceType) {
    case BaseNodeResourceType.Table:
      return viewId
        ? `/base/${baseId}/table/${resourceId}/${viewId}`
        : `/base/${baseId}/table/${resourceId}`;
    case BaseNodeResourceType.Dashboard:
      return `/base/${baseId}/dashboard/${resourceId}`;
    case BaseNodeResourceType.Workflow:
      return `/base/${baseId}/automation/${resourceId}`;
    case BaseNodeResourceType.App:
      return `/base/${baseId}/app/${resourceId}`;
    case BaseNodeResourceType.Routine:
      return `/base/${baseId}/routine/${resourceId}`;
    default:
      return undefined;
  }
};

/**
 * Table URLs carry the first view id (by order) so the browser reaches the final
 * page in a single redirect (T6802). Deliberately deterministic — no per-user
 * last-visit data: callers (share default url, short links) are shared and
 * cached across users. Undefined when the table is deleted or missing.
 */
export const buildTableUrl = async (
  prisma: Prisma.TransactionClient,
  baseId: string,
  tableId: string
): Promise<string | undefined> => {
  const table = await prisma.tableMeta.findFirst({
    where: { id: tableId, deletedTime: null },
    select: {
      id: true,
      views: {
        where: { deletedTime: null },
        orderBy: { order: 'asc' },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!table) {
    return undefined;
  }
  return buildBaseNodeUrl(baseId, BaseNodeResourceType.Table, tableId, table.views[0]?.id);
};

/** Resolve a copied node only after its host resources and id maps have been restored. */
export const buildBaseNodeDefaultUrl = async (
  prisma: Prisma.TransactionClient,
  baseId: string,
  nodeId: string | null
): Promise<string | null> => {
  if (!nodeId) return null;
  const node = await prisma.baseNode.findFirst({
    where: { baseId, id: nodeId },
    select: { resourceType: true, resourceId: true },
  });
  if (!node) return null;
  const resourceType = node.resourceType as BaseNodeResourceType;
  const url =
    resourceType === BaseNodeResourceType.Table
      ? await buildTableUrl(prisma, baseId, node.resourceId)
      : buildBaseNodeUrl(baseId, resourceType, node.resourceId);
  return url ?? `/base/${baseId}`;
};
