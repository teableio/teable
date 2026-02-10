/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import type { IRole } from '@teable/core';
import {
  HttpErrorCode,
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
  ISpaceSearchRo,
  ISpaceSearchVo,
  ITestLLMRo,
  IUpdateIntegrationRo,
  IUpdateSpaceRo,
} from '@teable/openapi';
import { ResourceType, CollaboratorType, PrincipalType, IntegrationType } from '@teable/openapi';
import { Knex } from 'knex';
import { keyBy, map, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateIntegrationCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { PermissionService } from '../auth/permission.service';
import { BaseService } from '../base/base.service';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { SettingOpenApiService } from '../setting/open-api/setting-open-api.service';
import { SettingService } from '../setting/setting.service';
@Injectable()
export class SpaceService {
  constructor(
    protected readonly prismaService: PrismaService,
    protected readonly cls: ClsService<IClsStore>,
    protected readonly baseService: BaseService,
    protected readonly collaboratorService: CollaboratorService,
    protected readonly permissionService: PermissionService,
    protected readonly settingService: SettingService,
    protected readonly settingOpenApiService: SettingOpenApiService,
    protected readonly performanceCacheService: PerformanceCacheService,
    @ThresholdConfig() protected readonly thresholdConfig: IThresholdConfig,
    @InjectModel('CUSTOM_KNEX') protected readonly knex: Knex,
    @InjectDbProvider() protected readonly dbProvider: IDbProvider
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
      throw new CustomHttpException('Space not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.space.notFound',
        },
      });
    }
    const role = await this.permissionService.getRoleBySpaceId(spaceId);
    if (!role) {
      throw new CustomHttpException(
        'You have no permission to access this space',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.space.noPermission',
          },
        }
      );
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
        throw new CustomHttpException(
          'The current instance disallow space creation by the administrator',
          HttpErrorCode.RESTRICTED_RESOURCE,
          {
            localization: {
              i18nKey: 'httpErrors.space.disallowSpaceCreation',
            },
          }
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
          throw new CustomHttpException('Space not found', HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.space.notFound',
            },
          });
        });
    });
  }

  async getBaseListBySpaceId(spaceId: string) {
    const { spaceIds, roleMap } =
      await this.collaboratorService.getCurrentUserCollaboratorsBaseAndSpaceArray();
    if (!spaceIds.includes(spaceId)) {
      throw new CustomHttpException(
        'You have no permission to access this space',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.space.noPermission',
          },
        }
      );
    }
    const baseList = await this.prismaService.base.findMany({
      select: {
        id: true,
        name: true,
        order: true,
        spaceId: true,
        icon: true,
        createdBy: true,
        lastModifiedTime: true,
        createdTime: true,
      },
      where: {
        spaceId,
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });

    const userList = await this.prismaService.user.findMany({
      where: { id: { in: baseList.map((base) => base.createdBy) } },
      select: { id: true, name: true, avatar: true },
    });
    const userMap = keyBy(userList, 'id');

    return baseList.map((base) => {
      const role = roleMap[base.id] || roleMap[base.spaceId];
      const createdUser = userMap[base.createdBy];
      return {
        ...base,
        role,
        lastModifiedTime: base.lastModifiedTime?.toISOString(),
        createdTime: base.createdTime?.toISOString(),
        createdUser: createdUser
          ? {
              ...createdUser,
              avatar: createdUser.avatar ? getPublicFullStorageUrl(createdUser.avatar) : null,
            }
          : undefined,
      };
    });
  }

  protected getTableMapping(): Record<
    string,
    { table: string; hasDeletedTime: boolean; hasIcon?: boolean }
  > {
    return {
      [ResourceType.Base]: { table: 'base', hasDeletedTime: true, hasIcon: true },
      [ResourceType.Table]: { table: 'table_meta', hasDeletedTime: true, hasIcon: true },
      [ResourceType.Dashboard]: { table: 'dashboard', hasDeletedTime: false, hasIcon: false },
    };
  }

  /**
   * Parse cursor in format: {iso_timestamp}_{id}
   */
  private parseCursor(cursor?: string): { timeStr: string; id: string } | null {
    if (!cursor) return null;
    // Find the last underscore to handle IDs that might contain underscores
    const lastUnderscoreIndex = cursor.lastIndexOf('_');
    if (lastUnderscoreIndex === -1) return null;
    const timeStr = cursor.substring(0, lastUnderscoreIndex);
    const id = cursor.substring(lastUnderscoreIndex + 1);
    return { timeStr, id };
  }

  /**
   * Generate cursor from createdTime ISO string and id
   */
  private generateCursor(createdTimeStr: string, id: string): string {
    return `${createdTimeStr}_${id}`;
  }

  async search(spaceId: string, query: ISpaceSearchRo): Promise<ISpaceSearchVo> {
    const { search, pageSize = 10, cursor, type: filterType } = query;

    const bases = await this.prismaService.base.findMany({
      where: { spaceId, deletedTime: null },
      select: { id: true, name: true, createdBy: true, spaceId: true },
    });
    const baseMap = keyBy(bases, 'id');
    const baseIds = bases.map((base) => base.id);
    if (baseIds.length === 0) {
      return { list: [], total: 0, nextCursor: null };
    }

    const tableMapping = this.getTableMapping();
    const searchableTypes = Object.keys(tableMapping).map((key) => key as ResourceType);
    const typesToSearch = filterType ? [filterType] : searchableTypes;

    const cursorData = this.parseCursor(cursor);

    const buildSubQuery = (resourceType: ResourceType) => {
      const mapping = tableMapping[resourceType];
      if (!mapping) return null;

      const { table, hasDeletedTime, hasIcon } = mapping;
      const isBase = resourceType === ResourceType.Base;

      let subQuery = this.knex(table).select(
        'id',
        'name',
        this.knex.raw('? as type', [resourceType]),
        hasIcon ? this.knex.raw('COALESCE(icon, NULL) as icon') : this.knex.raw('NULL as icon'),
        isBase ? this.knex.raw('id as base_id') : 'base_id',
        'created_by',
        'created_time'
      );

      subQuery = this.dbProvider.searchBuilder(subQuery, [['name', search]]);

      if (isBase) {
        subQuery = subQuery.whereIn('id', baseIds);
      } else {
        subQuery = subQuery.whereIn('base_id', baseIds);
      }

      if (hasDeletedTime) {
        subQuery = subQuery.whereNull('deleted_time');
      }

      return subQuery;
    };

    const validQueries = typesToSearch
      .map((t) => buildSubQuery(t))
      .filter((q): q is Knex.QueryBuilder => q !== null);

    if (validQueries.length === 0) {
      return { list: [], total: 0, nextCursor: null };
    }

    let unionQuery = validQueries[0];
    for (let i = 1; i < validQueries.length; i++) {
      unionQuery = unionQuery.unionAll(validQueries[i]);
    }

    const isFirstPage = !cursorData;

    const totalCountExpr = isFirstPage
      ? this.knex.raw('COUNT(*) OVER() as total_count')
      : this.knex.raw('0 as total_count');

    let dataQuery = this.knex
      .from(unionQuery.as('combined'))
      .select('*', totalCountExpr)
      .orderBy('created_time', 'desc')
      .orderBy('id', 'desc')
      .limit(pageSize + 1);

    if (cursorData) {
      dataQuery = dataQuery.whereRaw('(created_time, id) < (?, ?)', [
        cursorData.timeStr,
        cursorData.id,
      ]);
    }

    interface ISearchResultRow {
      id: string;
      name: string;
      type: ResourceType;
      icon: string | null;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      base_id: string;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      created_by: string;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      created_time: Date;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      total_count: bigint | number;
    }

    const rows = await this.prismaService.$queryRawUnsafe<ISearchResultRow[]>(dataQuery.toQuery());

    const total = isFirstPage && rows.length > 0 ? Number(rows[0].total_count) : 0;
    const hasMore = rows.length > pageSize;
    const resultsToReturn = hasMore ? rows.slice(0, pageSize) : rows;

    const userIds = resultsToReturn
      .map((row) => row.created_by)
      .filter((id): id is string => id !== null);

    const spaceIdsForBases = uniq(
      resultsToReturn
        .filter((row) => row.type === ResourceType.Base)
        .map((row) => baseMap[row.base_id].spaceId)
    );
    const { validCreatorSet, spaceOwnerMap } =
      await this.collaboratorService.buildSpaceOwnerContext(spaceIdsForBases);

    const allUserIds = uniq([...userIds, ...spaceOwnerMap.values()]);
    const userList = await this.prismaService.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true, name: true, avatar: true },
    });
    const userMap = keyBy(userList, 'id');

    const list = resultsToReturn.map((row) => {
      const base = baseMap[row.base_id];
      const isCreatorInSpace = validCreatorSet.has(`${base?.spaceId}:${row.created_by}`);
      const displayUserId =
        row.type === ResourceType.Base
          ? isCreatorInSpace
            ? row.created_by
            : spaceOwnerMap.get(base.spaceId)
          : row.created_by;
      const displayUser = displayUserId ? userMap[displayUserId] : undefined;
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        icon: row.icon,
        baseId: row.base_id,
        baseName: base?.name ?? '',
        createdTime: row.created_time.toISOString(),
        createdUser: displayUser
          ? {
              ...displayUser,
              avatar: displayUser.avatar && getPublicFullStorageUrl(displayUser.avatar),
            }
          : undefined,
      };
    });

    const nextCursor =
      hasMore && resultsToReturn.length > 0
        ? this.generateCursor(
            resultsToReturn[resultsToReturn.length - 1].created_time.toISOString(),
            resultsToReturn[resultsToReturn.length - 1].id
          )
        : null;

    return { list, total, nextCursor };
  }

  async permanentDeleteSpace(spaceId: string, ignorePermissionCheck: boolean = false) {
    if (!ignorePermissionCheck) {
      const accessTokenId = this.cls.get('accessTokenId');
      await this.permissionService.validPermissions(spaceId, ['space|delete'], accessTokenId, true);
    }

    await this.prismaService.space
      .findUniqueOrThrow({
        where: { id: spaceId },
      })
      .catch(() => {
        throw new CustomHttpException('Space not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.space.notFound',
          },
        });
      });

    await this.prismaService.$tx(
      async (prisma) => {
        const bases = await prisma.base.findMany({
          where: { spaceId },
          select: { id: true },
        });

        for (const { id } of bases) {
          await this.baseService.permanentDeleteBase(id, ignorePermissionCheck);
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
    ttl: 600, // 10 minutes
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

    await this.performanceCacheService.del(generateIntegrationCacheKey(spaceId));
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
