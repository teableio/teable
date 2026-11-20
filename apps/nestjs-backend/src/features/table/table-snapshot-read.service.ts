import { ForbiddenException, Injectable } from '@nestjs/common';
import type { ISnapshotBase } from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import type { ITableVo } from '@teable/openapi';
import { PermissionService } from '../auth/permission.service';

/** Table document reads are host metadata and do not require either execution engine. */
@Injectable()
export class TableSnapshotReadService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly permissionService: PermissionService
  ) {}

  async getTableDefaultViewId(tableIds: string[]): Promise<(string | undefined)[]> {
    if (!tableIds.length) return [];
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { id: true },
    });
    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId: { in: tables.map((table) => table.id) }, deletedTime: null },
      select: { id: true, tableId: true },
      orderBy: { order: 'asc' },
    });
    const firstViewByTable = new Map<string, string>();
    for (const view of views) {
      if (!firstViewByTable.has(view.tableId)) firstViewByTable.set(view.tableId, view.id);
    }
    return tableIds.map((tableId) => firstViewByTable.get(tableId));
  }

  async getSnapshotBulk(
    baseId: string,
    ids: string[],
    options: { ignoreDefaultViewId?: boolean } = {}
  ): Promise<ISnapshotBase<ITableVo>[]> {
    const visibleIds = await this.permissionService.getBaseShareVisibleResourceIds(baseId, 'table');
    if (visibleIds && ids.some((id) => !visibleIds.has(id))) {
      throw new ForbiddenException('Project share does not cover all requested tables');
    }
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId, id: { in: ids }, deletedTime: null, provisionState: ProvisionState.ready },
      orderBy: { order: 'asc' },
    });
    tables.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
    const defaultViewIds = options.ignoreDefaultViewId
      ? []
      : await this.getTableDefaultViewId(tables.map((table) => table.id));
    return tables.map((table, index) => ({
      id: table.id,
      v: table.version,
      type: 'json0',
      data: {
        ...table,
        description: table.description ?? undefined,
        icon: table.icon ?? undefined,
        lastModifiedTime: table.lastModifiedTime?.toISOString() || table.createdTime.toISOString(),
        ...(!options.ignoreDefaultViewId ? { defaultViewId: defaultViewIds[index] } : {}),
      } as ITableVo,
    }));
  }

  async getDocIdsByQuery(baseId: string, query: { projectionTableIds?: string[] } = {}) {
    const visibleIds = await this.permissionService.getBaseShareVisibleResourceIds(baseId, 'table');
    const { projectionTableIds } = query;
    const tableIdsInScope = visibleIds
      ? projectionTableIds?.filter((id) => visibleIds.has(id)) ?? [...visibleIds]
      : projectionTableIds;
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
        provisionState: ProvisionState.ready,
        ...(tableIdsInScope ? { id: { in: tableIdsInScope } } : {}),
      },
      select: { id: true },
      orderBy: { order: 'asc' },
    });
    return { ids: tables.map((table) => table.id) };
  }
}
