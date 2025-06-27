import { Injectable, NotFoundException } from '@nestjs/common';
import type { IBaseRole } from '@teable/core';
import { generatePluginInstallId, Role } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PluginPosition, PrincipalType } from '@teable/openapi';
import type {
  IPluginContextMenuRenameRo,
  IPluginContextMenuInstallRo,
  IPluginContextMenuUpdateStorageRo,
  IPluginContextMenuMoveRo,
  IPluginContextMenuGetItem,
  IPluginConfig,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { CollaboratorService } from '../collaborator/collaborator.service';

@Injectable()
export class PluginContextMenuService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService
  ) {}

  private async getMaxOrder(where: Prisma.PluginContextMenuWhereInput) {
    const aggregate = await this.prismaService.txClient().pluginContextMenu.aggregate({
      where,
      _max: { order: true },
    });
    return aggregate._max.order || 0;
  }

  private async getBaseId(tableId: string) {
    const base = await this.prismaService.tableMeta.findUnique({
      where: { id: tableId },
      select: { baseId: true },
    });
    if (!base) {
      throw new NotFoundException('Table not found');
    }
    return base.baseId;
  }

  async installPluginContextMenu(tableId: string, body: IPluginContextMenuInstallRo) {
    const { pluginId, name } = body;
    const plugin = await this.prismaService.plugin.findUnique({
      where: {
        id: pluginId,
      },
      select: {
        name: true,
      },
    });

    if (!plugin) {
      throw new NotFoundException('Plugin not found');
    }

    const baseId = await this.getBaseId(tableId);
    const pluginName = name || plugin.name;
    const userId = this.cls.get('user.id');
    return this.prismaService.$tx(async (prisma) => {
      const pluginInstall = await prisma.pluginInstall.create({
        data: {
          id: generatePluginInstallId(),
          pluginId,
          baseId,
          name: pluginName,
          positionId: tableId,
          position: PluginPosition.ContextMenu,
          createdBy: userId,
        },
        select: {
          id: true,
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
      const order = await this.getMaxOrder({ tableId });
      await prisma.pluginContextMenu.create({
        data: {
          pluginInstallId: pluginInstall.id,
          order: order + 1,
          createdBy: userId,
          tableId,
        },
      });
      return {
        pluginInstallId: pluginInstall.id,
        name: pluginName,
        order: order + 1,
      };
    });
  }

  async getPluginContextMenuList(tableId: string) {
    const baseId = await this.getBaseId(tableId);
    const pluginContextMenuList = await this.prismaService.pluginContextMenu.findMany({
      where: { tableId },
      select: {
        pluginInstallId: true,
        order: true,
      },
      orderBy: {
        order: 'asc',
      },
    });
    const pluginInstallList = await this.prismaService.pluginInstall.findMany({
      where: {
        baseId,
        positionId: tableId,
        position: PluginPosition.ContextMenu,
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        plugin: {
          select: {
            logo: true,
          },
        },
      },
    });
    return pluginContextMenuList.reduce((acc, item) => {
      const plugin = pluginInstallList.find((plugin) => plugin.id === item.pluginInstallId);
      if (!plugin) {
        return acc;
      }
      acc.push({
        pluginInstallId: plugin.id,
        name: plugin.name,
        pluginId: plugin.pluginId,
        logo: getPublicFullStorageUrl(plugin.plugin.logo),
        order: item.order,
      });
      return acc;
    }, [] as IPluginContextMenuGetItem[]);
  }

  async getPluginContextMenuStorage(tableId: string, pluginInstallId: string) {
    const baseId = await this.getBaseId(tableId);
    const res = await this.prismaService.pluginInstall.findUnique({
      where: {
        id: pluginInstallId,
        baseId,
        positionId: tableId,
        position: PluginPosition.ContextMenu,
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        storage: true,
      },
    });
    if (!res) {
      throw new NotFoundException('Plugin install not found');
    }
    return {
      name: res.name,
      tableId,
      pluginId: res.pluginId,
      pluginInstallId: res.id,
      storage: res.storage ? JSON.parse(res.storage) : undefined,
    };
  }

  async getPluginContextMenu(tableId: string, pluginInstallId: string) {
    const baseId = await this.getBaseId(tableId);
    const res = await this.prismaService.pluginInstall.findUnique({
      where: {
        id: pluginInstallId,
        baseId,
        positionId: tableId,
        position: PluginPosition.ContextMenu,
      },
      select: {
        id: true,
        name: true,
        pluginId: true,
        positionId: true,
        plugin: {
          select: {
            url: true,
            config: true,
          },
        },
      },
    });
    if (!res) {
      throw new NotFoundException('Plugin install not found');
    }
    return {
      tableId,
      positionId: res.positionId,
      pluginId: res.pluginId,
      pluginInstallId: res.id,
      name: res.name,
      url: res.plugin.url || undefined,
      config: res.plugin.config ? (JSON.parse(res.plugin.config) as IPluginConfig) : undefined,
    };
  }

  async renamePluginContextMenu(
    tableId: string,
    pluginInstallId: string,
    body: IPluginContextMenuRenameRo
  ) {
    const { name } = body;
    const baseId = await this.getBaseId(tableId);
    const res = await this.prismaService.pluginInstall.update({
      where: {
        id: pluginInstallId,
        baseId,
        positionId: tableId,
        position: PluginPosition.ContextMenu,
      },
      data: {
        name,
      },
    });
    return {
      pluginInstallId: res.id,
      name: res.name,
    };
  }

  async updatePluginContextMenuStorage(
    tableId: string,
    pluginInstallId: string,
    body: IPluginContextMenuUpdateStorageRo
  ) {
    const { storage } = body;
    const baseId = await this.getBaseId(tableId);
    const res = await this.prismaService.pluginInstall.update({
      where: {
        id: pluginInstallId,
        baseId,
        positionId: tableId,
        position: PluginPosition.ContextMenu,
      },
      data: { storage: JSON.stringify(storage) },
    });
    return {
      tableId,
      pluginInstallId: res.id,
      storage: res.storage ? JSON.parse(res.storage) : undefined,
    };
  }

  async deletePluginContextMenu(tableId: string, pluginInstallId: string) {
    const baseId = await this.getBaseId(tableId);
    await this.prismaService.$tx(async (prisma) => {
      await prisma.pluginContextMenu.deleteMany({
        where: { pluginInstallId, tableId },
      });
      await prisma.pluginInstall.delete({
        where: {
          id: pluginInstallId,
          baseId,
          positionId: tableId,
          position: PluginPosition.ContextMenu,
        },
      });
    });
  }

  async movePluginContextMenu(
    tableId: string,
    pluginInstallId: string,
    body: IPluginContextMenuMoveRo
  ) {
    const { anchorId, position } = body;

    const item = await this.prismaService.pluginContextMenu
      .findFirstOrThrow({
        select: { order: true, pluginInstallId: true },
        where: {
          pluginInstallId,
          tableId,
        },
      })
      .catch(() => {
        throw new NotFoundException('Plugin Context Menu not found');
      })
      .then((item) => ({
        ...item,
        id: item.pluginInstallId,
      }));

    const anchorItem = await this.prismaService.pluginContextMenu
      .findFirstOrThrow({
        select: { order: true, pluginInstallId: true },
        where: {
          pluginInstallId: anchorId,
          tableId,
        },
      })
      .catch(() => {
        throw new NotFoundException('Plugin Context Menu Anchor not found');
      })
      .then((item) => ({
        ...item,
        id: item.pluginInstallId,
      }));

    await updateOrder({
      query: tableId,
      position,
      item,
      anchorItem,
      getNextItem: async (whereOrder, align) => {
        return this.prismaService.pluginContextMenu
          .findFirst({
            select: { order: true, pluginInstallId: true },
            where: {
              tableId,
              order: whereOrder,
            },
            orderBy: { order: align },
          })
          .then((item) =>
            item
              ? {
                  ...item,
                  id: item.pluginInstallId,
                }
              : null
          );
      },
      update: async (parentId, id, data) => {
        await this.prismaService.pluginContextMenu.update({
          data: { order: data.newOrder },
          where: { pluginInstallId: id, tableId: parentId },
        });
      },
      shuffle: async () => {
        const orderKey = position === 'before' ? 'gte' : 'gt';
        await this.prismaService.pluginContextMenu.updateMany({
          data: { order: { increment: 1 } },
          where: {
            tableId,
            order: {
              [orderKey]: anchorItem.order,
            },
          },
        });
      },
    });
  }
}
