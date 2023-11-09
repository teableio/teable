import { BadRequestException, Injectable } from '@nestjs/common';
import type { SpaceRole } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { ListSpaceCollaboratorVo, UpdateSpaceCollaborateRo } from '@teable-group/openapi';
import { keyBy, map } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class CollaboratorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async createSpaceCollaborator(userId: string, spaceId: string, role: SpaceRole) {
    const currentUserId = this.cls.get('user.id');
    const exist = await this.prismaService
      .txClient()
      .collaborator.count({ where: { userId, spaceId, deletedTime: null } });
    if (exist) {
      throw new BadRequestException('has already existed in space');
    }
    return await this.prismaService.txClient().collaborator.create({
      data: {
        spaceId,
        roleName: role,
        userId,
        createdBy: currentUserId,
        lastModifiedBy: currentUserId,
      },
    });
  }

  async deleteBySpaceId(spaceId: string) {
    return await this.prismaService.txClient().collaborator.updateMany({
      where: {
        spaceId,
      },
      data: {
        deletedTime: new Date().toISOString(),
      },
    });
  }

  async getListBySpace(spaceId: string): Promise<ListSpaceCollaboratorVo> {
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        spaceId,
        deletedTime: null,
      },
      select: {
        roleName: true,
        createdBy: true,
        createdTime: true,
        userId: true,
      },
    });
    const userIds = map(collaborators, 'userId');
    const usersInfo = await this.prismaService.txClient().user.findMany({
      where: {
        id: { in: userIds },
        deletedTime: null,
      },
      select: {
        id: true,
        email: true,
        avatar: true,
        name: true,
      },
    });
    const usersInfoMap = keyBy(usersInfo, 'id');
    return collaborators.map(({ userId, roleName, createdBy, createdTime }) => {
      const { name, email, avatar } = usersInfoMap[userId];
      return {
        userId,
        username: name,
        email,
        avatar,
        role: roleName as SpaceRole,
        createdBy,
        createdTime: createdTime.toISOString(),
      };
    });
  }

  async deleteCollaborator(spaceId: string, userId: string) {
    return await this.prismaService.txClient().collaborator.updateMany({
      where: {
        spaceId,
        userId,
      },
      data: {
        deletedTime: new Date().toISOString(),
      },
    });
  }

  async updateCollaborator(spaceId: string, updateCollaborator: UpdateSpaceCollaborateRo) {
    const currentUserId = this.cls.get('user.id');
    const { userId, role } = updateCollaborator;
    return await this.prismaService.txClient().collaborator.updateMany({
      where: {
        spaceId,
        userId,
      },
      data: {
        roleName: role,
        lastModifiedBy: currentUserId,
        lastModifiedTime: new Date().toISOString(),
      },
    });
  }

  async getCollaboratorsBaseAndSpaceArray(userId: string) {
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        userId,
        deletedTime: null,
      },
      select: {
        roleName: true,
        baseId: true,
        spaceId: true,
      },
    });
    const roleMap: Record<string, SpaceRole> = {};
    const baseIds = new Set<string>();
    const spaceIds = new Set<string>();
    collaborators.forEach(({ baseId, spaceId, roleName }) => {
      if (baseId) {
        baseIds.add(baseId);
        roleMap[baseId] = roleName as SpaceRole;
      }
      if (spaceId) {
        spaceIds.add(spaceId);
        roleMap[spaceId] = roleName as SpaceRole;
      }
    });
    return {
      baseIds: Array.from(baseIds),
      spaceIds: Array.from(spaceIds),
      roleMap: roleMap,
    };
  }
}
