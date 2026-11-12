import { generateBaseNodeId, IdPrefix, identify } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { BaseNodeResourceType } from '@teable/openapi';

/**
 * A folder made by the folder route before that route made its node has none until the tree is
 * next read; this gives the folders among `ids` that lack one the node that read would (at the
 * root), so what looks a folder up by its ID finds it at once. Returns whether it made any.
 */
export const createMissingFolderNodes = async (
  prisma: PrismaService,
  baseId: string,
  ids: string[],
  userId: string
): Promise<boolean> => {
  const folderIds = ids.filter((id) => identify(id) === IdPrefix.BaseNodeFolder);
  if (!folderIds.length) return false;
  const nodes = await prisma.baseNode.findMany({
    where: { baseId, resourceId: { in: folderIds } },
    select: { resourceId: true },
  });
  const found = new Set(nodes.map((n) => n.resourceId));
  const missing = folderIds.filter((id) => !found.has(id));
  if (!missing.length) return false;
  const folders = await prisma.baseNodeFolder.findMany({
    where: { baseId, id: { in: missing }, deletedTime: null },
    select: { id: true },
  });
  if (!folders.length) return false;
  const { _max } = await prisma.baseNode.aggregate({
    where: { baseId },
    _max: { order: true },
  });
  let order = (_max.order ?? 0) + 1;
  await prisma.baseNode.createMany({
    data: folders.map((folder) => ({
      id: generateBaseNodeId(),
      baseId,
      resourceType: BaseNodeResourceType.Folder,
      resourceId: folder.id,
      parentId: null,
      order: order++,
      createdBy: userId,
    })),
    // A tree read making the same node meanwhile wins.
    skipDuplicates: true,
  });
  return true;
};
