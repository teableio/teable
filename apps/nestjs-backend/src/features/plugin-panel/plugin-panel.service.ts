/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { IBaseRole } from '@teable/core';
import {
  generatePluginInstallId,
  generatePluginPanelId,
  getUniqName,
  nullsToUndefined,
  Role,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PluginPosition, PrincipalType } from '@teable/openapi';
import type {
  IPluginPanelRenameRo,
  IPluginPanelUpdateLayoutRo,
  IPluginPanelCreateRo,
  IPluginPanelInstallRo,
  IDashboardLayout,
  IPluginPanelUpdateStorageRo,
  IPluginPanelPluginItem,
  IDuplicatePluginPanelRo,
  IBaseJson,
  IDuplicatePluginPanelInstalledPluginRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { BaseImportService } from '../base/base-import.service';
import { CollaboratorService } from '../collaborator/collaborator.service';

@Injectable()
export class PluginPanelService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService,
    private readonly baseImportService: BaseImportService
  ) {}

  createPluginPanel(tableId: string, createPluginPanelRo: IPluginPanelCreateRo) {
    const { name } = createPluginPanelRo;
    return this.prismaService.pluginPanel.create({
      select: {
        id: true,
        name: true,
      },
      data: {
        id: generatePluginPanelId(),
        name,
        tableId,
        createdBy: this.cls.get('user.id'),
      },
    });
  }

  getPluginPanels(tableId: string) {
    return this.prismaService.pluginPanel.findMany({
      where: {
        tableId,
      },
      select: {
        id: true,
        name: true,
      },
    });
  }

  async getPluginPanel(tableId: string, pluginPanelId: string) {
    const panel = await this.prismaService.pluginPanel.findUnique({
      where: {
        id: pluginPanelId,
        tableId,
      },
      select: {
        id: true,
        name: true,
        layout: true,
      },
    });

    if (!panel) {
      throw new NotFoundException('Plugin panel not found');
    }

    const plugins = await this.prismaService.pluginInstall.findMany({
      where: {
        position: PluginPosition.Panel,
        positionId: pluginPanelId,
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        positionId: true,
        plugin: {
          select: {
            url: true,
          },
        },
      },
    });

    return {
      ...panel,
      layout: panel.layout ? JSON.parse(panel.layout) : undefined,
      pluginMap: plugins.reduce(
        (acc, plugin) => {
          acc[plugin.id] = nullsToUndefined({
            id: plugin.pluginId,
            name: plugin.name,
            positionId: plugin.positionId,
            url: plugin.plugin.url,
            pluginInstallId: plugin.id,
          });
          return acc;
        },
        {} as Record<string, IPluginPanelPluginItem>
      ),
    };
  }

  renamePluginPanel(
    tableId: string,
    pluginPanelId: string,
    renamePluginPanelRo: IPluginPanelRenameRo
  ) {
    const { name } = renamePluginPanelRo;
    return this.prismaService.pluginPanel.update({
      where: { id: pluginPanelId, tableId },
      data: { name, lastModifiedBy: this.cls.get('user.id') },
      select: {
        id: true,
        name: true,
      },
    });
  }

  deletePluginPanel(tableId: string, pluginPanelId: string) {
    return this.prismaService.pluginPanel.delete({
      where: { id: pluginPanelId, tableId },
    });
  }

  async updatePluginPanelLayout(
    tableId: string,
    pluginPanelId: string,
    updatePluginPanelLayoutRo: IPluginPanelUpdateLayoutRo
  ) {
    const { layout } = updatePluginPanelLayoutRo;
    const res = await this.prismaService.pluginPanel.update({
      where: { id: pluginPanelId, tableId },
      data: { layout: JSON.stringify(layout), lastModifiedBy: this.cls.get('user.id') },
      select: {
        id: true,
        layout: true,
      },
    });
    return {
      id: res.id,
      layout: res.layout ? JSON.parse(res.layout) : undefined,
    };
  }

  private async getBaseId(tableId: string) {
    const base = await this.prismaService.tableMeta.findUnique({
      where: {
        id: tableId,
      },
      select: {
        baseId: true,
      },
    });
    if (!base) {
      throw new NotFoundException('Table not found');
    }
    return base.baseId;
  }

  async installPluginPanel(
    tableId: string,
    pluginPanelId: string,
    installPluginPanelRo: IPluginPanelInstallRo
  ) {
    const { pluginId, name } = installPluginPanelRo;
    const currentUser = this.cls.get('user.id');
    const baseId = await this.getBaseId(tableId);
    return this.prismaService.$tx(async (prisma) => {
      const plugin = await prisma.plugin.findUnique({
        where: {
          id: pluginId,
        },
      });
      if (!plugin) {
        throw new NotFoundException('Plugin not found');
      }
      const pluginInstall = await prisma.pluginInstall.create({
        data: {
          id: generatePluginInstallId(),
          pluginId,
          baseId,
          name: name ?? plugin.name,
          position: PluginPosition.Panel,
          positionId: pluginPanelId,
          createdBy: currentUser,
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
      if (pluginInstall.plugin.pluginUser) {
        // invite pluginUser to base
        const exist = await this.prismaService.txClient().collaborator.count({
          where: {
            principalId: pluginInstall.plugin.pluginUser,
            principalType: PrincipalType.User,
            resourceId: baseId,
            resourceType: CollaboratorType.Base,
          },
        });

        if (!exist) {
          await this.collaboratorService.createBaseCollaborator({
            collaborators: [
              {
                principalId: pluginInstall.plugin.pluginUser,
                principalType: PrincipalType.User,
              },
            ],
            baseId,
            role: Role.Owner as IBaseRole,
          });
        }
      }
      const pluginPanel = await prisma.pluginPanel.findUnique({
        where: {
          id: pluginPanelId,
          tableId,
        },
        select: {
          layout: true,
        },
      });
      if (!pluginPanel) {
        throw new NotFoundException('Plugin panel not found');
      }
      const layout = pluginPanel.layout ? (JSON.parse(pluginPanel.layout) as IDashboardLayout) : [];
      layout.push({
        pluginInstallId: pluginInstall.id,
        x: 0,
        y: Number.MAX_SAFE_INTEGER, // puts it at the bottom
        w: 1,
        h: 3,
      });
      await prisma.pluginPanel.update({
        where: { id: pluginPanelId, tableId },
        data: { layout: JSON.stringify(layout) },
      });
      return {
        pluginId: pluginInstall.pluginId,
        name: pluginInstall.name,
        pluginInstallId: pluginInstall.id,
      };
    });
  }

  async removePluginPanelPlugin(tableId: string, pluginPanelId: string, pluginInstallId: string) {
    const baseId = await this.getBaseId(tableId);
    await this.prismaService.$tx(async (prisma) => {
      await prisma.pluginInstall.delete({
        where: { id: pluginInstallId, positionId: pluginPanelId, baseId },
      });

      const pluginPanel = await prisma.pluginPanel.findUnique({
        where: { id: pluginPanelId, tableId },
        select: {
          layout: true,
        },
      });
      if (!pluginPanel) {
        throw new NotFoundException('Plugin panel not found');
      }
      const layout = pluginPanel.layout ? (JSON.parse(pluginPanel.layout) as IDashboardLayout) : [];
      const index = layout.findIndex((item) => item.pluginInstallId === pluginInstallId);
      if (index !== -1) {
        layout.splice(index, 1);
        await prisma.pluginPanel.update({
          where: {
            id: pluginPanelId,
          },
          data: {
            layout: JSON.stringify(layout),
          },
        });
      }
    });
  }

  async renamePluginPanelPlugin(
    tableId: string,
    pluginPanelId: string,
    pluginInstallId: string,
    renamePluginPanelPluginRo: IPluginPanelRenameRo
  ) {
    const { name } = renamePluginPanelPluginRo;
    const baseId = await this.getBaseId(tableId);
    await this.prismaService.pluginInstall.update({
      where: { id: pluginInstallId, positionId: pluginPanelId, baseId },
      data: { name, lastModifiedBy: this.cls.get('user.id') },
    });
    return {
      id: pluginInstallId,
      name,
    };
  }

  async updatePluginPanelPluginStorage(
    tableId: string,
    pluginPanelId: string,
    pluginInstallId: string,
    updatePluginPanelPluginStorageRo: IPluginPanelUpdateStorageRo
  ) {
    const { storage } = updatePluginPanelPluginStorageRo;
    const baseId = await this.getBaseId(tableId);
    const res = await this.prismaService.pluginInstall.update({
      where: { id: pluginInstallId, positionId: pluginPanelId, baseId },
      data: {
        storage: storage ? JSON.stringify(storage) : null,
        lastModifiedBy: this.cls.get('user.id'),
      },
      select: {
        id: true,
        storage: true,
      },
    });
    return {
      pluginInstallId: res.id,
      tableId,
      pluginPanelId,
      storage: res.storage ? JSON.parse(res.storage) : undefined,
    };
  }

  async getPluginPanelPlugin(tableId: string, pluginPanelId: string, pluginInstallId: string) {
    const baseId = await this.getBaseId(tableId);
    const pluginInstall = await this.prismaService.pluginInstall.findUnique({
      where: { id: pluginInstallId, positionId: pluginPanelId, baseId },
      select: {
        id: true,
        name: true,
        pluginId: true,
        storage: true,
      },
    });
    if (!pluginInstall) {
      throw new NotFoundException('Plugin install not found');
    }
    return {
      baseId,
      name: pluginInstall.name,
      tableId,
      pluginId: pluginInstall.pluginId,
      pluginInstallId: pluginInstall.id,
      storage: pluginInstall.storage ? JSON.parse(pluginInstall.storage) : undefined,
    };
  }

  async duplicatePluginPanel(
    tableId: string,
    pluginPanelId: string,
    duplicatePluginPanelRo: IDuplicatePluginPanelRo
  ) {
    const { name } = duplicatePluginPanelRo;
    const pluginPanel = (await this.prismaService.txClient().pluginPanel.findFirstOrThrow({
      where: {
        tableId,
        id: pluginPanelId,
      },
      select: {
        id: true,
        name: true,
        layout: true,
        tableId: true,
      },
    })) as IBaseJson['plugins'][PluginPosition.Panel][number];

    const installedPlugins = await this.prismaService.txClient().pluginInstall.findMany({
      where: {
        positionId: pluginPanelId,
        position: PluginPosition.Panel,
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        storage: true,
        position: true,
        positionId: true,
        baseId: true,
      },
    });

    pluginPanel.pluginInstall = installedPlugins.map((plugin) => ({
      ...plugin,
      position: PluginPosition.Panel,
      storage: plugin.storage ? JSON.parse(plugin.storage) : {},
    }));

    pluginPanel.layout = pluginPanel.layout ? JSON.parse(pluginPanel.layout) : undefined;

    const pluginPanelNames = await this.prismaService.txClient().pluginPanel.findMany({
      where: {
        tableId,
      },
      select: {
        name: true,
      },
    });

    const newName = getUniqName(
      name ?? pluginPanel.name,
      pluginPanelNames.map((item) => item.name)
    );

    pluginPanel.name = newName;

    const baseId = installedPlugins[0].baseId;

    return this.prismaService.$tx(async () => {
      const { panelMap } = await this.baseImportService.createPanel(
        baseId,
        [pluginPanel],
        { [tableId]: tableId },
        {}
      );

      const newDashboardId = panelMap[pluginPanelId];

      return {
        id: newDashboardId,
        name: newName,
      };
    });
  }

  async duplicatePluginPanelPlugin(
    tableId: string,
    pluginPanelId: string,
    pluginInstallId: string,
    duplicatePluginPanelInstalledPluginRo: IDuplicatePluginPanelInstalledPluginRo
  ) {
    const baseId = await this.getBaseId(tableId);

    return this.prismaService.$tx(async () => {
      const { name } = duplicatePluginPanelInstalledPluginRo;
      const installedPlugins = await this.prismaService.txClient().pluginInstall.findFirstOrThrow({
        where: {
          baseId,
          id: pluginInstallId,
          position: PluginPosition.Panel,
        },
      });
      const names = await this.prismaService.txClient().pluginInstall.findMany({
        where: {
          baseId,
          positionId: pluginPanelId,
          position: PluginPosition.Panel,
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

      const pluginPanel = await this.prismaService.txClient().pluginPanel.findFirstOrThrow({
        where: {
          tableId,
          id: pluginPanelId,
        },
        select: {
          layout: true,
        },
      });

      const layout = pluginPanel.layout ? (JSON.parse(pluginPanel.layout) as IDashboardLayout) : [];

      const sourceLayout = layout.find((item) => item.pluginInstallId === pluginInstallId);
      layout.push({
        pluginInstallId: newPluginInstallId,
        x: (layout.length * 2) % 12,
        y: Number.MAX_SAFE_INTEGER, // puts it at the bottom
        w: sourceLayout?.w || 2,
        h: sourceLayout?.h || 2,
      });

      await this.prismaService.txClient().pluginPanel.update({
        where: {
          id: pluginPanelId,
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
