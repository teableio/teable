import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ActionPrefix,
  actionPrefixMap,
  FieldType,
  generateBaseId,
  HttpErrorCode,
  Relationship,
  Role,
  generateTemplateId,
  type ILinkFieldOptions,
} from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import type {
  IBaseErdVo,
  ICreateBaseFromTemplateVo,
  ICreateBaseRo,
  ICrossSpaceAffectedField,
  IDuplicateBaseRo,
  IGetBasePermissionVo,
  IMoveBaseRo,
  IPublishBaseRo,
  IUpdateBaseRo,
  IUpdateOrderRo,
} from '@teable/openapi';
import {
  CollaboratorType,
  CreateRecordAction,
  ResourceType,
  BaseNodeResourceType,
  BaseDuplicateMode,
  UploadType,
  type ICreateBaseFromTemplateRo,
} from '@teable/openapi';
import { isNumber, keyBy, pick, uniq } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import type { IClsStore } from '../../types/cls';
import { getMaxLevelRole } from '../../utils/get-max-level-role';
import { updateOrder } from '../../utils/update-order';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { ATTACHMENT_LG_THUMBNAIL_HEIGHT } from '../attachments/constant';
import StorageAdapter from '../attachments/plugins/adapter';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import { PermissionService } from '../auth/permission.service';
import { CanaryService } from '../canary';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { GraphService } from '../graph/graph.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { BaseDuplicateV2Service } from './base-duplicate-v2.service';
import { BaseDuplicateService } from './base-duplicate.service';
import type { BaseImportProgressCallback } from './base-import.service';
import {
  computeCrossSpaceFieldLevels,
  extractForeignTableId,
  sortByConversionDepth,
} from './cross-space-detection.util';
import { replaceDefaultUrl } from './utils';

type IDataPrismaExecutor = {
  $executeRawUnsafe(query: string, ...values: unknown[]): PromiseLike<number>;
};

/**
 * Stable key for deduplicating orphan link-storage drops across both sides of
 * a symmetric pair. Both sides reference the same underlying junction (M:N) or
 * FK column (N:1 / 1:1), so calling cleanForeignKey twice would error on the
 * second drop. The key matches the storage `cleanForeignKey` actually targets:
 *
 *  - M:N (and one-way OneMany pointing at a junction) → `table:${junction}`
 *  - N:1 / 1:1 / two-way OneMany                       → `column:${host}:${col}`
 */
function computeCrossSpaceCleanupKey(opts: ILinkFieldOptions): string {
  const { fkHostTableName, relationship, selfKeyName, foreignKeyName, isOneWay } = opts;
  if (
    relationship === Relationship.ManyMany ||
    (relationship === Relationship.OneMany && isOneWay)
  ) {
    return `table:${fkHostTableName}`;
  }
  if (relationship === Relationship.ManyOne) {
    return `column:${fkHostTableName}:${foreignKeyName}`;
  }
  if (relationship === Relationship.OneMany) {
    return `column:${fkHostTableName}:${selfKeyName}`;
  }
  if (relationship === Relationship.OneOne) {
    const col = foreignKeyName === '__id' ? selfKeyName : foreignKeyName;
    return `column:${fkHostTableName}:${col}`;
  }
  return `unknown:${fkHostTableName}`;
}

type IDataPrismaScopedClient = IDataPrismaExecutor & {
  txClient?: () => IDataPrismaExecutor;
};

@Injectable()
export class BaseService {
  private logger = new Logger(BaseService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService,
    private readonly baseDuplicateService: BaseDuplicateService,
    private readonly baseDuplicateV2Service: BaseDuplicateV2Service,
    private readonly permissionService: PermissionService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly graphService: GraphService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly canaryService: CanaryService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    // Explicit @Inject after consecutive token-based @Inject decorators (SWC fails
    // to emit design:paramtypes metadata for plain class types in this position).
    @Inject(AuditScope) private readonly audit: AuditScope,
    @Inject(EventEmitterService) private readonly eventEmitterService: EventEmitterService
  ) {}

