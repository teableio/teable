import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActionPrefix, actionPrefixMap, generateBaseId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, ResourceType } from '@teable/openapi';
import type {
  IBaseErdVo,
  ICreateBaseFromTemplateRo,
  ICreateBaseRo,
  IDuplicateBaseRo,
  IGetBasePermissionVo,
  IMoveBaseRo,
  IUpdateBaseRo,
  IUpdateOrderRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { getMaxLevelRole } from '../../utils/get-max-level-role';
import { updateOrder } from '../../utils/update-order';
import { PermissionService } from '../auth/permission.service';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { GraphService } from '../graph/graph.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { BaseDuplicateService } from './base-duplicate.service';

@Injectable()
export class BaseService {
  private logger = new Logger(BaseService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService,
    private readonly baseDuplicateService: BaseDuplicateService,
    private readonly permissionService: PermissionService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly graphService: GraphService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async getBaseById(baseId: string) {
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    const base = await this.prismaService.base
      .findFirstOrThrow({
        select: {
          id: true,
          name: true,
          icon: true,
          spaceId: true,
        },
        where: {
          id: baseId,
          deletedTime: null,
        },
      })
      .catch(() => {
        throw new NotFoundException('Base not found');
      });
    const collaborators = await this.prismaService.collaborator.findMany({
      where: {
        resourceId: { in: [baseId, base.spaceId] },
        principalId: { in: [userId, ...(departmentIds || [])] },
      },
    });

    if (!collaborators.length) {
      throw new ForbiddenException('cannot access base');
    }
    const role = getMaxLevelRole(collaborators);
    const collaborator = collaborators.find((c) => c.roleName === role);
    return {
      ...base,
      role: role,
      collaboratorType: collaborator?.resourceType as CollaboratorType,
    };
  }

  async getAllBaseList() {
    const { spaceIds, baseIds, roleMap } =
      await this.collaboratorService.getCurrentUserCollaboratorsBaseAndSpaceArray();
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
            space: {
              deletedTime: null,
            },
          },
        ],
      },
      orderBy: [{ spaceId: 'asc' }, { order: 'asc' }],
    });
    return baseList.map((base) => {
      const role = roleMap[base.id] || roleMap[base.spaceId];
      return { ...base, role };
    });
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
    const { name, spaceId, icon } = createBaseRo;

    return this.prismaService.$transaction(async (prisma) => {
      const order = (await this.getMaxOrder(spaceId)) + 1;

      const base = await prisma.base.create({
        data: {
          id: generateBaseId(),
          name: name || 'Untitled Base',
          spaceId,
          order,
          icon,
          createdBy: userId,
        },
        select: {
          id: true,
          name: true,
          icon: true,
          spaceId: true,
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
        icon: true,
      },
      where: {
        id: baseId,
        deletedTime: null,
      },
    });
  }

  async shuffle(spaceId: string) {
    const bases = await this.prismaService.base.findMany({
      where: { spaceId, deletedTime: null },
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    this.logger.log(`lucky base shuffle! ${spaceId}`, 'shuffle');

    await this.prismaService.$tx(async (prisma) => {
      for (let i = 0; i < bases.length; i++) {
        const base = bases[i];
        await prisma.base.update({
          data: { order: i },
          where: { id: base.id },
        });
      }
    });
  }

  async updateOrder(baseId: string, orderRo: IUpdateOrderRo) {
    const { anchorId, position } = orderRo;

    const base = await this.prismaService.base
      .findFirstOrThrow({
        select: { spaceId: true, order: true, id: true },
        where: { id: baseId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Base ${baseId} not found`);
      });

    const anchorBase = await this.prismaService.base
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { spaceId: base.spaceId, id: anchorId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Anchor ${anchorId} not found`);
      });

    await updateOrder({
      query: base.spaceId,
      position,
      item: base,
      anchorItem: anchorBase,
      getNextItem: async (whereOrder, align) => {
        return this.prismaService.base.findFirst({
          select: { order: true, id: true },
          where: {
            spaceId: base.spaceId,
            deletedTime: null,
            order: whereOrder,
          },
          orderBy: { order: align },
        });
      },
      update: async (_, id, data) => {
        await this.prismaService.base.update({
          data: { order: data.newOrder },
          where: { id },
        });
      },
      shuffle: this.shuffle.bind(this),
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
    // permission check, base update permission
    await this.checkBaseUpdatePermission(duplicateBaseRo.fromBaseId);
    this.logger.log(
      `base-duplicate-service: Start to duplicating base: ${duplicateBaseRo.fromBaseId}`
    );
    return await this.prismaService.$tx(
      async () => {
        return await this.baseDuplicateService.duplicateBase(duplicateBaseRo);
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }

  private async checkBaseUpdatePermission(baseId: string) {
    // First check if the user has the base read permission
    await this.permissionService.validPermissions(baseId, ['base|update']);

    // Then check the token permissions if the request was made with a token
    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      await this.permissionService.validPermissions(baseId, ['base|update'], accessTokenId);
    }
  }

  private async checkBaseCreatePermission(spaceId: string) {
    await this.permissionService.validPermissions(spaceId, ['base|create']);

    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      await this.permissionService.validPermissions(spaceId, ['base|create'], accessTokenId);
    }
  }

  async createBaseFromTemplate(createBaseFromTemplateRo: ICreateBaseFromTemplateRo) {
    const { spaceId, templateId, withRecords, baseId } = createBaseFromTemplateRo;
    const template = await this.prismaService.template.findUniqueOrThrow({
      where: { id: templateId },
      select: {
        snapshot: true,
        name: true,
      },
    });

    if (baseId) {
      // check the base update permission
      await this.checkBaseUpdatePermission(baseId);

      const base = await this.prismaService.base.findUniqueOrThrow({
        where: { id: baseId, deletedTime: null },
        select: {
          spaceId: true,
        },
      });

      if (base.spaceId !== spaceId) {
        throw new BadRequestException('baseId and spaceId mismatch');
      }
    }

    const { baseId: fromBaseId = '' } = template?.snapshot ? JSON.parse(template.snapshot) : {};

    if (!template || !fromBaseId) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    return await this.prismaService.$tx(
      async () => {
        const res = await this.baseDuplicateService.duplicateBase({
          name: template.name!,
          fromBaseId,
          spaceId,
          withRecords,
          baseId,
        });
        await this.prismaService.txClient().template.update({
          where: { id: templateId },
          data: { usageCount: { increment: 1 } },
        });
        return res;
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async getPermission() {
    const permissions = this.cls.get('permissions');
    return [
      ...actionPrefixMap[ActionPrefix.Table],
      ...actionPrefixMap[ActionPrefix.Base],
      ...actionPrefixMap[ActionPrefix.Automation],
      ...actionPrefixMap[ActionPrefix.TableRecordHistory],
    ].reduce((acc, action) => {
      acc[action] = permissions.includes(action);
      return acc;
    }, {} as IGetBasePermissionVo);
  }

  async permanentDeleteBase(baseId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(baseId, ['base|delete'], accessTokenId, true);

    return await this.prismaService.$tx(
      async (prisma) => {
        const tables = await prisma.tableMeta.findMany({
          where: { baseId },
          select: { id: true },
        });
        const tableIds = tables.map(({ id }) => id);

        await this.dropBase(baseId, tableIds);
        await this.tableOpenApiService.cleanReferenceFieldIds(tableIds);
        await this.tableOpenApiService.cleanTablesRelatedData(baseId, tableIds);
        await this.cleanBaseRelatedData(baseId);
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async dropBase(baseId: string, tableIds: string[]) {
    const sql = this.dbProvider.dropSchema(baseId);
    if (sql) {
      return await this.prismaService.txClient().$executeRawUnsafe(sql);
    }
    await this.tableOpenApiService.dropTables(tableIds);
  }

  async cleanBaseRelatedData(baseId: string) {
    // delete collaborators for base
    await this.prismaService.txClient().collaborator.deleteMany({
      where: { resourceId: baseId, resourceType: CollaboratorType.Base },
    });

    // delete invitation for base
    await this.prismaService.txClient().invitation.deleteMany({
      where: { baseId },
    });

    // delete invitation record for base
    await this.prismaService.txClient().invitationRecord.deleteMany({
      where: { baseId },
    });

    // delete base
    await this.prismaService.txClient().base.delete({
      where: { id: baseId },
    });

    // delete trash for base
    await this.prismaService.txClient().trash.deleteMany({
      where: {
        resourceId: baseId,
        resourceType: ResourceType.Base,
      },
    });
  }

  async moveBase(baseId: string, moveBaseRo: IMoveBaseRo) {
    const { spaceId } = moveBaseRo;
    // check if has the permission to create base in the target space
    await this.checkBaseCreatePermission(spaceId);
    await this.prismaService.base.update({
      where: { id: baseId },
      data: { spaceId },
    });
  }

  async generateBaseErd(baseId: string): Promise<IBaseErdVo> {
    return await this.graphService.generateBaseErd(baseId);
  }
}
