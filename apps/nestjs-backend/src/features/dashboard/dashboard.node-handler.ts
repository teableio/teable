import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { BaseNodeResourceType } from '@teable/openapi';
import type { ICreateDashboardRo, IDuplicateDashboardRo, IUpdateBaseNodeRo } from '@teable/openapi';
import type { IDependencyEdge } from '../base-node/base-dependency-graph.service';
import { extractTableIds, nodeKey } from '../base-node/base-dependency-graph.service';
import type { IMoveNodeContext } from '../base-node/base-node-move.service';
import type {
  IBaseNodeResourceCreateRo,
  IBaseNodeResourceHandler,
} from '../base-node/resource/base-node-resource-handler';
import { DashboardService } from './dashboard.service';

@Injectable()
export class DashboardNodeHandler implements IBaseNodeResourceHandler {
  readonly type = BaseNodeResourceType.Dashboard;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dashboardService: DashboardService
  ) {}

  async list(baseId: string, ids?: string[]) {
    return await this.prismaService.dashboard.findMany({
      where: { baseId, id: { in: ids || undefined }, deletedTime: null },
      select: {
        id: true,
        name: true,
        createdBy: true,
        createdTime: true,
        lastModifiedBy: true,
        lastModifiedTime: true,
      },
    });
  }

  async create(baseId: string, ro: IBaseNodeResourceCreateRo) {
    const dashboard = await this.dashboardService.createDashboard(baseId, ro as ICreateDashboardRo);
    return { id: dashboard.id, name: dashboard.name };
  }

  async update(baseId: string, id: string, { name }: IUpdateBaseNodeRo) {
    if (name) {
      await this.dashboardService.renameDashboard(baseId, id, name);
    }
  }

  async duplicate(baseId: string, id: string, ro: IDuplicateDashboardRo) {
    const dashboard = await this.dashboardService.duplicateDashboard(baseId, id, ro);
    return { id: dashboard.id, name: dashboard.name };
  }

  async delete(baseId: string, id: string, permanent?: boolean) {
    await this.dashboardService.deleteDashboard(baseId, id, permanent);
  }

  async getNames(baseId: string, ids: string[]) {
    const rows = await this.prismaService.txClient().dashboard.findMany({
      where: { baseId, id: { in: ids }, deletedTime: null },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async moveResources(ctx: IMoveNodeContext) {
    for (const id of ctx.resourceIds.get(BaseNodeResourceType.Dashboard) ?? []) {
      await this.dashboardService.moveDashboardToBase(ctx.sourceBaseId, ctx.targetBaseId, id);
    }
  }

  /**
   * A dashboard's plugins keep table ids inside opaque storage, so the only way
   * to find them is to read the ids out of the text. That makes every edge here
   * a guess: a stale id left behind by a removed filter reads exactly like a
   * live one, hence `uncertain`.
   */
  async dependencyEdges(baseId: string, tableIds: string[]): Promise<IDependencyEdge[]> {
    if (tableIds.length === 0) return [];
    const prisma = this.prismaService.txClient();
    const dashboards = await prisma.dashboard.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true },
    });
    if (dashboards.length === 0) return [];
    const installs = await prisma.pluginInstall.findMany({
      // only dashboard panels; view plugins name their table elsewhere
      where: { baseId, storage: { not: null }, positionId: { in: dashboards.map((d) => d.id) } },
      select: { positionId: true, storage: true },
    });
    const known = new Set(tableIds);
    const edges: IDependencyEdge[] = [];
    for (const install of installs) {
      // one pass over the storage rather than one substring search per table
      for (const found of extractTableIds(JSON.stringify(install.storage))) {
        if (!known.has(found)) continue;
        edges.push({
          from: nodeKey(BaseNodeResourceType.Dashboard, install.positionId),
          to: nodeKey(BaseNodeResourceType.Table, found),
          kind: 'reference',
          uncertain: true,
        });
      }
    }
    return edges;
  }
}
