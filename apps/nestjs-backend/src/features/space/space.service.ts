import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { IRole } from '@teable/core';
import { Role, generateSpaceId, getUniqName } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, type ICreateSpaceRo, type IUpdateSpaceRo } from '@teable/openapi';
import { keyBy, map } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { CollaboratorService } from '../collaborator/collaborator.service';

@Injectable()
export class SpaceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService
  ) {}

  async createSpaceByParams(spaceCreateInput: Prisma.SpaceCreateInput) {
    return await this.prismaService.$tx(async () => {
      const result = await this.prismaService.txClient().space.create({
        select: {
          id: true,
          name: true,
        },
        data: spaceCreateInput,
      });
      await this.collaboratorService.createSpaceCollaborator(
        spaceCreateInput.createdBy,
        result.id,
        Role.Owner
      );
      return result;
    });
  }

  async getSpaceById(spaceId: string) {
    const userId = this.cls.get('user.id');

    const space = await this.prismaService.space.findFirst({
      select: {
        id: true,
        name: true,
      },
      where: {
        id: spaceId,
        deletedTime: null,
      },
    });
    if (!space) {
      throw new NotFoundException('Space not found');
    }
    const collaborator = await this.prismaService.collaborator.findFirst({
      select: {
        roleName: true,
      },
      where: {
        resourceId: spaceId,
        userId,
      },
    });
    if (!collaborator) {
      throw new ForbiddenException();
    }
    return {
      ...space,
      role: collaborator.roleName as IRole,
    };
  }

  async getSpaceList() {
    const userId = this.cls.get('user.id');

    const collaboratorSpaceList = await this.prismaService.collaborator.findMany({
      select: {
        resourceId: true,
        roleName: true,
      },
      where: {
        userId,
        resourceType: CollaboratorType.Space,
      },
    });
    const spaceIds = map(collaboratorSpaceList, 'resourceId') as string[];
    const spaceList = await this.prismaService.space.findMany({
      where: { id: { in: spaceIds }, deletedTime: null },
      select: { id: true, name: true },
      orderBy: { createdTime: 'asc' },
    });
    const roleMap = keyBy(collaboratorSpaceList, 'resourceId');
    return spaceList.map((space) => ({
      ...space,
      role: roleMap[space.id].roleName as IRole,
    }));
  }

  async createSpace(createSpaceRo: ICreateSpaceRo) {
    const userId = this.cls.get('user.id');
    const isAdmin = this.cls.get('user.isAdmin');

    if (!isAdmin) {
      const setting = await this.prismaService.setting.findFirst({
        select: {
          disallowSpaceCreation: true,
        },
      });

      if (setting?.disallowSpaceCreation) {
        throw new ForbiddenException(
          'The current instance disallow space creation by the administrator'
        );
      }
    }

    const spaceList = await this.prismaService.space.findMany({
      where: { deletedTime: null, createdBy: userId },
      select: { name: true },
    });

    const names = spaceList.map((space) => space.name);
    const uniqName = getUniqName(createSpaceRo.name ?? 'Space', names);
    return await this.createSpaceByParams({
      id: generateSpaceId(),
      name: uniqName,
      createdBy: userId,
    });
  }

  async updateSpace(spaceId: string, updateSpaceRo: IUpdateSpaceRo) {
    const userId = this.cls.get('user.id');

    return await this.prismaService.space.update({
      select: {
        id: true,
        name: true,
      },
      data: {
        ...updateSpaceRo,
        lastModifiedBy: userId,
      },
      where: {
        id: spaceId,
        deletedTime: null,
      },
    });
  }

  async deleteSpace(spaceId: string) {
    const userId = this.cls.get('user.id');

    await this.prismaService.$tx(async () => {
      await this.prismaService.txClient().space.update({
        data: {
          deletedTime: new Date(),
          lastModifiedBy: userId,
        },
        where: {
          id: spaceId,
          deletedTime: null,
        },
      });
    });
  }

  async getBaseListBySpaceId(spaceId: string) {
    const userId = this.cls.get('user.id');
    const { spaceIds, roleMap } =
      await this.collaboratorService.getCollaboratorsBaseAndSpaceArray(userId);
    if (!spaceIds.includes(spaceId)) {
      throw new ForbiddenException();
    }
    const baseList = await this.prismaService.base.findMany({
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
      orderBy: {
        order: 'asc',
      },
    });

    return baseList.map((base) => ({ ...base, role: roleMap[base.id] || roleMap[base.spaceId] }));
  }
}
