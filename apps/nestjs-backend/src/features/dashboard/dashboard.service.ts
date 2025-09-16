/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { IBaseRole } from '@teable/core';
import { generateDashboardId, generatePluginInstallId, getUniqName, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PluginPosition, PluginStatus, PrincipalType } from '@teable/openapi';
import type {
  IBaseJson,
  ICreateDashboardRo,
  IDashboardInstallPluginRo,
  IDuplicateDashboardInstalledPluginRo,
  IDuplicateDashboardRo,
  IGetDashboardInstallPluginVo,
  IGetDashboardListVo,
  IGetDashboardVo,
  IUpdateLayoutDashboardRo,
} from '@teable/openapi';
import type { IDashboardLayout, IDashboardPluginItem } from '@teable/openapi/src/dashboard/types';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { BaseImportService } from '../base/base-import.service';
import { CollaboratorService } from '../collaborator/collaborator.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService,
    private readonly baseImportService: BaseImportService
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
      orderBy: {
        createdTime: 'asc',
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

  private async validatePluginPublished(_baseId: string, pluginId: string) {
    return this.prismaService.plugin
      .findFirstOrThrow({
        where: {
          id: pluginId,
          OR: [
            {
              status: PluginStatus.Published,
            },
            {
              status: { not: PluginStatus.Published },
              createdBy: this.cls.get('user.id'),
            },
          ],
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
          plugin: {
            select: {
              pluginUser: true,
            },
          },
        },
      });
      if (newInstallPlugin.plugin.pluginUser) {
        // invite pluginUser to base
        const exist = await this.prismaService.txClient().collaborator.count({
          where: {
            principalId: newInstallPlugin.plugin.pluginUser,
            principalType: PrincipalType.User,
            resourceId: baseId,
            resourceType: CollaboratorType.Base,
          },
        });

        if (!exist) {
          await this.collaboratorService.createBaseCollaborator({
            collaborators: [
              {
                principalId: newInstallPlugin.plugin.pluginUser,
                principalType: PrincipalType.User,
              },
            ],
            baseId,
            role: Role.Owner as IBaseRole,
          });
        }
      }

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

  private async validateDashboard(baseId: string, dashboardId: string) {
    await this.prismaService
      .txClient()
      .dashboard.findFirstOrThrow({
        where: {
          baseId,
          id: dashboardId,
        },
      })
      .catch(() => {
        throw new NotFoundException('Dashboard not found');
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
              OR: [
                {
                  status: PluginStatus.Published,
                },
                {
                  status: { not: PluginStatus.Published },
                  createdBy: this.cls.get('user.id'),
                },
              ],
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

  private async validateAndGetPluginInstall(pluginInstallId: string) {
    return this.prismaService
      .txClient()
      .pluginInstall.findFirstOrThrow({
        where: {
          id: pluginInstallId,
          plugin: {
            OR: [
              {
                status: PluginStatus.Published,
              },
              {
                status: { not: PluginStatus.Published },
                createdBy: this.cls.get('user.id'),
              },
            ],
          },
        },
      })
      .catch(() => {
        throw new NotFoundException('Plugin not found');
      });
  }

  async renamePlugin(baseId: string, dashboardId: string, pluginInstallId: string, name: string) {
    return this.prismaService.$tx(async () => {
      await this.validateDashboard(baseId, dashboardId);
      const plugin = await this.validateAndGetPluginInstall(pluginInstallId);
      await this.prismaService.txClient().pluginInstall.update({
        where: {
          id: pluginInstallId,
        },
        data: {
          name,
        },
      });
      return {
        id: plugin.pluginId,
        pluginInstallId,
        name,
      };
    });
  }

  async updatePluginStorage(
    baseId: string,
    dashboardId: string,
    pluginInstallId: string,
    storage?: Record<string, unknown>
  ) {
    return this.prismaService.$tx(async () => {
      await this.validateDashboard(baseId, dashboardId);
      await this.validateAndGetPluginInstall(pluginInstallId);
      const res = await this.prismaService.txClient().pluginInstall.update({
        where: {
          id: pluginInstallId,
        },
        data: {
          storage: storage ? JSON.stringify(storage) : null,
        },
      });
      return {
        baseId,
        dashboardId,
        pluginInstallId: res.id,
        storage: res.storage ? JSON.parse(res.storage) : undefined,
      };
    });
  }

  async getPluginInstall(
    baseId: string,
    dashboardId: string,
    pluginInstallId: string
  ): Promise<IGetDashboardInstallPluginVo> {
    await this.validateDashboard(baseId, dashboardId);
    const plugin = await this.validateAndGetPluginInstall(pluginInstallId);
    return {
      name: plugin.name,
      baseId: plugin.baseId,
      pluginId: plugin.pluginId,
      pluginInstallId: plugin.id,
      storage: plugin.storage ? JSON.parse(plugin.storage) : undefined,
    };
  }

  async duplicateDashboard(
    baseId: string,
    dashboardId: string,
    duplicateDashboardRo: IDuplicateDashboardRo
  ) {
    const { name } = duplicateDashboardRo;
    const dashboard = (await this.prismaService.txClient().dashboard.findFirstOrThrow({
      where: {
        baseId,
        id: dashboardId,
      },
      select: {
        id: true,
        name: true,
        layout: true,
      },
    })) as IBaseJson['plugins'][PluginPosition.Dashboard][number];

    const installedPlugins = await this.prismaService.txClient().pluginInstall.findMany({
      where: {
        baseId,
        positionId: dashboardId,
        position: PluginPosition.Dashboard,
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        storage: true,
        position: true,
        positionId: true,
      },
    });

    dashboard.pluginInstall = installedPlugins.map((plugin) => ({
      ...plugin,
      position: PluginPosition.Dashboard,
      storage: plugin.storage ? JSON.parse(plugin.storage) : {},
    }));

    dashboard.layout = dashboard.layout ? JSON.parse(dashboard.layout) : undefined;

    const dashboardList = await this.prismaService.txClient().dashboard.findMany({
      where: {
        baseId,
      },
      select: {
        name: true,
      },
    });

    const newName = getUniqName(
      name ?? dashboard.name,
      dashboardList.map((item) => item.name)
    );

    dashboard.name = newName;

    return this.prismaService.$tx(async () => {
      const { dashboardMap } = await this.baseImportService.createDashboard(
        baseId,
        [dashboard],
        {},
        {},
        true
      );

      const newDashboardId = dashboardMap[dashboardId];

      return {
        id: newDashboardId,
        name: newName,
      };
    });
  }

  async duplicateDashboardInstalledPlugin(
    baseId: string,
    dashboardId: string,
    pluginInstallId: string,
    duplicateDashboardInstalledPluginRo: IDuplicateDashboardInstalledPluginRo
  ) {
    return this.prismaService.$tx(async () => {
      const { name } = duplicateDashboardInstalledPluginRo;
      const installedPlugins = await this.prismaService.txClient().pluginInstall.findFirstOrThrow({
        where: {
          baseId,
          id: pluginInstallId,
          position: PluginPosition.Dashboard,
        },
      });
      const names = await this.prismaService.txClient().pluginInstall.findMany({
        where: {
          baseId,
          positionId: dashboardId,
          position: PluginPosition.Dashboard,
        },
        select: {
          name: true,
        },
      });

      const newName = getUniqName(
        name ?? installedPlugins.name,
        names.map((item) => item.name)
      );

      const newPluginInstallId = generatePluginInstallId();

      await this.prismaService.txClient().pluginInstall.create({
        data: {
          ...installedPlugins,
          id: newPluginInstallId,
          name: newName,
        },
      });

      const dashboard = await this.prismaService.txClient().dashboard.findFirstOrThrow({
        where: {
          baseId,
          id: dashboardId,
        },
        select: {
          layout: true,
        },
      });

      const layout = dashboard.layout ? (JSON.parse(dashboard.layout) as IDashboardLayout) : [];
      const sourceLayout = layout.find((item) => item.pluginInstallId === pluginInstallId);
      layout.push({
        pluginInstallId: newPluginInstallId,
        x: (layout.length * 2) % 12,
        y: Number.MAX_SAFE_INTEGER, // puts it at the bottom
        w: sourceLayout?.w || 2,
        h: sourceLayout?.h || 2,
      });

      await this.prismaService.txClient().dashboard.update({
        where: {
          id: dashboardId,
        },
        data: {
          layout: JSON.stringify(layout),
        },
      });

      return {
        id: newPluginInstallId,
        name: newName,
      };
    });
  }
}
