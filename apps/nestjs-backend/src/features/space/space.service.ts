import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SpaceRole, generateSpaceId, getUniqName } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { ICreateSpaceRo, IUpdateSpaceRo } from '@teable-group/openapi';
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
      const result = await this.prismaService.space.create({
        select: {
          id: true,
          name: true,
        },
        data: spaceCreateInput,
      });
      await this.collaboratorService.createSpaceCollaborator(
        spaceCreateInput.createdBy,
        result.id,
        SpaceRole.Owner
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
        spaceId,
        userId,
        deletedTime: null,
      },
    });
    if (!collaborator) {
      throw new ForbiddenException();
    }
    return {
      ...space,
      role: collaborator.roleName as SpaceRole,
    };
  }

  async getSpaceList() {
    const userId = this.cls.get('user.id');

    const collaboratorSpaceList = await this.prismaService.collaborator.findMany({
      select: {
        spaceId: true,
        roleName: true,
      },
      where: {
        userId,
        spaceId: { not: null },
        deletedTime: null,
      },
    });
    const spaceIds = map(collaboratorSpaceList, 'spaceId') as string[];
    const spaceList = await this.prismaService.space.findMany({
      where: { id: { in: spaceIds } },
      select: { id: true, name: true },
    });
    const roleMap = keyBy(collaboratorSpaceList, 'spaceId');
    return spaceList.map((space) => ({
      ...space,
      role: roleMap[space.id].roleName as SpaceRole,
    }));
  }

  async createSpace(createSpaceRo: ICreateSpaceRo) {
    const userId = this.cls.get('user.id');

    const spaceList = await this.prismaService.space.findMany({
      where: { deletedTime: null, createdBy: userId },
      select: { name: true },
    });

    const names = spaceList.map((space) => space.name);
    const uniqName = getUniqName(createSpaceRo.name ?? 'Workspace', names);
    return await this.createSpaceByParams({
      id: generateSpaceId(),
      name: uniqName,
      createdBy: userId,
      lastModifiedBy: userId,
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

    this.prismaService.$tx(async () => {
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
      await this.collaboratorService.deleteBySpaceId(spaceId);
    });
  }
}
