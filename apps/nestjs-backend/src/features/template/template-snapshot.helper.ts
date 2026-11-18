import type { Prisma, PrismaService } from '@teable/db-main-prisma';
import { ResourceType } from '@teable/openapi';

/**
 * Sends a live snapshot to the trash, where the retention cleanup purges it and what it
 * deployed. One that is retired already keeps its trash entry and its purge date.
 */
export const retireTemplateSnapshot = async (
  prisma: Prisma.TransactionClient,
  snapshotBaseId: string,
  deletedBy: string
): Promise<void> => {
  const deletedTime = new Date();
  const { count } = await prisma.base.updateMany({
    where: { id: snapshotBaseId, deletedTime: null },
    data: { deletedTime },
  });
  if (!count) return;
  const snapshotBase = await prisma.base.findUniqueOrThrow({
    where: { id: snapshotBaseId },
    select: { spaceId: true },
  });
  await prisma.trash.upsert({
    // Prisma generates this key name from the compound unique index.
    // oxlint-disable-next-line teable/naming-convention -- Prisma generated compound key
    where: {
      ['resourceType_resourceId']: {
        resourceType: ResourceType.Base,
        resourceId: snapshotBaseId,
      },
    },
    create: {
      resourceType: ResourceType.Base,
      resourceId: snapshotBaseId,
      parentId: snapshotBase.spaceId,
      deletedTime,
      deletedBy,
    },
    update: { deletedTime, deletedBy, parentId: snapshotBase.spaceId },
  });
};

/** Retire only an unpublished staged snapshot, including when a transaction callback fails after commit. */
export const withStagedTemplateSnapshot = async <T>(
  prismaService: PrismaService,
  sourceBaseId: string,
  snapshotBaseId: string,
  userId: string,
  operation: () => Promise<T>,
  onCleanupError: (error: unknown) => void
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    try {
      await prismaService.$tx(async (prisma) => {
        await lockTemplateSnapshotSwap(prisma, sourceBaseId);
        const templates = await prisma.template.findMany({
          select: { snapshot: true },
        });
        if (
          templates.some(
            ({ snapshot }) => snapshot && JSON.parse(snapshot).baseId === snapshotBaseId
          )
        ) {
          return;
        }
        const base = await prisma.base.findUnique({
          where: { id: snapshotBaseId },
          select: { deletedTime: true },
        });
        if (base && !base.deletedTime) {
          await retireTemplateSnapshot(prisma, snapshotBaseId, userId);
        }
      });
    } catch (cleanupError) {
      onCleanupError(cleanupError);
    }
    throw error;
  }
};

/** Serialize only the pointer swap; native snapshot staging must stay outside this transaction. */
export const lockTemplateSnapshotSwap = async (
  prisma: Prisma.TransactionClient,
  sourceBaseId: string
): Promise<void> => {
  const key = `template:snapshot:${sourceBaseId}`;
  await prisma.$executeRaw`
    SELECT pg_advisory_xact_lock(('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint)
  `;
};
