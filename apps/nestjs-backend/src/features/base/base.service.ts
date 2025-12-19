import { Injectable, Logger } from '@nestjs/common';
import {
  ActionPrefix,
  actionPrefixMap,
  generateBaseId,
  HttpErrorCode,
  Role,
  generateTemplateId,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, ResourceType } from '@teable/openapi';
import type {
  IBaseErdVo,
  ICreateBaseFromTemplateRo,
  ICreateBaseFromTemplateVo,
  ICreateBaseRo,
  IDuplicateBaseRo,
  IGetBasePermissionVo,
  IMoveBaseRo,
  IPublishBaseRo,
  IUpdateBaseRo,
  IUpdateOrderRo,
} from '@teable/openapi';
import { keyBy, isNumber } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { getMaxLevelRole } from '../../utils/get-max-level-role';
import { updateOrder } from '../../utils/update-order';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
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

  private async getRoleByBaseId(baseId: string, spaceId: string) {
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);

    const collaborators = await this.prismaService.collaborator.findMany({
      where: {
        resourceId: { in: [baseId, spaceId] },
        principalId: { in: [userId, ...(departmentIds || [])] },
      },
    });

    if (!collaborators.length) {
      throw new CustomHttpException('Cannot access base', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.base.cannotAccess',
          context: {
            baseId,
          },
        },
      });
    }
    const role = getMaxLevelRole(collaborators);
    const collaborator = collaborators.find((c) => c.roleName === role);
    return {
      role: role,
      collaboratorType: collaborator?.resourceType as CollaboratorType,
    };
  }

  async getBaseById(baseId: string) {
    const base = await this.prismaService.base
      .findFirstOrThrow({
        select: {
          id: true,
          name: true,
          icon: true,
          spaceId: true,
          createdBy: true,
        },
        where: {
          id: baseId,
          deletedTime: null,
        },
      })
      .catch(() => {
        throw new CustomHttpException('Base not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.base.notFound',
          },
        });
      });
    const template = await this.cls.get('template');
    const { role, collaboratorType } = template
      ? { role: Role.Viewer, collaboratorType: CollaboratorType.Base }
      : await this.getRoleByBaseId(baseId, base.spaceId);
    return {
      ...base,
      role,
      collaboratorType,
      template:
        template?.baseId === baseId
          ? { id: template.id, headers: this.permissionService.generateTemplateHeader(template.id) }
          : undefined,
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
        createdBy: true,
        createdTime: true,
        lastModifiedTime: true,
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

    const createdUserList = await this.prismaService.user.findMany({
      where: { id: { in: baseList.map((base) => base.createdBy) } },
      select: { id: true, name: true, avatar: true },
    });
    const createdUserMap = keyBy(createdUserList, 'id');

    return baseList.map((base) => {
      const role = roleMap[base.id] || roleMap[base.spaceId];
      const createdUser = createdUserMap[base.createdBy];
      return {
        ...base,
        role,
        lastModifiedTime: base.lastModifiedTime?.toISOString(),
        createdTime: base.createdTime?.toISOString(),
        createdUser: createdUser
          ? {
              ...createdUser,
              avatar: createdUser.avatar && getPublicFullStorageUrl(createdUser.avatar),
            }
          : undefined,
      };
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
        throw new CustomHttpException('Base not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.base.notFound',
          },
        });
      });

    const anchorBase = await this.prismaService.base
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { spaceId: base.spaceId, id: anchorId, deletedTime: null },
      })
      .catch(() => {
        throw new CustomHttpException('Anchor base not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.base.anchorNotFound',
            context: {
              anchorId,
            },
          },
        });
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
        const result = await this.baseDuplicateService.duplicateBase(duplicateBaseRo);
        return result.base;
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

  async createBaseFromTemplate(
    createBaseFromTemplateRo: ICreateBaseFromTemplateRo
  ): Promise<ICreateBaseFromTemplateVo> {
    const { spaceId, templateId, withRecords, baseId } = createBaseFromTemplateRo;
    const template = await this.prismaService.template.findUniqueOrThrow({
      where: { id: templateId },
      select: {
        snapshot: true,
        name: true,
        publishInfo: true,
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
        throw new CustomHttpException(
          'BaseId and spaceId mismatch',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.base.baseAndSpaceMismatch',
              context: {
                baseId,
                spaceId,
              },
            },
          }
        );
      }
    }

    const { baseId: fromBaseId = '' } = template?.snapshot ? JSON.parse(template.snapshot) : {};

    if (!template || !fromBaseId) {
      throw new CustomHttpException('Template not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.base.templateNotFound',
          context: {
            templateId,
          },
        },
      });
    }

    return await this.prismaService.$tx(
      async () => {
        const res = await this.baseDuplicateService.duplicateBase(
          {
            name: template.name!,
            fromBaseId,
            spaceId,
            withRecords,
            baseId,
          },
          false
        );
        await this.prismaService.txClient().template.update({
          where: { id: templateId },
          data: { usageCount: { increment: 1 } },
        });

        // Emit template apply audit log
        await this.baseDuplicateService.emitBaseTemplateApplyAuditLog(
          res.base.id,
          createBaseFromTemplateRo,
          res.recordsLength
        );

        // Get defaultActiveNodeId from publishInfo
        const publishInfo = template.publishInfo as { snapshotActiveNodeId?: string } | null;
        const defaultActiveNodeId = publishInfo?.snapshotActiveNodeId;

        // If defaultActiveNodeId is empty, return without it
        if (!defaultActiveNodeId) {
          return res.base;
        }

        // Query the node in the original base to get its resourceId
        const nodeInOriginalBase = await this.prismaService.txClient().baseNode.findFirst({
          where: {
            id: defaultActiveNodeId, // Use node.id, not resourceId
          },
          select: {
            resourceId: true,
            resourceType: true,
          },
        });

        if (!nodeInOriginalBase) {
          return res.base;
        }

        // Get the new resource ID from the appropriate ID map
        const { resourceId: originalResourceId, resourceType } = nodeInOriginalBase;
        const { tableIdMap, dashboardIdMap, workflowIdMap, appIdMap, folderIdMap } = res as {
          base: { id: string; name: string; spaceId: string };
          tableIdMap?: Record<string, string>;
          dashboardIdMap?: Record<string, string>;
          workflowIdMap?: Record<string, string>;
          appIdMap?: Record<string, string>;
          folderIdMap?: Record<string, string>;
        };

        let newResourceId: string | undefined;
        switch (resourceType) {
          case 'table':
            newResourceId = tableIdMap?.[originalResourceId];
            break;
          case 'dashboard':
            newResourceId = dashboardIdMap?.[originalResourceId];
            break;
          case 'workflow':
            newResourceId = workflowIdMap?.[originalResourceId];
            break;
          case 'app':
            newResourceId = appIdMap?.[originalResourceId];
            break;
          case 'folder':
            newResourceId = folderIdMap?.[originalResourceId];
            break;
        }

        // If we found the new resource ID, return it with the resource type
        if (newResourceId) {
          return {
            ...res.base,
            defaultActiveNodeId: newResourceId,
            defaultActiveNodeResourceType: resourceType,
          };
        }

        return res.base;
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
      ...actionPrefixMap[ActionPrefix.App],
      ...actionPrefixMap[ActionPrefix.TableRecordHistory],
    ].reduce((acc, action) => {
      acc[action] = permissions.includes(action);
      return acc;
    }, {} as IGetBasePermissionVo);
  }

  async permanentDeleteBase(baseId: string, ignorePermissionCheck: boolean = false) {
    const accessTokenId = this.cls.get('accessTokenId');
    if (!ignorePermissionCheck) {
      await this.permissionService.validPermissions(baseId, ['base|delete'], accessTokenId, true);
    }

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

  async publishBase(baseId: string, publishBaseRo: IPublishBaseRo) {
    const prisma = this.prismaService.txClient();
    const publishInfo = {
      nodes: publishBaseRo.nodes,
      includeData: publishBaseRo.includeData,
      defaultActiveNodeId: publishBaseRo.defaultActiveNodeId,
    };
    const template = await prisma.template.findFirst({
      where: { baseId },
      select: { id: true },
    });
    const { title, description, cover, nodes, includeData } = publishBaseRo;

    const snapshot = await this.createSnapshot(baseId, nodes, includeData);
    // if already published, update template
    if (template) {
      await prisma.template.update({
        where: { id: template.id },
        data: {
          name: title,
          description,
          cover: cover ? JSON.stringify(cover) : undefined,
          snapshot: JSON.stringify({
            baseId: snapshot.baseId,
            snapshotTime: new Date().toISOString(),
            spaceId: snapshot.spaceId,
            name: snapshot.name,
          }),
          publishInfo: {
            ...publishInfo,
            snapshotActiveNodeId: publishInfo?.defaultActiveNodeId
              ? snapshot.nodeIdMap?.[publishInfo.defaultActiveNodeId] || null
              : null,
          },
        },
      });
      return {
        baseId: snapshot.baseId,
      };
    }

    // if the base is not published, create a template
    // publish snapshot
    await this.createTemplateBySnapshot(baseId, snapshot, publishBaseRo);

    return {
      baseId: snapshot.baseId,
    };
  }

  private async createSnapshot(baseId: string, nodes?: string[], includeData?: boolean) {
    const prisma = this.prismaService.txClient();
    const { id: templateSpaceId } = await prisma.space.findFirstOrThrow({
      where: {
        isTemplate: true,
      },
      select: {
        id: true,
      },
    });
    const base = await prisma.base.findUniqueOrThrow({
      where: { id: baseId, deletedTime: null },
      select: {
        name: true,
      },
    });

    const {
      base: { id, spaceId, name },
      nodeIdMap,
    } = await this.baseDuplicateService.duplicateBase(
      {
        fromBaseId: baseId,
        spaceId: templateSpaceId,
        withRecords: includeData ?? true,
        name: base?.name,
        nodes,
      },
      false,
      true
    );

    // if the base is already published, delete the former base
    const template = await prisma.template.findUnique({
      where: {
        baseId: baseId,
      },
      select: {
        snapshot: true,
      },
    });

    if (template && template.snapshot) {
      const { baseId } = JSON.parse(template.snapshot);
      await this.cleanTemplateRelatedData(baseId);
    }

    return {
      baseId: id,
      spaceId,
      name,
      nodeIdMap,
    };
  }

  async cleanTemplateRelatedData(baseId: string) {
    await this.permanentDeleteBase(baseId, true);
  }

  private async createTemplateBySnapshot(
    sourceBaseId: string,
    snapshot: {
      baseId: string;
      spaceId: string;
      name: string;
      nodeIdMap: Record<string, string>;
    },
    publishBaseRo: IPublishBaseRo
  ) {
    const { title, description, cover } = publishBaseRo;
    const prisma = this.prismaService.txClient();
    const publishInfo = {
      nodes: publishBaseRo.nodes,
      includeData: publishBaseRo.includeData,
      defaultActiveNodeId: publishBaseRo.defaultActiveNodeId,
    };
    const templateId = generateTemplateId();
    const { baseId, spaceId, name } = snapshot;

    const order = await this.prismaService.template.aggregate({
      _max: {
        order: true,
      },
    });

    const userId = this.cls.get('user.id');

    const finalOrder = isNumber(order._max.order) ? order._max.order + 1 : 1;

    await prisma.template.create({
      data: {
        id: templateId,
        name: title,
        description,
        cover: cover ? JSON.stringify(cover) : undefined,
        createdBy: userId,
        order: finalOrder,
        isPublished: true,
        baseId: sourceBaseId,
        snapshot: JSON.stringify({
          baseId: baseId,
          snapshotTime: new Date().toISOString(),
          spaceId,
          name,
        }),
        publishInfo: {
          ...publishInfo,
          snapshotActiveNodeId: publishInfo?.defaultActiveNodeId
            ? snapshot.nodeIdMap?.[publishInfo.defaultActiveNodeId] || null
            : null,
        },
      },
    });
  }
}
