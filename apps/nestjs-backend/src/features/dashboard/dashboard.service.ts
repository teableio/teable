/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, NotFoundException } from '@nestjs/common';
import { generateDashboardId, generatePluginInstallId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition, PluginStatus } from '@teable/openapi';
import type {
  ICreateDashboardRo,
  IDashboardInstallPluginRo,
  IGetDashboardListVo,
  IGetDashboardVo,
  IUpdateLayoutDashboardRo,
} from '@teable/openapi';
import type { IDashboardLayout, IDashboardPluginItem } from '@teable/openapi/src/dashboard/types';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async getDashboard(baseId: string): Promise<IGetDashboardListVo> {
    return this.prismaService.dashboard.findMany({
      where: {
        baseId,
      },
      select: {
        id: true,
        name: true,
      },
    });
  }

  async getDashboardById(baseId: string, id: string): Promise<IGetDashboardVo> {
    const dashboard = await this.prismaService.dashboard
      .findFirstOrThrow({
        where: {
          id,
          baseId,
        },
        select: {
          id: true,
          name: true,
          layout: true,
        },
      })
      .catch(() => {
        throw new NotFoundException('Dashboard not found');
      });

    const plugins = await this.prismaService.pluginInstall.findMany({
      where: {
        positionId: dashboard.id,
        position: PluginPosition.Dashboard,
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        plugin: {
          select: {
            url: true,
          },
        },
      },
    });

    return {
      ...dashboard,
      layout: dashboard.layout ? JSON.parse(dashboard.layout) : undefined,
      pluginMap: plugins.reduce(
        (acc, plugin) => {
          acc[plugin.id] = {
            id: plugin.pluginId,
            pluginInstallId: plugin.id,
            name: plugin.name,
            url: plugin.plugin.url ?? undefined,
          };
          return acc;
        },
        {} as Record<string, IDashboardPluginItem>
      ),
    };
  }

  async createDashboard(baseId: string, dashboard: ICreateDashboardRo) {
    const userId = this.cls.get('user.id');
    return this.prismaService.dashboard.create({
      data: {
        id: generateDashboardId(),
        baseId,
        name: dashboard.name,
        createdBy: userId,
      },
      select: {
        id: true,
        name: true,
      },
    });
  }

  async renameDashboard(baseId: string, id: string, name: string) {
    return this.prismaService.dashboard
      .update({
        where: {
          baseId,
          id,
        },
        data: {
          name,
        },
        select: {
          id: true,
          name: true,
        },
      })
      .catch(() => {
        throw new NotFoundException('Dashboard not found');
      });
  }

  async updateLayout(baseId: string, id: string, layout: IUpdateLayoutDashboardRo['layout']) {
    const ro = await this.prismaService.dashboard
      .update({
        where: {
          baseId,
          id,
        },
        data: {
          layout: JSON.stringify(layout),
        },
        select: {
          id: true,
          name: true,
          layout: true,
        },
      })
      .catch(() => {
        throw new NotFoundException('Dashboard not found');
      });
    return {
      ...ro,
      layout: ro.layout ? JSON.parse(ro.layout) : undefined,
    };
  }

  async deleteDashboard(baseId: string, id: string) {
    await this.prismaService.dashboard
      .delete({
        where: {
          baseId,
          id,
        },
      })
      .catch(() => {
        throw new NotFoundException('Dashboard not found');
      });
  }

  private async validatePluginPublished(baseId: string, pluginId: string) {
    await this.prismaService.plugin
      .findFirstOrThrow({
        where: {
          id: pluginId,
          status: PluginStatus.Published,
        },
      })
      .catch(() => {
        throw new NotFoundException('Plugin not found');
      });
  }

  async installPlugin(baseId: string, id: string, ro: IDashboardInstallPluginRo) {
    const userId = this.cls.get('user.id');
    await this.validatePluginPublished(baseId, ro.pluginId);
    return this.prismaService.$tx(async () => {
      const newInstallPlugin = await this.prismaService.txClient().pluginInstall.create({
        data: {
          id: generatePluginInstallId(),
          baseId,
          positionId: id,
          position: PluginPosition.Dashboard,
          name: ro.name,
          pluginId: ro.pluginId,
          createdBy: userId,
        },
        select: {
          id: true,
          name: true,
          pluginId: true,
        },
      });
      const dashboard = await this.prismaService.txClient().dashboard.findFirstOrThrow({
        where: {
          id,
          baseId,
        },
        select: {
          layout: true,
        },
      });
      const layout = dashboard.layout ? (JSON.parse(dashboard.layout) as IDashboardLayout) : [];
      layout.push({
        pluginInstallId: newInstallPlugin.id,
        x: (layout.length * 2) % 12,
        y: Number.MAX_SAFE_INTEGER, // puts it at the bottom
        w: 2,
        h: 2,
      });
      await this.prismaService.txClient().dashboard.update({
        where: {
          id,
        },
        data: {
          layout: JSON.stringify(layout),
        },
      });
      return {
        id,
        pluginId: newInstallPlugin.pluginId,
        pluginInstallId: newInstallPlugin.id,
        name: ro.name,
      };
    });
  }

  async removePlugin(baseId: string, dashboardId: string, pluginInstallId: string) {
    return this.prismaService.$tx(async () => {
      await this.prismaService
        .txClient()
        .pluginInstall.delete({
          where: {
            id: pluginInstallId,
            baseId,
            positionId: dashboardId,
            plugin: {
              status: PluginStatus.Published,
            },
          },
        })
        .catch(() => {
          throw new NotFoundException('Plugin not found');
        });
      const dashboard = await this.prismaService.txClient().dashboard.findFirstOrThrow({
        where: {
          id: dashboardId,
          baseId,
        },
        select: {
          layout: true,
        },
      });
      const layout = dashboard.layout ? (JSON.parse(dashboard.layout) as IDashboardLayout) : [];
      const index = layout.findIndex((item) => item.pluginInstallId === pluginInstallId);
      if (index !== -1) {
        layout.splice(index, 1);
        await this.prismaService.txClient().dashboard.update({
          where: {
            id: dashboardId,
          },
          data: {
            layout: JSON.stringify(layout),
          },
        });
      }
    });
  }

  async renamePlugin(baseId: string, dashboardId: string, pluginInstallId: string, name: string) {
    return this.prismaService.$tx(async () => {
      const plugin = await this.prismaService
        .txClient()
        .pluginInstall.findFirstOrThrow({
          where: {
            baseId,
            id: pluginInstallId,
            positionId: dashboardId,
            plugin: {
              status: PluginStatus.Published,
            },
          },
          select: {
            id: true,
            name: true,
          },
        })
        .catch(() => {
          throw new NotFoundException('Plugin not found');
        });
      await this.prismaService.txClient().pluginInstall.update({
        where: {
          id: pluginInstallId,
        },
        data: {
          name,
        },
      });
      return {
        id: plugin.id,
        pluginInstallId: plugin.id,
        name,
      };
    });
  }
}
