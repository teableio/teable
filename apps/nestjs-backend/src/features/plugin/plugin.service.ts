/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  generatePluginId,
  generatePluginUserId,
  getPluginEmail,
  nullsToUndefined,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType, PluginStatus } from '@teable/openapi';
import type {
  IGetPluginCenterListVo,
  ICreatePluginRo,
  ICreatePluginVo,
  IGetPluginsVo,
  IGetPluginVo,
  IPluginI18n,
  IPluginRegenerateSecretVo,
  IUpdatePluginRo,
  IUpdatePluginVo,
  PluginPosition,
  IPluginConfig,
} from '@teable/openapi';
import { omit } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { UserService } from '../user/user.service';
import { generateSecret } from './utils';

@Injectable()
export class PluginService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly userService: UserService
  ) {}

  private logoToVoValue(logo: string) {
    return getPublicFullStorageUrl(logo);
  }

  private convertToVo<
    T extends {
      positions: string;
      i18n?: string | null;
      status: string;
      config?: string | null;
      logo: string;
      createdTime?: Date | null;
      lastModifiedTime?: Date | null;
    },
  >(ro: T) {
    return nullsToUndefined({
      ...ro,
      logo: this.logoToVoValue(ro.logo),
      status: ro.status as PluginStatus,
      positions: JSON.parse(ro.positions) as PluginPosition[],
      i18n: ro.i18n ? (JSON.parse(ro.i18n) as IPluginI18n) : undefined,
      config: ro.config ? (JSON.parse(ro.config) as IPluginConfig) : undefined,
      createdTime: ro.createdTime?.toISOString(),
      lastModifiedTime: ro.lastModifiedTime?.toISOString(),
    });
  }

  private async getUserMap(userIds: string[]) {
    const users = await this.prismaService.txClient().user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });
    const systemUser = userIds.find((id) => id === 'system')
      ? {
          id: 'system',
          name: 'Teable',
          email: 'support@teable.ai',
          avatar: undefined,
        }
      : undefined;

    const userMap = users.reduce(
      (acc, user) => {
        if (user.id === 'system') {
          acc[user.id] = {
            id: user.id,
            name: 'Teable',
            email: 'support@teable.ai',
            avatar: undefined,
          };
          return acc;
        }
        acc[user.id] = {
          ...user,
          avatar: user.avatar ? getPublicFullStorageUrl(user.avatar) : undefined,
        };
        return acc;
      },
      {} as Record<string, { id: string; name: string; email: string; avatar?: string }>
    );

    return systemUser
      ? {
          ...userMap,
          system: systemUser,
        }
      : userMap;
  }

  async createPlugin(createPluginRo: ICreatePluginRo): Promise<ICreatePluginVo> {
    const userId = this.cls.get('user.id');
    const {
      name,
      description,
      detailDesc,
      helpUrl,
      logo,
      i18n,
      positions,
      url,
      autoCreateMember,
      config,
    } = createPluginRo;
    const { secret, hashedSecret, maskedSecret } = await generateSecret();
    const res = await this.prismaService.$tx(async (prisma) => {
      const pluginId = generatePluginId();
      const user = autoCreateMember
        ? await this.userService.createSystemUser({
            id: generatePluginUserId(),
            name,
            email: getPluginEmail(pluginId),
          })
        : null;
      const plugin = await prisma.plugin.create({
        select: {
          id: true,
          name: true,
          description: true,
          detailDesc: true,
          positions: true,
          helpUrl: true,
          logo: true,
          url: true,
          status: true,
          config: true,
          i18n: true,
          secret: true,
          createdTime: true,
        },
        data: {
          id: pluginId,
          name,
          description,
          detailDesc,
          positions: JSON.stringify(positions),
          helpUrl,
          url,
          logo,
          config: JSON.stringify(config),
          status: PluginStatus.Developing,
          i18n: JSON.stringify(i18n),
          secret: hashedSecret,
          maskedSecret,
          pluginUser: user?.id,
          createdBy: userId,
        },
      });
      return {
        ...plugin,
        secret,
        pluginUser: user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              avatar: user.avatar ? getPublicFullStorageUrl(user.avatar) : undefined,
            }
          : undefined,
      };
    });
    return this.convertToVo(res);
  }

  async updatePlugin(id: string, updatePluginRo: IUpdatePluginRo): Promise<IUpdatePluginVo> {
    const userId = this.cls.get('user.id');
    const isAdmin = this.cls.get('user.isAdmin');
    const { name, description, detailDesc, helpUrl, i18n, positions, url, config, logo } =
      updatePluginRo;
    const logoPath = logo?.startsWith('http')
      ? `/${StorageAdapter.getDir(UploadType.Plugin)}/${logo.split('/').pop()}`
      : logo;
    const res = await this.prismaService.$tx(async (prisma) => {
      const res = await prisma.plugin
        .update({
          select: {
            id: true,
            name: true,
            description: true,
            detailDesc: true,
            positions: true,
            helpUrl: true,
            logo: true,
            url: true,
            config: true,
            status: true,
            i18n: true,
            secret: true,
            pluginUser: true,
            createdTime: true,
            lastModifiedTime: true,
          },
          where: { id, createdBy: isAdmin ? { in: ['system', userId] } : userId },
          data: {
            name,
            description,
            detailDesc,
            positions: JSON.stringify(positions),
            helpUrl,
            url,
            logo: logoPath,
            config: JSON.stringify(config),
            i18n: JSON.stringify(i18n),
            lastModifiedBy: userId,
          },
        })
        .catch(() => {
          throw new NotFoundException('Plugin not found');
        });

      if (name && res.pluginUser) {
        await this.userService.updateUserName(res.pluginUser, name);
      }
      return res;
    });
    const userMap = res.pluginUser ? await this.getUserMap([res.pluginUser]) : {};
    return this.convertToVo({
      ...res,
      pluginUser: res.pluginUser ? userMap[res.pluginUser] : undefined,
    });
  }

  async getPlugin(id: string): Promise<IGetPluginVo> {
    const userId = this.cls.get('user.id');
    const isAdmin = this.cls.get('user.isAdmin');
    const res = await this.prismaService.plugin
      .findUniqueOrThrow({
        select: {
          id: true,
          name: true,
          description: true,
          detailDesc: true,
          positions: true,
          helpUrl: true,
          logo: true,
          url: true,
          status: true,
          config: true,
          i18n: true,
          maskedSecret: true,
          pluginUser: true,
          createdTime: true,
          lastModifiedTime: true,
        },
        where: { id, createdBy: isAdmin ? { in: ['system', userId] } : userId },
      })
      .catch(() => {
        throw new NotFoundException('Plugin not found');
      });
    const userMap = res.pluginUser ? await this.getUserMap([res.pluginUser]) : {};
    return this.convertToVo({
      ...omit(res, 'maskedSecret'),
      secret: res.maskedSecret,
      pluginUser: res.pluginUser ? userMap[res.pluginUser] : undefined,
    });
  }

  async getPlugins(): Promise<IGetPluginsVo> {
    const userId = this.cls.get('user.id');
    const isAdmin = this.cls.get('user.isAdmin');

    const res = await this.prismaService.plugin.findMany({
      where: { createdBy: isAdmin ? { in: ['system', userId] } : userId },
      select: {
        id: true,
        name: true,
        description: true,
        detailDesc: true,
        positions: true,
        helpUrl: true,
        logo: true,
        url: true,
        status: true,
        i18n: true,
        secret: true,
        pluginUser: true,
        createdTime: true,
        lastModifiedTime: true,
      },
    });
    const userIds = res.map((r) => r.pluginUser).filter((r) => r !== null) as string[];
    const userMap = await this.getUserMap(userIds);
    return res.map((r) =>
      this.convertToVo({
        ...r,
        pluginUser: r.pluginUser ? userMap[r.pluginUser] : undefined,
      })
    );
  }

  async delete(id: string) {
    await this.prismaService.$tx(async (prisma) => {
      const res = await prisma.plugin.delete({ where: { id } });
      if (res.pluginUser) {
        await prisma.user.delete({ where: { id: res.pluginUser } });
      }
    });
  }

  async regenerateSecret(id: string): Promise<IPluginRegenerateSecretVo> {
    const { secret, hashedSecret, maskedSecret } = await generateSecret();
    await this.prismaService.plugin.update({
      select: {
        id: true,
        secret: true,
      },
      where: { id },
      data: {
        secret: hashedSecret,
        maskedSecret,
      },
    });
    return { secret, id };
  }

  async getPluginCenterList(
    positions?: PluginPosition[],
    ids?: string[]
  ): Promise<IGetPluginCenterListVo> {
    const res = await this.prismaService.plugin.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        detailDesc: true,
        logo: true,
        status: true,
        url: true,
        helpUrl: true,
        i18n: true,
        createdTime: true,
        lastModifiedTime: true,
        createdBy: true,
      },
      where: {
        ...(ids?.length
          ? {
              id: { in: ids },
            }
          : {}),
        AND: [
          {
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
          ...(positions?.length
            ? [
                {
                  OR: positions.map((position) => ({ positions: { contains: position } })),
                },
              ]
            : []),
        ],
      },
    });
    const userIds = res.map((r) => r.createdBy);
    const userMap = await this.getUserMap(userIds);
    return res.map((r) =>
      nullsToUndefined({
        ...r,
        status: r.status as PluginStatus,
        logo: this.logoToVoValue(r.logo),
        i18n: r.i18n ? (JSON.parse(r.i18n) as IPluginI18n) : undefined,
        createdBy: userMap[r.createdBy],
        createdTime: r.createdTime?.toISOString(),
        lastModifiedTime: r.lastModifiedTime?.toISOString(),
      })
    );
  }

  async submitPlugin(id: string) {
    const userId = this.cls.get('user.id');
    await this.prismaService.plugin.update({
      where: { id, createdBy: userId },
      data: { status: PluginStatus.Reviewing },
    });
  }

  async unpublishPlugin(id: string) {
    await this.prismaService.plugin.update({
      where: { id, status: PluginStatus.Published },
      data: { status: PluginStatus.Developing },
    });
  }
}