  private getDataPrismaExecutor(prisma: IDataPrismaScopedClient): IDataPrismaExecutor {
    return prisma.txClient?.() ?? prisma;
  }

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
          v2Enabled: true,
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
    const baseShare = await this.cls.get('baseShare');
    const { role, collaboratorType } =
      template || baseShare
        ? { role: Role.Viewer, collaboratorType: CollaboratorType.Base }
        : await this.getRoleByBaseId(baseId, base.spaceId);

    const [v2Status, isCanary] = await Promise.all([
      this.canaryService.shouldUseV2ForBaseWithReason(base, 'getRecords'),
      this.canaryService.isSpaceInCanary(base.spaceId),
    ]);

    return {
      id: base.id,
      name: base.name,
      icon: base.icon,
      spaceId: base.spaceId,
      createdBy: base.createdBy,
      role,
      collaboratorType,
      template:
        template?.baseId === baseId
          ? { id: template.id, headers: this.permissionService.generateTemplateHeader(template.id) }
          : undefined,
      isCanary: isCanary || undefined,
      v2Status,
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
        v2Enabled: true,
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

    const allBaseIds = baseList.map((base) => base.id);
    const allUserIds = uniq([...baseList.map((base) => base.createdBy), ...spaceOwnerMap.values()]);
    const [userList, sharedBaseList] = await Promise.all([
      this.prismaService.user.findMany({
        where: { id: { in: allUserIds } },
        select: { id: true, name: true, avatar: true },
      }),
      this.prismaService.baseShare.findMany({
        where: { baseId: { in: allBaseIds }, nodeId: null, enabled: true },
        select: { baseId: true },
      }),
    ]);

    const userMap = keyBy(userList, 'id');
    const sharedBaseIds = new Set(sharedBaseList.map((s) => s.baseId));

    return baseList.map((base) => {
      const { v2Enabled, ...baseInfo } = base;
      const isCreatorInSpace = validCreatorSet.has(`${base.spaceId}:${base.createdBy}`);
      const displayUserId = isCreatorInSpace ? base.createdBy : spaceOwnerMap.get(base.spaceId);
      const displayUser = displayUserId ? userMap[displayUserId] : undefined;

      return {
        ...baseInfo,
        role: roleMap[base.id] || roleMap[base.spaceId],
        isShared: sharedBaseIds.has(base.id),
        v2Status: v2Enabled ? ({ useV2: true, reason: 'new_base' } as const) : undefined,
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
    const order = (await this.getMaxOrder(spaceId)) + 1;

    const base = await this.prismaService.base.create({
      data: {
        id: generateBaseId(),
        name: name || 'Untitled Base',
        spaceId,
        order,
        icon,
        v2Enabled: true,
        createdBy: userId,
        provisionState: ProvisionState.pending,
      },
      select: {
        id: true,
        name: true,
        icon: true,
        spaceId: true,
      },
    });

    try {
      const sqlList = this.dbProvider.createSchema(base.id);
      if (sqlList) {
        const dataPrisma = await this.dataDbClientManager.dataPrismaForSpace(spaceId, {
          useTransaction: true,
        });
        for (const sql of sqlList) {
          await dataPrisma.$executeRawUnsafe(sql);
        }
      }

      await this.prismaService.base.update({
        where: { id: base.id },
        data: {
          provisionState: ProvisionState.ready,
          lastModifiedBy: userId,
        },
      });

      return base;
    } catch (error) {
      await this.prismaService.base.update({
        where: { id: base.id },
        data: {
          provisionState: ProvisionState.error,
          lastModifiedBy: userId,
        },
      });
      throw error;
    }
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
      data: {
        deletedTime: new Date(),
        lastModifiedBy: userId,
        provisionState: ProvisionState.deleting,
      },
      where: { id: baseId, deletedTime: null },
    });
  }

  @Audit({
    rootAction: CreateRecordAction.BaseDuplicate,
    resourceId: (ro: IDuplicateBaseRo) => ro.fromBaseId,
    params: (ro: IDuplicateBaseRo) => ro as unknown as Record<string, unknown>,
  })
  async duplicateBase(duplicateBaseRo: IDuplicateBaseRo) {
    const { fromBaseId } = duplicateBaseRo;

    // Regular permission check, base update permission
    await this.checkBaseUpdatePermission(fromBaseId);

    this.logger.log(`base-duplicate-service: Start to duplicating base: ${fromBaseId}`);

    const base = await this.prismaService.$tx(
      async () => {
        const result = await this.baseDuplicateService.duplicateBase(duplicateBaseRo);
        return result.base;
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
    // Terminal signal: transaction committed, operation scope closed. Per-row audit emits
    // inside duplicateBase are fire-and-forget; subscribers needing all audit rows
    // in DB should briefly poll after this event.
    await this.eventEmitterService.emit(Events.BASE_DUPLICATE_COMPLETE, {
      baseId: base.id,
      fromBaseId,
    });
    return base;
  }

  @Audit({
    rootAction: CreateRecordAction.BaseDuplicate,
    resourceId: (ro: IDuplicateBaseRo) => ro.fromBaseId,
    params: (ro: IDuplicateBaseRo) => ro as unknown as Record<string, unknown>,
  })
  async duplicateBaseV2(duplicateBaseRo: IDuplicateBaseRo) {
    const { fromBaseId } = duplicateBaseRo;

    // Regular permission check, base update permission
    await this.checkBaseUpdatePermission(fromBaseId);

    this.logger.log(`base-duplicate-service-v2: Start to duplicating base: ${fromBaseId}`);

    const result = await this.baseDuplicateV2Service.duplicateBase(duplicateBaseRo);
    // Terminal signal mirroring v1 duplicateBase(): subscribers (and e2e tests) poll
    // on this event so they wake up only after the duplicate is fully committed.
    await this.eventEmitterService.emit(Events.BASE_DUPLICATE_COMPLETE, {
      baseId: result.base.id,
      fromBaseId,
    });
    return result.base;
  }

  async duplicateBaseV2WithProgress(
    duplicateBaseRo: IDuplicateBaseRo,
    onProgress?: BaseImportProgressCallback
  ) {
    const { fromBaseId } = duplicateBaseRo;

    await this.checkBaseUpdatePermission(fromBaseId);

    this.logger.log(`base-duplicate-service-v2: Start to duplicating base stream: ${fromBaseId}`);

    return await this.baseDuplicateV2Service.duplicateBase(
      duplicateBaseRo,
      true,
      BaseDuplicateMode.Normal,
      onProgress
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

    return await this.runTemplateApply(
      createBaseFromTemplateRo,
      template,
      fromBaseId,
      spaceId,
      withRecords ?? true,
      baseId,
      templateId
    );
  }

  @Audit({
    rootAction: CreateRecordAction.TemplateApply,
    resourceId: (
      _ro: ICreateBaseFromTemplateRo,
      _template: unknown,
      fromBaseId: string,
      _spaceId: string,
      _withRecords: boolean,
      baseId: string | undefined
    ) => baseId ?? fromBaseId,
    params: (ro: ICreateBaseFromTemplateRo) => ro as unknown as Record<string, unknown>,
  })
  private async runTemplateApply(
    createBaseFromTemplateRo: ICreateBaseFromTemplateRo,
    template: { name: string | null; publishInfo: unknown },
    fromBaseId: string,
    spaceId: string,
    withRecords: boolean,
    baseId: string | undefined,
    templateId: string
  ) {
    // $tx must run INSIDE @Audit's operation so the afterTxCb (which fires structural
    // events via ops2Event) sees TemplateApply attribution. If $tx were wrapped
    // around this call, the operation would pop before afterTxCb runs and structural
    // events would miss payload.rootAction=TemplateApply.
    const result = await this.prismaService.$tx(
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
        // Audit rows emitted by atomic events inside baseDuplicateService.duplicateBase.

        const publishInfo = template.publishInfo as { defaultUrl?: string } | null;
        const defaultUrl = publishInfo?.defaultUrl;

        if (defaultUrl) {
          const maps = this.getUrlMap(res as unknown as Record<string, string>);
          const newDefaultUrl = replaceDefaultUrl(defaultUrl, {
            ...maps,
            baseMap: { [fromBaseId]: res.base.id },
          });
          return { ...res.base, defaultUrl: newDefaultUrl };
        }
        return res.base;
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
    // Terminal signal: see BASE_DUPLICATE_COMPLETE note above for semantics.
    await this.eventEmitterService.emit(Events.BASE_TEMPLATE_APPLY_COMPLETE, {
      baseId: result.id,
      templateId,
      fromBaseId,
    });
    return result;
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
        await this.tableOpenApiService.cleanTablesRelatedData(baseId, tableIds, {
          useTransaction: true,
        });
        await this.cleanBaseRelatedData(baseId);
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  private async permanentEmptyBaseRelatedData(
    baseId: string,
    options: {
      transaction?: 'current';
      emitRuntimeEvents?: boolean;
      syncButtonField?: boolean;
    } = {}
  ) {
    const remove = async () => {
      const prisma = this.prismaService.txClient();
      const tables = await prisma.tableMeta.findMany({
        where: { baseId },
        select: { id: true },
      });
      const tableIds = tables.map(({ id }) => id);

      await this.dropBaseTable(tableIds);
      await this.tableOpenApiService.cleanReferenceFieldIds(tableIds);
      await this.tableOpenApiService.cleanTablesRelatedData(baseId, tableIds, {
        useTransaction: true,
      });
      await this.cleanBaseRelatedDataWithoutBase(baseId);
      await this.cleanRelativeNodesData(baseId);
    };

    if (options.transaction === 'current') {
      return await remove();
    }

    return await this.prismaService.$tx(remove, {
      timeout: this.thresholdConfig.bigTransactionTimeout,
    });
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
      const scopedDataPrisma = await this.dataDbClientManager.dataPrismaForBase(baseId, {
        useTransaction: true,
      });
      return await this.getDataPrismaExecutor(scopedDataPrisma).$executeRawUnsafe(sql);
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
    const { spaceId: targetSpaceId } = moveBaseRo;
    // check if has the permission to create base in the target space
    await this.checkBaseCreatePermission(targetSpaceId);

    const { affected, levels } = await this.computeMoveBaseCrossSpaceImpact(baseId, targetSpaceId);
    // Deepest-first: dependent lookup/rollup fields convert first via the
    // regular convertField path so their values are snapshotted by
    // cellValue2String before the upstream Link is downgraded. The Link
    // fields themselves (level 0) then go through convertCrossSpaceLinkToText,
    // which skips the destructive linkToOther cleanup so the symmetric
    // partner in the other base survives and can be converted independently
    // (preserving its own values).
    const conversionOrder = sortByConversionDepth(affected, levels);

    // Snapshot every converted Link's old options so we can drop the now-
    // orphaned junction / FK column after the conversion tx commits (cleanup
    // is intentionally deferred — running it during convert would break the
    // symmetric partner's read path before its own snapshot lands).
    const linkOptionsToCleanup: ILinkFieldOptions[] = [];

    try {
      await this.prismaService.$tx(async () => {
        for (const f of conversionOrder) {
          const stillNeedsConversion = await this.prismaService.txClient().field.findFirst({
            where: { id: f.fieldId, tableId: f.tableId, deletedTime: null },
            select: { id: true, type: true, isLookup: true, isConditionalLookup: true },
          });
          if (!stillNeedsConversion) {
            // No longer expected with the cross-space convert path (symmetric
            // partner is preserved). Log if it happens — it would indicate an
            // unexpected upstream change.
            this.logger.warn(
              `[cross-space] move-base field unexpectedly missing: fieldId=${f.fieldId} tableId=${f.tableId} baseId=${f.baseId} reason=${f.reason}`
            );
            continue;
          }
          if (
            stillNeedsConversion.type === FieldType.SingleLineText &&
            !stillNeedsConversion.isLookup &&
            !stillNeedsConversion.isConditionalLookup
          ) {
            continue;
          }
          const isRootLink =
            stillNeedsConversion.type === FieldType.Link &&
            !stillNeedsConversion.isLookup &&
            !stillNeedsConversion.isConditionalLookup;
          if (isRootLink) {
            const { oldLinkOptions } = await this.fieldOpenApiService.convertCrossSpaceLinkToText(
              f.tableId,
              f.fieldId
            );
            linkOptionsToCleanup.push(oldLinkOptions);
          } else {
            await this.fieldOpenApiService.convertField(f.tableId, f.fieldId, {
              type: FieldType.SingleLineText,
            });
          }
        }
        await this.prismaService.txClient().base.update({
          where: { id: baseId },
          data: { spaceId: targetSpaceId },
        });
      });
    } catch (error) {
      this.logger.error(
        `[cross-space] move-base failed: baseId=${baseId} targetSpaceId=${targetSpaceId} affected=${affected.length} error=${(error as Error).message}`
      );
      throw error;
    }

    // Drop orphan junction / FK storage now that every Link in the pair has
    // been converted. Best-effort: log warnings on failure rather than abort,
    // since the move itself already succeeded and leaving orphan storage is
    // recoverable (manual SQL or future sweep). Dedup by storage target so
    // both sides of a symmetric pair don't fight over the same DROP.
    const cleanupSeen = new Set<string>();
    for (const opts of linkOptionsToCleanup) {
      const key = computeCrossSpaceCleanupKey(opts);
      if (cleanupSeen.has(key)) continue;
      cleanupSeen.add(key);
      try {
        await this.fieldOpenApiService.cleanOrphanCrossSpaceLinkStorage(opts);
      } catch (e) {
        this.logger.warn(
          `[cross-space] orphan link storage cleanup failed: key=${key} error=${(e as Error).message}`
        );
      }
    }
  }

  async previewMoveBaseCrossSpace(
    baseId: string,
    targetSpaceId: string
  ): Promise<ICrossSpaceAffectedField[]> {
    return (await this.computeMoveBaseCrossSpaceImpact(baseId, targetSpaceId)).affected;
  }

  private async computeMoveBaseCrossSpaceImpact(
    baseId: string,
    targetSpaceId: string
  ): Promise<{ affected: ICrossSpaceAffectedField[]; levels: Map<string, number> }> {
    const prisma = this.prismaService.txClient();

    const movingBase = await prisma.base.findUniqueOrThrow({
      where: { id: baseId },
      select: { id: true, name: true, spaceId: true },
    });

    const myTables = await prisma.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true, name: true },
    });
    if (!myTables.length) return { affected: [], levels: new Map() };
    const myTableIds = myTables.map((t) => t.id);
    const myTableNameMap = new Map(myTables.map((t) => [t.id, t.name]));
    const myTableSet = new Set(myTableIds);

    const fieldSelect = {
      id: true,
      name: true,
      type: true,
      tableId: true,
      isLookup: true,
      isConditionalLookup: true,
      options: true,
      lookupOptions: true,
    } as const;

    // ---- Outgoing: fields in my tables whose foreignTable lives in a different
    // space than the move destination. Closure (direct + lookup/rollup chains)
    // is handled by computeCrossSpaceFieldLevels.
    const outgoingFields = await prisma.field.findMany({
      where: { tableId: { in: myTableIds }, deletedTime: null },
      select: fieldSelect,
    });

    const outgoingForeignIds = uniq(
      outgoingFields
        .map((f) => extractForeignTableId(f))
        .filter((ft): ft is string => !!ft && !myTableSet.has(ft))
    );
    const outgoingForeignSpaceMap = outgoingForeignIds.length
      ? new Map(
          (
            await prisma.tableMeta.findMany({
              where: { id: { in: outgoingForeignIds }, deletedTime: null },
              select: { id: true, base: { select: { spaceId: true } } },
            })
          ).map((t) => [t.id, t.base.spaceId])
        )
      : new Map<string, string>();

    const outgoingLevels = computeCrossSpaceFieldLevels({
      fields: outgoingFields,
      isForeignInternal: (ft) => myTableSet.has(ft),
      isForeignCrossSpace: (ft) => {
        const s = outgoingForeignSpaceMap.get(ft);
        return Boolean(s && s !== targetSpaceId);
      },
    });

    // ---- Incoming: fields in OTHER tables (outside this base) whose
    // foreignTable points at one of my tables, but only when the source-side
    // base is not already in the destination space.
    const incomingDirect = await prisma.field.findMany({
      where: {
        tableId: { notIn: myTableIds },
        deletedTime: null,
        OR: [
          { type: FieldType.Link, isLookup: null },
          { isLookup: true, isConditionalLookup: true },
          { type: FieldType.ConditionalRollup },
        ],
      },
      select: fieldSelect,
    });
    const incomingSourceTableIds = uniq(
      incomingDirect.flatMap((f) => {
        const ft = extractForeignTableId(f);
        return ft && myTableSet.has(ft) ? [f.tableId] : [];
      })
    );
    const incomingSourceTables = incomingSourceTableIds.length
      ? await prisma.tableMeta.findMany({
          where: { id: { in: incomingSourceTableIds }, deletedTime: null },
          select: {
            id: true,
            name: true,
            base: { select: { id: true, name: true, spaceId: true } },
          },
        })
      : [];
    const crossSpaceSourceTables = incomingSourceTables.filter(
      (t) => t.base.spaceId !== targetSpaceId
    );
    const crossSpaceSourceTableMap = new Map(crossSpaceSourceTables.map((t) => [t.id, t]));

    const incomingFields = crossSpaceSourceTableMap.size
      ? await prisma.field.findMany({
          where: {
            tableId: { in: Array.from(crossSpaceSourceTableMap.keys()) },
            deletedTime: null,
          },
          select: fieldSelect,
        })
      : [];
    const incomingLevels = computeCrossSpaceFieldLevels({
      fields: incomingFields,
      isForeignCrossSpace: (ft) => myTableSet.has(ft),
    });

    const affected: ICrossSpaceAffectedField[] = [];
    for (const f of outgoingFields) {
      if (!outgoingLevels.has(f.id)) continue;
      affected.push({
        fieldId: f.id,
        fieldName: f.name,
        type: f.type,
        tableId: f.tableId,
        tableName: myTableNameMap.get(f.tableId) ?? '',
        baseId: movingBase.id,
        baseName: movingBase.name,
        reason: 'direct_link',
      });
    }
    for (const f of incomingFields) {
      if (!incomingLevels.has(f.id)) continue;
      const t = crossSpaceSourceTableMap.get(f.tableId);
      if (!t) continue;
      affected.push({
        fieldId: f.id,
        fieldName: f.name,
        type: f.type,
        tableId: f.tableId,
        tableName: t.name,
        baseId: t.base.id,
        baseName: t.base.name,
        reason: 'incoming_link',
      });
    }
    // FieldIds are globally unique, so outgoing/incoming maps cannot collide.
    const levels = new Map<string, number>([...outgoingLevels, ...incomingLevels]);
    return { affected, levels };
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
      await this.cleanTemplateRelatedData(existedBaseId, {
        transaction: 'current',
        emitRuntimeEvents: false,
        syncButtonField: false,
      });
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

  async cleanTemplateRelatedData(
    baseId: string,
    options: {
      transaction?: 'current';
      emitRuntimeEvents?: boolean;
      syncButtonField?: boolean;
    } = {}
  ) {
    await this.permanentEmptyBaseRelatedData(baseId, options);
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
