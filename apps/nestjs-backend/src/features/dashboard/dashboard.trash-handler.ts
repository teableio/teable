import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { TrashType } from '@teable/openapi';
import type {
  ITrashResourceHandler,
  ITrashResourceItem,
} from '../trash/resource/trash-resource-handler';

@Injectable()
export class DashboardTrashHandler implements ITrashResourceHandler {
  readonly type = TrashType.Dashboard;
  readonly notFoundI18nKey = 'httpErrors.dashboard.notFound' as const;
  readonly auditActions = {
    restore: 'dashboard.restore',
    permanentDelete: 'dashboard.permanent-delete',
  };

  constructor(private readonly prismaService: PrismaService) {}

  async listTrashed(baseId: string) {
    return this.prismaService.dashboard.findMany({
      where: { baseId, deletedTime: { not: null } },
      select: { id: true, name: true },
    });
  }

  async findLiveIds(resourceIds: string[]) {
    const rows = await this.prismaService.txClient().dashboard.findMany({
      where: { id: { in: resourceIds }, deletedTime: null },
      select: { id: true },
    });
    return new Set(rows.map(({ id }) => id));
  }

  async describe(item: ITrashResourceItem) {
    const dashboard = await this.prismaService.dashboard.findUnique({
      where: { id: item.resourceId },
      select: { name: true, baseId: true },
    });
    return { baseId: dashboard?.baseId, dashboardId: item.resourceId, name: dashboard?.name };
  }

  async findTrashed(resourceId: string) {
    const row = await this.prismaService.dashboard.findUnique({
      where: { id: resourceId },
      select: { baseId: true, deletedTime: true },
    });
    return row && { deletedTime: row.deletedTime, parentId: row.baseId };
  }

  async findBaseId(resourceId: string) {
    const dashboard = await this.prismaService.txClient().dashboard.findUnique({
      where: { id: resourceId },
      select: { baseId: true },
    });
    return dashboard?.baseId ?? null;
  }

  async restore(_baseId: string, resourceId: string) {
    await this.prismaService.txClient().dashboard.update({
      where: { id: resourceId },
      data: { deletedTime: null },
    });
  }

  /** Purges dashboards with their trash entries, as a table purge takes its own. */
  async purge(_baseId: string, resourceIds: string[]) {
    if (!resourceIds.length) return;
    await this.prismaService.$tx(async (prisma) => {
      await prisma.dashboard.deleteMany({ where: { id: { in: resourceIds } } });
      await prisma.trash.deleteMany({
        where: { resourceType: TrashType.Dashboard, resourceId: { in: resourceIds } },
      });
    });
  }
}
