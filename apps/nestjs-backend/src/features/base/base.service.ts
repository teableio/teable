import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { generateBaseId } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { ICreateBaseRo, IUpdateBaseRo } from '@teable-group/openapi';
import { ClsService } from 'nestjs-cls';
import { IDbProvider } from '../../db-provider/interface/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { CollaboratorService } from '../collaborator/collaborator.service';

@Injectable()
export class BaseService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService,
    @Inject('DbProvider') private dbProvider: IDbProvider
  ) {}

  async getBaseById(baseId: string) {
    const userId = this.cls.get('user.id');
    const { spaceIds } = await this.collaboratorService.getCollaboratorsBaseAndSpaceArray(userId);

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
    return base;
  }

  async getBaseList(spaceId?: string) {
    if (spaceId) {
      return await this.getBaseListBySpaceId(spaceId);
    }
    const userId = this.cls.get('user.id');
    const { spaceIds, baseIds } =
      await this.collaboratorService.getCollaboratorsBaseAndSpaceArray(userId);
    return await this.prismaService.base.findMany({
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
    });
  }

  async getBaseListBySpaceId(spaceId: string) {
    const userId = this.cls.get('user.id');
    const { spaceIds } = await this.collaboratorService.getCollaboratorsBaseAndSpaceArray(userId);
    if (!spaceIds.includes(spaceId)) {
      throw new ForbiddenException();
    }
    return await this.prismaService.base.findMany({
      select: {
        id: true,
        name: true,
        order: true,
        spaceId: true,
        icon: true,
      },
      where: {
        spaceId,
        deletedTime: null,
      },
    });
  }

  async createBase(createBaseRo: ICreateBaseRo) {
    const userId = this.cls.get('user.id');
    const { name, spaceId } = createBaseRo;

    return this.prismaService.$transaction(async (prisma) => {
      let order = createBaseRo.order;
      if (!order) {
        const spaceAggregate = await prisma.base.aggregate({
          where: { spaceId, deletedTime: null },
          _max: { order: true },
        });
        order = (spaceAggregate._max.order || 0) + 1;
      }

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
}
