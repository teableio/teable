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
import {
  CollaboratorType,
  ResourceType,
  BaseNodeResourceType,
  BaseDuplicateMode,
  UploadType,
} from '@teable/openapi';
import { isNumber, keyBy, pick, uniq } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { getMaxLevelRole } from '../../utils/get-max-level-role';
import { updateOrder } from '../../utils/update-order';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { ATTACHMENT_LG_THUMBNAIL_HEIGHT } from '../attachments/constant';
import StorageAdapter from '../attachments/plugins/adapter';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { PermissionService } from '../auth/permission.service';
import { CanaryService } from '../canary';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { GraphService } from '../graph/graph.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { BaseDuplicateService } from './base-duplicate.service';
import { replaceDefaultUrl } from './utils';

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
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly canaryService: CanaryService,
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

    // Check if this base's space is in canary release
    const isCanary = await this.canaryService.isSpaceInCanary(base.spaceId);

    return {
      ...base,
      role,
      collaboratorType,
      template:
        template?.baseId === baseId
          ? { id: template.id, headers: this.permissionService.generateTemplateHeader(template.id) }
          : undefined,
      isCanary: isCanary || undefined, // Only include if true
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
        OR: [{ id: { in: baseIds } }, { spaceId: { in: spaceIds }, space: { deletedTime: null } }],
      },
      orderBy: [{ spaceId: 'asc' }, { order: 'asc' }],
    });

    if (!baseList.length) {
      return [];
    }

    const baseSpaceIds = uniq(baseList.map((base) => base.spaceId));
    const { validCreatorSet, spaceOwnerMap } =
      await this.collaboratorService.buildSpaceOwnerContext(baseSpaceIds);

    const allUserIds = uniq([...baseList.map((base) => base.createdBy), ...spaceOwnerMap.values()]);
    const userList = await this.prismaService.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true, name: true, avatar: true },
    });

    const userMap = keyBy(userList, 'id');

    return baseList.map((base) => {
      const isCreatorInSpace = validCreatorSet.has(`${base.spaceId}:${base.createdBy}`);
      const displayUserId = isCreatorInSpace ? base.createdBy : spaceOwnerMap.get(base.spaceId);
      const displayUser = displayUserId ? userMap[displayUserId] : undefined;

      return {
        ...base,
        role: roleMap[base.id] || roleMap[base.spaceId],
        lastModifiedTime: base.lastModifiedTime?.toISOString(),
        createdTime: base.createdTime?.toISOString(),
        createdUser: displayUser
          ? {
              ...displayUser,
              avatar: displayUser.avatar && getPublicFullStorageUrl(displayUser.avatar),
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
          false,
          BaseDuplicateMode.ApplyTemplate
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

        // Get defaultUrl from publishInfo
        const publishInfo = template.publishInfo as { defaultUrl?: string } | null;
        const defaultUrl = publishInfo?.defaultUrl;

        // If defaultUrl exists, replace the snapshot baseId with the new baseId
        if (defaultUrl) {
          const maps = this.getUrlMap(res as unknown as Record<string, string>);
          const newDefaultUrl = replaceDefaultUrl(defaultUrl, {
            ...maps,
            baseMap: {
              [fromBaseId]: res.base.id,
            },
          });
          return {
            ...res.base,
            defaultUrl: newDefaultUrl,
          };
        }

        return res.base;
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  protected getUrlMap(res: Record<string, string>) {
    const maps = pick(res, ['tableIdMap', 'viewIdMap', 'dashboardIdMap']);
    return {
      ...maps,
    } as unknown as Record<string, Record<string, string>>;
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
    if (!ignorePermissionCheck) {
      const accessTokenId = this.cls.get('accessTokenId');
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

  private async permanentEmptyBaseRelatedData(baseId: string) {
    return await this.prismaService.$tx(
      async (prisma) => {
        const tables = await prisma.tableMeta.findMany({
          where: { baseId },
          select: { id: true },
        });
        const tableIds = tables.map(({ id }) => id);

        await this.dropBaseTable(tableIds);
        await this.tableOpenApiService.cleanReferenceFieldIds(tableIds);
        await this.tableOpenApiService.cleanTablesRelatedData(baseId, tableIds);
        await this.cleanBaseRelatedDataWithoutBase(baseId);
        await this.cleanRelativeNodesData(baseId);
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  private async cleanBaseRelatedDataWithoutBase(baseId: string) {
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

    // delete trash for base
    await this.prismaService.txClient().trash.deleteMany({
      where: {
        resourceId: baseId,
        resourceType: ResourceType.Base,
      },
    });
  }

  private async cleanRelativeNodesData(baseId: string) {
    const prisma = this.prismaService.txClient();
    await prisma.baseNode.deleteMany({
      where: { baseId },
    });
    await prisma.baseNodeFolder.deleteMany({
      where: { baseId },
    });
  }

  async dropBase(baseId: string, tableIds: string[]) {
    const sql = this.dbProvider.dropSchema(baseId);
    if (sql) {
      return await this.prismaService.txClient().$executeRawUnsafe(sql);
    }
    await this.tableOpenApiService.dropTables(tableIds);
  }

  async dropBaseTable(tableIds: string[]) {
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

    await this.cleanRelativeNodesData(baseId);
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

  private async generateDefaultUrlForNode(
    snapshotBaseId: string,
    snapshotNodeId: string | null
  ): Promise<string | null> {
    if (!snapshotNodeId) {
      return null;
    }

    const prisma = this.prismaService.txClient();

    const node = await prisma.baseNode.findFirst({
      where: { baseId: snapshotBaseId, id: snapshotNodeId },
      select: { resourceType: true, resourceId: true },
    });

    if (!node) {
      return null;
    }

    const { resourceType, resourceId } = node;

    switch (resourceType) {
      case BaseNodeResourceType.Table: {
        const table = await prisma.tableMeta.findFirst({
          where: { id: resourceId, deletedTime: null },
          select: { id: true },
        });
        if (!table) {
          return `/base/${snapshotBaseId}`;
        }
        const defaultView = await prisma.view.findFirst({
          where: { tableId: resourceId, deletedTime: null },
          orderBy: { order: 'asc' },
          select: { id: true },
        });
        if (defaultView) {
          return `/base/${snapshotBaseId}/table/${resourceId}/${defaultView.id}`;
        }
        return `/base/${snapshotBaseId}/table/${resourceId}`;
      }
      case BaseNodeResourceType.Dashboard:
        return `/base/${snapshotBaseId}/dashboard/${resourceId}`;
      case BaseNodeResourceType.Workflow:
        return `/base/${snapshotBaseId}/automation/${resourceId}`;
      case BaseNodeResourceType.App:
        return `/base/${snapshotBaseId}/app/${resourceId}`;
      default:
        return `/base/${snapshotBaseId}`;
    }
  }

  async publishBase(baseId: string, publishBaseRo: IPublishBaseRo) {
    return await this.prismaService.$tx(
      async (prisma) => {
        const template = await prisma.template.findFirst({
          where: { baseId },
          select: { id: true, snapshot: true },
        });
        const { title, description, cover, nodes, includeData } = publishBaseRo;

        const snapshotBaseId = template?.snapshot
          ? JSON.parse(template.snapshot).baseId
          : undefined;

        const snapshot = await this.createSnapshot(baseId, nodes, includeData, snapshotBaseId);

        // Calculate snapshotActiveNodeId and defaultUrl
        const snapshotActiveNodeId = publishBaseRo.defaultActiveNodeId
          ? snapshot.nodeIdMap?.[publishBaseRo.defaultActiveNodeId] || null
          : null;
        const defaultUrl = await this.generateDefaultUrlForNode(
          snapshot.baseId,
          snapshotActiveNodeId
        );

        const publishInfo = {
          nodes: publishBaseRo.nodes,
          includeData: publishBaseRo.includeData,
          defaultActiveNodeId: publishBaseRo.defaultActiveNodeId,
          snapshotActiveNodeId,
          defaultUrl,
        };

        // Generate thumbnail for template cover image
        if (cover) {
          const coverThumbnail = await this.cropTemplateCoverImage(cover);

          if (coverThumbnail?.lgThumbnailPath && coverThumbnail?.smThumbnailPath) {
            cover.thumbnailPath = {
              lg: coverThumbnail.lgThumbnailPath,
              sm: coverThumbnail.smThumbnailPath,
            };
          }
        }

        // if already published, update template
        if (template) {
          const updatedTemplate = await prisma.template.update({
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
              publishInfo,
              lastModifiedBy: this.cls.get('user.id'),
            },
            select: {
              id: true,
            },
          });

          return {
            baseId: snapshot.baseId,
            defaultUrl,
            permalink: `/t/${updatedTemplate.id}`,
          };
        }

        // if the base is not published, create a template
        // publish snapshot
        const newTemplate = await this.createTemplateBySnapshot(
          baseId,
          snapshot,
          publishBaseRo,
          publishInfo
        );

        return {
          baseId: snapshot.baseId,
          defaultUrl,
          permalink: `/t/${newTemplate.id}`,
        };
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  private async createSnapshot(
    baseId: string,
    nodes?: string[],
    includeData?: boolean,
    existedBaseId?: string
  ) {
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

    if (existedBaseId) {
      // delete some related data
      await this.cleanTemplateRelatedData(existedBaseId);
    }

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
        baseId: existedBaseId,
      },
      false,
      BaseDuplicateMode.CreateTemplate
    );

    return {
      baseId: id,
      spaceId,
      name,
      nodeIdMap,
    };
  }

  async cleanTemplateRelatedData(baseId: string) {
    await this.permanentEmptyBaseRelatedData(baseId);
  }

  /**
   * Generate thumbnail for template cover image
   * Template only has one cover image, so we generate thumbnail synchronously (no queue needed)
   */
  private async cropTemplateCoverImage(cover: {
    path: string;
    mimetype?: string;
    height?: number;
  }) {
    const { path, mimetype, height } = cover;

    // Only process images with height info
    if (!mimetype?.startsWith('image/') || !height) {
      return;
    }

    // Only generate thumbnail if the image is larger than the thumbnail size
    if (height <= ATTACHMENT_LG_THUMBNAIL_HEIGHT) {
      return;
    }

    try {
      const bucket = StorageAdapter.getBucket(UploadType.Template);
      const result = await this.attachmentsStorageService.cropTableImage(bucket, path, height);
      const { lgThumbnailPath, smThumbnailPath } = result;
      this.logger.log(`Template cover thumbnail generated for path: ${path}`);
      return {
        lgThumbnailPath,
        smThumbnailPath,
      };
    } catch (error) {
      // Log error but don't fail the publish operation
      this.logger.error(`Failed to generate template cover thumbnail: ${(error as Error).message}`);
    }
  }

  private async createTemplateBySnapshot(
    sourceBaseId: string,
    snapshot: {
      baseId: string;
      spaceId: string;
      name: string;
      nodeIdMap: Record<string, string>;
    },
    publishBaseRo: IPublishBaseRo,
    publishInfo: {
      nodes?: string[];
      includeData?: boolean;
      defaultActiveNodeId?: string | null;
      snapshotActiveNodeId: string | null;
      defaultUrl: string | null;
    }
  ) {
    const { title, description, cover } = publishBaseRo;
    const prisma = this.prismaService.txClient();
    const templateId = generateTemplateId();
    const { baseId, spaceId, name } = snapshot;

    const order = await this.prismaService.template.aggregate({
      _max: {
        order: true,
      },
    });

    const userId = this.cls.get('user.id');

    const finalOrder = isNumber(order._max.order) ? order._max.order + 1 : 1;

    return await prisma.template.create({
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
        publishInfo,
      },
      select: {
        id: true,
      },
    });
  }
}
