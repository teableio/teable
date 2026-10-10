import { Injectable } from '@nestjs/common';
import { generatePluginInstallId, HttpErrorCode } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition } from '@teable/openapi';
import type {
  IPluginContextMenuRenameRo,
  IPluginContextMenuInstallRo,
  IPluginContextMenuUpdateStorageRo,
  IPluginContextMenuMoveRo,
  IPluginContextMenuGetItem,
  IPluginConfig,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { AuditScope } from '../audit/audit-scope';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { installablePluginWhere } from '../plugin/utils';

@Injectable()
export class PluginContextMenuService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService,
    private readonly audit: AuditScope
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
      throw new CustomHttpException('Table not found', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.table.notFound',
        },
      });
    }
    return base.baseId;
  }

  async installPluginContextMenu(tableId: string, body: IPluginContextMenuInstallRo) {
    const { pluginId, name } = body;
    const userId = this.cls.get('user.id');
    const plugin = await this.prismaService.plugin.findFirst({
      where: {
        id: pluginId,
        ...installablePluginWhere(userId),
      },
      select: {
        name: true,
      },
    });

    if (!plugin) {
      throw new CustomHttpException('Plugin not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.plugin.notFound',
        },
      });
    }

    const baseId = await this.getBaseId(tableId);
    const pluginName = name || plugin.name;
    const installed = await this.prismaService.$tx(async (prisma) => {
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
        // invite pluginUser to base, never above the installer's own role
        await this.collaboratorService.addPluginUserToBase(baseId, pluginInstall.plugin.pluginUser);
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
    await this.audit.emitAtomic({
      action: 'plugin.install',
      resourceId: installed.pluginInstallId,
      params: {
        pluginId,
        name: pluginName,
        location: PluginPosition.ContextMenu,
        baseId,
        tableId,
      },
    });
    return installed;
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
      throw new CustomHttpException('Plugin install not found', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.pluginInstall.notFound',
        },
      });
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
      throw new CustomHttpException('Plugin install not found', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.pluginInstall.notFound',
        },
      });
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
    const removed = await this.prismaService.$tx(async (prisma) => {
      await prisma.pluginContextMenu.deleteMany({
        where: { pluginInstallId, tableId },
      });
      return prisma.pluginInstall.delete({
        where: {
          id: pluginInstallId,
          baseId,
          positionId: tableId,
          position: PluginPosition.ContextMenu,
        },
      });
    });
    await this.audit.emitAtomic({
      action: 'plugin.uninstall',
      resourceId: pluginInstallId,
      params: {
        pluginId: removed.pluginId,
        name: removed.name,
        location: PluginPosition.ContextMenu,
        baseId,
        tableId,
      },
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
        throw new CustomHttpException(
          'Plugin Context Menu not found',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.pluginContextMenu.notFound',
            },
          }
        );
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
        throw new CustomHttpException(
          'Plugin Context Menu Anchor not found',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.pluginContextMenu.anchorNotFound',
            },
          }
        );
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
