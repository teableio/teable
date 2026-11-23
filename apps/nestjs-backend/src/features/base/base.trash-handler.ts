import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { TrashType } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { baseDisplayName } from '../../utils/base-name';
import type {
  ITrashFlow,
  ITrashResourceHandler,
  ITrashResourceItem,
} from '../trash/resource/trash-resource-handler';
import { BaseService } from './base.service';

/**
 * Provided in the trash module, not the base module: an edition rebinds BaseService there, and the
 * handler's purge has to reach the edition's.
 */
@Injectable()
export class BaseTrashHandler implements ITrashResourceHandler {
  readonly type = TrashType.Base;
  readonly notFoundI18nKey = 'httpErrors.base.notFound' as const;
  // A restore is a bare column update that emits nothing, so the trash writes its row.
  readonly auditActions = { restore: 'base.restore', permanentDelete: 'base.permanent-delete' };

  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseService: BaseService
  ) {}

  /** A project is in its space's trash, not a project's. */
  async listTrashed() {
    return [];
  }

  /** A project's entry is never taken for stale. */
  async findLiveIds() {
    return new Set<string>();
  }

  async describe(item: ITrashResourceItem) {
    const base = await this.prismaService.base.findUnique({
      where: { id: item.resourceId },
      select: { name: true, spaceId: true },
    });
    return {
      baseId: item.resourceId,
      spaceId: base?.spaceId,
      name: base ? baseDisplayName(base.name) : undefined,
    };
  }

  async findTrashed(resourceId: string) {
    const base = await this.prismaService.base.findUnique({
      where: { id: resourceId },
      select: { spaceId: true, deletedTime: true },
    });
    return base && { deletedTime: base.deletedTime, parentId: base.spaceId };
  }

  async findBaseId(resourceId: string) {
    const base = await this.prismaService.txClient().base.findUnique({
      where: { id: resourceId },
      select: { id: true },
    });
    return base?.id ?? null;
  }

  async restore(_baseId: string | null, resourceId: string) {
    const prisma = this.prismaService.txClient();
    const { spaceId } = await prisma.base.findUniqueOrThrow({
      where: { id: resourceId },
      select: { spaceId: true },
    });
    const trashedSpace = await prisma.trash.findFirst({
      where: { resourceId: spaceId, resourceType: TrashType.Space },
    });
    if (trashedSpace != null) {
      throw new CustomHttpException(
        'Unable to restore this project because its parent space is also trashed',
        HttpErrorCode.VALIDATION_ERROR,
        { localization: { i18nKey: 'httpErrors.trash.parentSpaceTrashed' } }
      );
    }
    await prisma.base.update({ where: { id: resourceId }, data: { deletedTime: null } });
  }

  /** The base service checks the caller's scope itself, unless the sweep purges. */
  async purge(_baseId: string | null, resourceIds: string[], flow: ITrashFlow) {
    for (const resourceId of resourceIds) {
      await this.baseService.permanentDeleteBase(resourceId, flow.ignorePermissionCheck);
    }
  }
}
