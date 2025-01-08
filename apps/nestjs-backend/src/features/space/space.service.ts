import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { IRole } from '@teable/core';
import { Role, canManageRole, generateSpaceId, getUniqName } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateSpaceRo, IUpdateSpaceRo } from '@teable/openapi';
import { ResourceType, CollaboratorType, PrincipalType } from '@teable/openapi';
import { map } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { BaseService } from '../base/base.service';
import { CollaboratorService } from '../collaborator/collaborator.service';

@Injectable()
export class SpaceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly baseService: BaseService,
    private readonly collaboratorService: CollaboratorService,
    private readonly permissionService: PermissionService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
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
      await this.collaboratorService.createSpaceCollaborator({
        collaborators: [
          {
            principalId: spaceCreateInput.createdBy,
            principalType: PrincipalType.User,
          },
        ],
        role: Role.Owner,
        spaceId: result.id,
      });
      return result;
    });
  }

  async getSpaceById(spaceId: string) {
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
    const role = await this.permissionService.getRoleBySpaceId(spaceId);
    if (!role) {
      throw new ForbiddenException();
    }
    return {
      ...space,
      role,
    };
  }

  async getSpaceList() {
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    const collaboratorSpaceList = await this.prismaService.collaborator.findMany({
      select: {
        resourceId: true,
        roleName: true,
      },
      where: {
        principalId: { in: [userId, ...(departmentIds || [])] },
        resourceType: CollaboratorType.Space,
      },
    });
    const spaceIds = map(collaboratorSpaceList, 'resourceId') as string[];
    const spaceList = await this.prismaService.space.findMany({
      where: { id: { in: spaceIds }, deletedTime: null },
      select: { id: true, name: true },
      orderBy: { createdTime: 'asc' },
    });
    const roleMap = collaboratorSpaceList.reduce(
      (acc, curr) => {
        if (
          !acc[curr.resourceId] ||
          canManageRole(curr.roleName as IRole, acc[curr.resourceId].roleName as IRole)
        ) {
          acc[curr.resourceId] = curr;
        }
        return acc;
      },
      {} as Record<string, { roleName: string; resourceId: string }>
    );
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
      await this.prismaService
        .txClient()
        .space.update({
          data: {
            deletedTime: new Date(),
            lastModifiedBy: userId,
          },
          where: {
            id: spaceId,
            deletedTime: null,
          },
        })
        .catch(() => {
          throw new NotFoundException('Space not found');
        });
    });
  }

  async getBaseListBySpaceId(spaceId: string) {
    const { spaceIds, roleMap } =
      await this.collaboratorService.getCurrentUserCollaboratorsBaseAndSpaceArray();
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

  async permanentDeleteSpace(spaceId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(spaceId, ['space|delete'], accessTokenId, true);

    await this.prismaService.space.findUniqueOrThrow({
      where: { id: spaceId },
    });

    await this.prismaService.$tx(
      async (prisma) => {
        const bases = await prisma.base.findMany({
          where: { spaceId },
          select: { id: true },
        });

        for (const { id } of bases) {
          await this.baseService.permanentDeleteBase(id);
        }

        await this.cleanSpaceRelatedData(spaceId);
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async cleanSpaceRelatedData(spaceId: string) {
    // delete collaborators for space
    await this.prismaService.txClient().collaborator.deleteMany({
      where: { resourceId: spaceId, resourceType: CollaboratorType.Space },
    });

    // delete invitation for space
    await this.prismaService.txClient().invitation.deleteMany({
      where: { spaceId },
    });

    // delete invitation record for space
    await this.prismaService.txClient().invitationRecord.deleteMany({
      where: { spaceId },
    });

    // delete space
    await this.prismaService.txClient().space.delete({
      where: { id: spaceId },
    });

    // delete trash for space
    await this.prismaService.txClient().trash.deleteMany({
      where: {
        resourceId: spaceId,
        resourceType: ResourceType.Space,
      },
    });
  }
}
