import { Injectable, NotFoundException } from '@nestjs/common';
import { generateBaseId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateBaseFromTemplateRo,
  ICreateBaseRo,
  IDuplicateBaseRo,
  IUpdateBaseRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { BaseDuplicateService } from './base-duplicate.service';

@Injectable()
export class BaseService {
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
        order: true,
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

  async getBaseList() {
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
      orderBy: {
        createdTime: 'asc',
      },
    });
    return baseList.map((base) => ({ ...base, role: roleMap[base.id] || roleMap[base.spaceId] }));
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
      const order =
        createBaseRo.order == null ? (await this.getMaxOrder(spaceId)) + 1 : createBaseRo.order;

      const base = await prisma.base.create({
        data: {
          id: generateBaseId(),
          name: name || 'Untitled Base',
          spaceId,
          order,
          createdBy: userId,
          lastModifiedBy: userId,
        },
        select: {
          id: true,
          name: true,
          icon: true,
          spaceId: true,
          order: true,
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
        order: true,
      },
      where: {
        id: baseId,
        deletedTime: null,
      },
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
    await this.permissionService.checkPermissionByBaseId(baseId, ['base|read']);

    // Then check the token permissions if the request was made with a token
    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      await this.permissionService.checkPermissionByAccessToken(baseId, accessTokenId, [
        'base|read',
      ]);
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
}
