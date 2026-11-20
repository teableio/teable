import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { TrashType } from '@teable/openapi';
import type {
  ITrashFlow,
  ITrashResourceHandler,
  ITrashResourceItem,
} from '../trash/resource/trash-resource-handler';
import { SpaceService } from './space.service';

/**
 * Provided in the trash module, not the space module: an edition rebinds SpaceService there, and
 * the handler's purge has to reach the edition's.
 */
@Injectable()
export class SpaceTrashHandler implements ITrashResourceHandler {
  readonly type = TrashType.Space;
  readonly notFoundI18nKey = 'httpErrors.trash.notFound' as const;
  // A restore is a bare column update that emits nothing, so the trash writes its row.
  readonly auditActions = { restore: 'space.restore', permanentDelete: 'space.permanent-delete' };

  constructor(
    private readonly prismaService: PrismaService,
    private readonly spaceService: SpaceService
  ) {}

  /** A space is in no project's trash. */
  async listTrashed() {
    return [];
  }

  /** A space's entry is never taken for stale. */
  async findLiveIds() {
    return new Set<string>();
  }

  async describe(item: ITrashResourceItem) {
    const space = await this.prismaService.space.findUnique({
      where: { id: item.resourceId },
      select: { name: true },
    });
    return { spaceId: item.resourceId, name: space?.name };
  }

  async findTrashed(resourceId: string) {
    return this.prismaService.space.findUnique({
      where: { id: resourceId },
      select: { deletedTime: true },
    });
  }

  async findBaseId() {
    return null;
  }

  async restore(_baseId: string | null, resourceId: string) {
    await this.prismaService.txClient().space.update({
      where: { id: resourceId },
      data: { deletedTime: null },
    });
  }

  /** The space service checks the caller's scope itself, unless the sweep purges. */
  async purge(_baseId: string | null, resourceIds: string[], flow: ITrashFlow) {
    for (const resourceId of resourceIds) {
      await this.spaceService.permanentDeleteSpace(resourceId, flow.ignorePermissionCheck);
    }
  }
}
