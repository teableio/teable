import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActionPrefix,
  RoleType,
  actionPrefixMap,
  generateBaseId,
  getPermissionMap,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateBaseFromTemplateRo,
  ICreateBaseRo,
  IDuplicateBaseRo,
  IUpdateBaseRo,
  IUpdateOrderRo,
} from '@teable/openapi';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { PermissionService } from '../auth/permission.service';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { BaseDuplicateService } from './base-duplicate.service';

@Injectable()
export class BaseService {
  private logger = new Logger(BaseService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService,
    private readonly baseDuplicateService: BaseDuplicateService,
    private readonly permissionService: PermissionService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async getBaseById(baseId: string) {
    const userId = this.cls.get('user.id');
    const { spaceIds, roleMap } =
      await this.collaboratorService.getCollaboratorsBaseAndSpaceArray(userId);

    const base = await this.prismaService.base.findFirst({
      select: {
        id: true,
        name: true,
        icon: true,
        spaceId: true,
      },
      where: {
        id: baseId,
        deletedTime: null,
        spaceId: {
          in: spaceIds,
        },
      },
    });
    if (!base) {
      throw new NotFoundException('Base not found');
    }
    return {
      ...base,
      role: roleMap[base.id] || roleMap[base.spaceId],
    };
  }

  async getAllBaseList() {
    const userId = this.cls.get('user.id');
    const { spaceIds, baseIds, roleMap } =
      await this.collaboratorService.getCollaboratorsBaseAndSpaceArray(userId);
    const baseList = await this.prismaService.base.findMany({
      select: {
        id: true,
        name: true,
        order: true,
        spaceId: true,
        icon: true,
      },
      where: {
        deletedTime: null,
        OR: [
          {
            id: {
              in: baseIds,
            },
          },
          {
            spaceId: {
              in: spaceIds,
            },
          },
        ],
      },
      orderBy: [{ spaceId: 'asc' }, { order: 'asc' }],
    });
    return baseList.map((base) => ({ ...base, role: roleMap[base.id] || roleMap[base.spaceId] }));
  }

  async getAccessBaseList() {
    const userId = this.cls.get('user.id');
    const accessTokenId = this.cls.get('accessTokenId');
    const { spaceIds, baseIds } =
      await this.collaboratorService.getCollaboratorsBaseAndSpaceArray(userId);

    if (accessTokenId) {
      const access = await this.prismaService.accessToken.findFirst({
        select: {
          baseIds: true,
          spaceIds: true,
        },
        where: {
          id: accessTokenId,
          userId,
        },
      });
      if (!access) {
        return [];
      }
      spaceIds.push(...(access.spaceIds || []));
      baseIds.push(...(access.baseIds || []));
    }

    return this.prismaService.base.findMany({
      select: {
        id: true,
        name: true,
      },
      where: {
        deletedTime: null,
        OR: [
          {
            id: {
              in: baseIds,
            },
          },
          {
            spaceId: {
              in: spaceIds,
            },
          },
        ],
      },
      orderBy: [{ spaceId: 'asc' }, { order: 'asc' }],
    });
  }

  private async getMaxOrder(spaceId: string) {
    const spaceAggregate = await this.prismaService.base.aggregate({
      where: { spaceId, deletedTime: null },
      _max: { order: true },
    });
    return spaceAggregate._max.order || 0;
  }

  async createBase(createBaseRo: ICreateBaseRo) {
    const userId = this.cls.get('user.id');
    const { name, spaceId } = createBaseRo;

    return this.prismaService.$transaction(async (prisma) => {
      const order = (await this.getMaxOrder(spaceId)) + 1;

      const base = await prisma.base.create({
        data: {
          id: generateBaseId(),
          name: name || 'Untitled Base',
          spaceId,
          order,
          createdBy: userId,
        },
        select: {
          id: true,
          name: true,
          icon: true,
          spaceId: true,
        },
      });

      const sqlList = this.dbProvider.createSchema(base.id);
      if (sqlList) {
        for (const sql of sqlList) {
          await prisma.$executeRawUnsafe(sql);
        }
      }

      return base;
    });
  }

  async updateBase(baseId: string, updateBaseRo: IUpdateBaseRo) {
    const userId = this.cls.get('user.id');

    return this.prismaService.base.update({
      data: {
        ...updateBaseRo,
        lastModifiedBy: userId,
      },
      select: {
        id: true,
        name: true,
        spaceId: true,
      },
      where: {
        id: baseId,
        deletedTime: null,
      },
    });
  }

  async shuffle(spaceId: string) {
    const bases = await this.prismaService.base.findMany({
      where: { spaceId, deletedTime: null },
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    this.logger.log(`lucky base shuffle! ${spaceId}`, 'shuffle');

    await this.prismaService.$tx(async (prisma) => {
      for (let i = 0; i < bases.length; i++) {
        const base = bases[i];
        await prisma.base.update({
          data: { order: i },
          where: { id: base.id },
        });
      }
    });
  }

  async updateOrder(baseId: string, orderRo: IUpdateOrderRo) {
    const { anchorId, position } = orderRo;

    const base = await this.prismaService.base
      .findFirstOrThrow({
        select: { spaceId: true, order: true, id: true },
        where: { id: baseId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Base ${baseId} not found`);
      });

    const anchorBase = await this.prismaService.base
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { spaceId: base.spaceId, id: anchorId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Anchor ${anchorId} not found`);
      });

    await updateOrder({
      query: base.spaceId,
      position,
      item: base,
      anchorItem: anchorBase,
      getNextItem: async (whereOrder, align) => {
        return this.prismaService.base.findFirst({
          select: { order: true, id: true },
          where: {
            spaceId: base.spaceId,
            deletedTime: null,
            order: whereOrder,
          },
          orderBy: { order: align },
        });
      },
      update: async (_, id, data) => {
        await this.prismaService.base.update({
          data: { order: data.newOrder },
          where: { id },
        });
      },
      shuffle: this.shuffle.bind(this),
    });
  }

  async deleteBase(baseId: string) {
    const userId = this.cls.get('user.id');

    await this.prismaService.base.update({
      data: { deletedTime: new Date(), lastModifiedBy: userId },
      where: { id: baseId, deletedTime: null },
    });
  }

  async duplicateBase(duplicateBaseRo: IDuplicateBaseRo) {
    // permission check, base read permission
    await this.checkBaseReadPermission(duplicateBaseRo.fromBaseId);
    return await this.prismaService.$tx(
      async () => {
        return await this.baseDuplicateService.duplicate(duplicateBaseRo);
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }

  private async checkBaseReadPermission(baseId: string) {
    // First check if the user has the base read permission
    await this.permissionService.validPermissions(baseId, ['base|read']);

    // Then check the token permissions if the request was made with a token
    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      await this.permissionService.validPermissions(baseId, ['base|read'], accessTokenId);
    }
  }

  async createBaseFromTemplate(createBaseFromTemplateRo: ICreateBaseFromTemplateRo) {
    const { spaceId, templateId, withRecords } = createBaseFromTemplateRo;
    return await this.prismaService.$tx(async () => {
      return await this.baseDuplicateService.duplicate({
        fromBaseId: templateId,
        spaceId,
        withRecords,
      });
    });
  }

  async getPermission(baseId: string) {
    const { role } = await this.getBaseById(baseId);
    const permissionMap = getPermissionMap(RoleType.Base, role);
    return pick(permissionMap, [
      ...actionPrefixMap[ActionPrefix.Table],
      ...actionPrefixMap[ActionPrefix.Base],
      ...actionPrefixMap[ActionPrefix.Automation],
    ]);
  }
}
