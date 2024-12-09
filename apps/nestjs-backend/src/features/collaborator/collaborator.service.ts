/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { canManageRole, Role, type IBaseRole, type IRole } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  CollaboratorType,
  UploadType,
  type ListBaseCollaboratorVo,
  type ListSpaceCollaboratorVo,
} from '@teable/openapi';
import { Knex } from 'knex';
import { map } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import {
  CollaboratorCreateEvent,
  CollaboratorDeleteEvent,
  Events,
} from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { getFullStorageUrl } from '../attachments/plugins/utils';

@Injectable()
export class CollaboratorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async createSpaceCollaborator(userId: string, spaceId: string, role: IRole, createdBy?: string) {
    const currentUserId = createdBy || this.cls.get('user.id');
    const exist = await this.prismaService.txClient().collaborator.count({
      where: {
        userId,
        resourceId: spaceId,
        resourceType: CollaboratorType.Space,
      },
    });
    if (exist) {
      throw new BadRequestException('has already existed in space');
    }
    // if has exist base collaborator, then delete it
    const bases = await this.prismaService.txClient().base.findMany({
      where: {
        spaceId,
        deletedTime: null,
      },
    });
    await this.prismaService.txClient().collaborator.deleteMany({
      where: {
        userId,
        resourceId: { in: bases.map((base) => base.id) },
        resourceType: CollaboratorType.Base,
      },
    });
    const collaborator = await this.prismaService.txClient().collaborator.create({
      data: {
        resourceId: spaceId,
        resourceType: CollaboratorType.Space,
        roleName: role,
        userId,
        createdBy: currentUserId!,
      },
    });
    this.eventEmitterService.emitAsync(
      Events.COLLABORATOR_CREATE,
      new CollaboratorCreateEvent(spaceId)
    );
    return collaborator;
  }

  async getListByBase(
    baseId: string,
    options?: { includeSystem?: boolean }
  ): Promise<ListBaseCollaboratorVo> {
    const { includeSystem } = options ?? {};
    const base = await this.prismaService
      .txClient()
      .base.findUniqueOrThrow({ select: { spaceId: true }, where: { id: baseId } });

    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        resourceId: { in: [baseId, base.spaceId] },
        ...(includeSystem ? {} : { user: { isSystem: null } }),
      },
      select: {
        roleName: true,
        createdTime: true,
        resourceType: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            isSystem: true,
          },
        },
      },
      orderBy: { createdTime: 'asc' },
    });

    return collaborators.map((collaborator) => ({
      userId: collaborator.user.id,
      userName: collaborator.user.name,
      email: collaborator.user.email,
      avatar: collaborator.user.avatar
        ? getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), collaborator.user.avatar)
        : null,
      role: collaborator.roleName as IRole,
      createdTime: collaborator.createdTime.toISOString(),
      resourceType: collaborator.resourceType as CollaboratorType,
      isSystem: collaborator.user.isSystem || undefined,
    }));
  }

  async getBaseCollabsWithPrimary(tableId: string) {
    const { baseId } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      select: { baseId: true },
      where: { id: tableId },
    });

    const baseCollabs = await this.getListByBase(baseId);
    return baseCollabs.map(({ userId, userName, email }) => ({
      id: userId,
      name: userName,
      email,
    }));
  }

  async getListBySpace(
    spaceId: string,
    options?: { includeSystem?: boolean; includeBase?: boolean }
  ): Promise<ListSpaceCollaboratorVo> {
    const { includeSystem, includeBase } = options ?? {};
    let baseIds: string[] = [];
    let baseMap: Record<string, { name: string; id: string }> = {};
    if (includeBase) {
      const bases = await this.prismaService.txClient().base.findMany({
        where: { spaceId, deletedTime: null, space: { deletedTime: null } },
      });
      baseIds = map(bases, 'id') as string[];
      baseMap = bases.reduce(
        (acc, base) => {
          acc[base.id] = { name: base.name, id: base.id };
          return acc;
        },
        {} as Record<string, { name: string; id: string }>
      );
    }
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        resourceId: baseIds.length ? { in: [...baseIds, spaceId] } : spaceId,
        ...(includeSystem ? {} : { user: { isSystem: null } }),
      },
      select: {
        resourceId: true,
        roleName: true,
        createdTime: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdTime: 'desc' },
    });
    return collaborators.map((collaborator) => ({
      userId: collaborator.user.id,
      userName: collaborator.user.name,
      email: collaborator.user.email,
      avatar: collaborator.user.avatar
        ? getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), collaborator.user.avatar)
        : null,
      role: collaborator.roleName as IRole,
      createdTime: collaborator.createdTime.toISOString(),
      base: baseMap[collaborator.resourceId],
    }));
  }

  private async getOperatorCollaborators({
    targetUserId,
    currentUserId,
    resourceId,
    resourceType,
  }: {
    resourceId: string;
    resourceType: CollaboratorType;
    targetUserId: string;
    currentUserId: string;
  }) {
    const currentUserWhere: { userId: string; resourceId: string | Record<string, string[]> } = {
      userId: currentUserId,
      resourceId,
    };
    const targetUserWhere: { userId: string; resourceId: string | Record<string, string[]> } = {
      userId: targetUserId,
      resourceId,
    };

    // for space user delete base collaborator
    if (resourceType === CollaboratorType.Base) {
      const spaceId = await this.prismaService
        .txClient()
        .base.findUniqueOrThrow({
          where: { id: resourceId, deletedTime: null },
          select: { spaceId: true },
        })
        .then((base) => base.spaceId);
      currentUserWhere.resourceId = { in: [resourceId, spaceId] };
    }
    const colls = await this.prismaService.txClient().collaborator.findMany({
      where: {
        OR: [currentUserWhere, targetUserWhere],
      },
    });

    const currentColl = colls.find((coll) => coll.userId === currentUserId);
    const targetColl = colls.find((coll) => coll.userId === targetUserId);
    if (!currentColl || !targetColl) {
      throw new BadRequestException('User not found in collaborator');
    }
    return { currentColl, targetColl };
  }

  async isUniqueOwnerUser(spaceId: string, userId: string) {
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        resourceType: CollaboratorType.Space,
        resourceId: spaceId,
        roleName: Role.Owner,
        user: {
          isSystem: null,
          deletedTime: null,
          deactivatedTime: null,
        },
      },
    });
    return collaborators.length === 1 && collaborators[0].userId === userId;
  }

  async deleteCollaborator({
    resourceId,
    resourceType,
    userId,
  }: {
    userId: string;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    const currentUserId = this.cls.get('user.id');
    const { currentColl, targetColl } = await this.getOperatorCollaborators({
      currentUserId,
      targetUserId: userId,
      resourceId,
      resourceType,
    });

    // validate user can operator target user
    if (
      currentUserId !== userId &&
      currentColl.roleName !== Role.Owner &&
      !canManageRole(currentColl.roleName as IRole, targetColl.roleName)
    ) {
      throw new ForbiddenException(`You do not have permission to delete this user: ${userId}`);
    }
    const result = await this.prismaService.txClient().collaborator.delete({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        resourceType_resourceId_userId: {
          resourceId: resourceId,
          resourceType: resourceType,
          userId,
        },
      },
    });
    if (resourceType === CollaboratorType.Space) {
      this.eventEmitterService.emitAsync(
        Events.COLLABORATOR_DELETE,
        new CollaboratorDeleteEvent(resourceId)
      );
    }
    return result;
  }

  async updateCollaborator({
    role,
    userId,
    resourceId,
    resourceType,
  }: {
    role: IRole;
    userId: string;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    const currentUserId = this.cls.get('user.id');
    const { currentColl, targetColl } = await this.getOperatorCollaborators({
      currentUserId,
      targetUserId: userId,
      resourceId,
      resourceType,
    });

    // validate user can operator target user
    if (
      currentUserId !== userId &&
      currentColl.roleName !== targetColl.roleName &&
      !canManageRole(currentColl.roleName as IRole, targetColl.roleName)
    ) {
      throw new ForbiddenException(`You do not have permission to operator this user: ${userId}`);
    }

    // validate user can operator target role
    if (role !== currentColl.roleName && !canManageRole(currentColl.roleName as IRole, role)) {
      throw new ForbiddenException(`You do not have permission to operator this role: ${role}`);
    }

    return this.prismaService.txClient().collaborator.updateMany({
      where: {
        resourceId: resourceId,
        resourceType: resourceType,
        userId,
      },
      data: {
        roleName: role,
        lastModifiedBy: currentUserId,
      },
    });
  }

  async getCollaboratorsBaseAndSpaceArray(userId: string, searchRoles?: IRole[]) {
    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        userId,
        ...(searchRoles && searchRoles.length > 0 ? { roleName: { in: searchRoles } } : {}),
      },
      select: {
        roleName: true,
        resourceId: true,
        resourceType: true,
      },
    });
    const roleMap: Record<string, IRole> = {};
    const baseIds = new Set<string>();
    const spaceIds = new Set<string>();
    collaborators.forEach(({ resourceId, resourceType, roleName }) => {
      if (resourceType === CollaboratorType.Base) {
        baseIds.add(resourceId);
        roleMap[resourceId] = roleName as IRole;
      }
      if (resourceType === CollaboratorType.Space) {
        spaceIds.add(resourceId);
        roleMap[resourceId] = roleName as IRole;
      }
    });
    return {
      baseIds: Array.from(baseIds),
      spaceIds: Array.from(spaceIds),
      roleMap: roleMap,
    };
  }

  async createBaseCollaborator(
    userId: string,
    baseId: string,
    role: IBaseRole,
    createdBy?: string
  ) {
    const currentUserId = createdBy || this.cls.get('user.id');
    const base = await this.prismaService.txClient().base.findUniqueOrThrow({
      where: { id: baseId },
    });
    const exist = await this.prismaService.txClient().collaborator.count({
      where: {
        userId,
        resourceId: { in: [baseId, base.spaceId] },
      },
    });
    // if has exist space collaborator
    if (exist) {
      throw new BadRequestException('has already existed in base');
    }

    return this.prismaService.txClient().collaborator.create({
      data: {
        resourceId: baseId,
        resourceType: CollaboratorType.Base,
        roleName: role,
        userId,
        createdBy: currentUserId!,
      },
    });
  }

  async getSharedBase() {
    const userId = this.cls.get('user.id');
    const coll = await this.prismaService.txClient().collaborator.findMany({
      where: {
        userId,
        resourceType: CollaboratorType.Base,
      },
      select: {
        resourceId: true,
        roleName: true,
      },
    });

    if (!coll.length) {
      return [];
    }

    const roleMap: Record<string, IRole> = {};
    const baseIds = coll.map((c) => {
      roleMap[c.resourceId] = c.roleName as IRole;
      return c.resourceId;
    });
    const bases = await this.prismaService.txClient().base.findMany({
      where: {
        id: { in: baseIds },
        deletedTime: null,
      },
    });
    return bases.map((base) => ({
      id: base.id,
      name: base.name,
      role: roleMap[base.id],
      icon: base.icon,
      spaceId: base.spaceId,
      collaboratorType: CollaboratorType.Base,
    }));
  }
}
