import { Injectable, NotFoundException } from '@nestjs/common';
import { generateSpaceId, getUniqName } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { SpaceSchema } from '@teable-group/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class SpaceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

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
        createdBy: userId,
      },
    });
    if (!space) {
      throw new NotFoundException('Space not found');
    }
    return space;
  }

  async getSpaceList() {
    const userId = this.cls.get('user.id');

    return await this.prismaService.space.findMany({
      select: {
        id: true,
        name: true,
      },
      where: {
        deletedTime: null,
        createdBy: userId,
      },
    });
  }

  async createSpaceBySignup(
    prisma: Prisma.TransactionClient,
    createSpaceRo: SpaceSchema.ICreateSpaceRo,
    userId: string
  ) {
    const uniqName = createSpaceRo.name ?? 'Workspace';

    return await prisma.space.create({
      select: {
        id: true,
        name: true,
      },
      data: {
        id: generateSpaceId(),
        name: uniqName,
        createdBy: userId,
        lastModifiedBy: userId,
      },
    });
  }

  async createSpace(createSpaceRo: SpaceSchema.ICreateSpaceRo) {
    const userId = this.cls.get('user.id');

    const spaceList = await this.prismaService.space.findMany({
      where: { deletedTime: null, createdBy: userId },
      select: { name: true },
    });

    const names = spaceList.map((space) => space.name);
    const uniqName = getUniqName(createSpaceRo.name ?? 'Workspace', names);
    return await this.prismaService.space.create({
      select: {
        id: true,
        name: true,
      },
      data: {
        id: generateSpaceId(),
        name: uniqName,
        createdBy: userId,
        lastModifiedBy: userId,
      },
    });
  }

  async updateSpace(spaceId: string, updateSpaceRo: SpaceSchema.IUpdateSpaceRo) {
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

    await this.prismaService.space.update({
      data: {
        deletedTime: new Date(),
        lastModifiedBy: userId,
      },
      where: {
        id: spaceId,
        deletedTime: null,
      },
    });
  }
}
