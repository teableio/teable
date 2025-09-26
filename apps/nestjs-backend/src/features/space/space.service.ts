import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { IRole } from '@teable/core';
import {
  Role,
  canManageRole,
  generateIntegrationId,
  generateSpaceId,
  getUniqName,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateIntegrationRo,
  ICreateSpaceRo,
  IIntegrationItemVo,
  ITestLLMRo,
  IUpdateIntegrationRo,
  IUpdateSpaceRo,
} from '@teable/openapi';
import { ResourceType, CollaboratorType, PrincipalType, IntegrationType } from '@teable/openapi';
import { map } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateIntegrationCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { BaseService } from '../base/base.service';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { SettingOpenApiService } from '../setting/open-api/setting-open-api.service';
import { SettingService } from '../setting/setting.service';

@Injectable()
export class SpaceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly baseService: BaseService,
    private readonly collaboratorService: CollaboratorService,
    private readonly permissionService: PermissionService,
    private readonly settingService: SettingService,
    private readonly settingOpenApiService: SettingOpenApiService,
    private readonly performanceCacheService: PerformanceCacheService,
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

  async filterSpaceListWithAccessToken(spaceList: { id: string; name: string }[]) {
    const accessTokenId = this.cls.get('accessTokenId');
    if (!accessTokenId) {
      return spaceList;
    }
    const accessToken = await this.permissionService.getAccessToken(accessTokenId);
    if (accessToken.hasFullAccess) {
      return spaceList;
    }
    if (!accessToken.spaceIds?.length) {
      return [];
    }
    return spaceList.filter((space) => accessToken.spaceIds.includes(space.id));
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
      where: {
        id: { in: spaceIds },
        deletedTime: null,
        isTemplate: null,
      },
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
    const filteredSpaceList = await this.filterSpaceListWithAccessToken(spaceList);
    return filteredSpaceList.map((space) => ({
      ...space,
      role: roleMap[space.id].roleName as IRole,
    }));
  }

  async createSpace(createSpaceRo: ICreateSpaceRo) {
    const userId = this.cls.get('user.id');
    const isAdmin = this.cls.get('user.isAdmin');

    if (!isAdmin) {
      const setting = await this.settingService.getSetting();
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

    const spaceId = generateSpaceId();

    // create default ai integration
    await this.createDefaultAIIntegration(spaceId);

    return await this.createSpaceByParams({
      id: spaceId,
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

    return baseList.map((base) => {
      const role = roleMap[base.id] || roleMap[base.spaceId];
      return { ...base, role };
    });
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

    // delete integrations for space
    await this.prismaService.txClient().integration.deleteMany({
      where: { resourceId: spaceId },
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

  @PerformanceCache({
    ttl: 60 * 60 * 24 * 7, // 7 day
    keyGenerator: generateIntegrationCacheKey,
    statsType: 'integration',
  })
  async getIntegrationList(spaceId: string): Promise<IIntegrationItemVo[]> {
    const integrationList = await this.prismaService.integration.findMany({
      where: { resourceId: spaceId },
    });
    return integrationList.map(({ id, config, type, enable, createdTime, lastModifiedTime }) => {
      return {
        id,
        spaceId,
        type: type as IntegrationType,
        enable: enable ?? false,
        config: JSON.parse(config),
        createdTime: createdTime.toISOString(),
        lastModifiedTime: lastModifiedTime?.toISOString(),
      };
    });
  }

  async createIntegration(spaceId: string, addIntegrationRo: ICreateIntegrationRo) {
    const { type, enable, config } = addIntegrationRo;

    if (type === IntegrationType.AI) {
      const aiIntegration = await this.prismaService.integration.findFirst({
        where: {
          resourceId: spaceId,
          type: IntegrationType.AI,
        },
      });

      if (!aiIntegration) {
        return await this.prismaService.integration.create({
          data: {
            id: generateIntegrationId(),
            resourceId: spaceId,
            type,
            enable,
            config: JSON.stringify(config),
          },
        });
      }

      const { id, enable: originalEnable } = aiIntegration;
      const originalConfig = JSON.parse(aiIntegration.config);

      return await this.prismaService.integration.update({
        where: { id },
        data: {
          config: JSON.stringify({
            ...originalConfig,
            ...config,
            llmProviders: [...originalConfig.llmProviders, ...config.llmProviders],
          }),
          enable: enable ?? originalEnable,
        },
      });
    }

    const res = await this.prismaService.integration.create({
      data: {
        id: generateIntegrationId(),
        resourceId: spaceId,
        type,
        enable,
        config: JSON.stringify(config),
      },
    });
    await this.performanceCacheService.del(generateIntegrationCacheKey(spaceId));
    return res;
  }

  async createDefaultAIIntegration(spaceId: string) {
    const res = await this.prismaService.integration.create({
      data: {
        id: generateIntegrationId(),
        resourceId: spaceId,
        type: IntegrationType.AI,
        enable: false,
        config: JSON.stringify({
          llmProviders: [],
        }),
      },
    });
    await this.performanceCacheService.del(generateIntegrationCacheKey(spaceId));
    return res;
  }

  async updateIntegration(
    integrationId: string,
    updateIntegrationRo: IUpdateIntegrationRo,
    spaceId: string
  ) {
    const { enable, config } = updateIntegrationRo;
    const updateData: Record<string, unknown> = {};
    if (enable != null) {
      updateData.enable = enable;
    }
    if (config) {
      updateData.config = JSON.stringify(config);
    }
    const res = await this.prismaService.integration.update({
      where: { id: integrationId },
      data: updateData,
    });
    await this.performanceCacheService.del(generateIntegrationCacheKey(spaceId));
    return res;
  }

  async deleteIntegration(integrationId: string, spaceId: string) {
    await this.prismaService.integration.delete({
      where: { id: integrationId },
    });
    await this.performanceCacheService.del(generateIntegrationCacheKey(spaceId));
  }

  async testIntegrationLLM(testLLMRo: ITestLLMRo) {
    return await this.settingOpenApiService.testLLM(testLLMRo);
  }
}
