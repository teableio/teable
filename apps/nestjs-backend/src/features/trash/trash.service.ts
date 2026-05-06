/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import type { FieldType, IFieldVo } from '@teable/core';
import { FieldKeyType, HttpErrorCode, IdPrefix, Role } from '@teable/core';
import { PrismaService, type Prisma } from '@teable/db-main-prisma';
import { DataPrismaService } from '@teable/db-data-prisma';
import type {
  IResetTrashItemsRo,
  IResourceMapVo,
  ITrashItemsRo,
  ITrashItemVo,
  ITrashRo,
  ITrashVo,
} from '@teable/openapi';
import { CollaboratorType, TableTrashType, TrashType } from '@teable/openapi';
import { TableId, v2CoreTokens } from '@teable/v2-core';
import type { Table, TableQueryService } from '@teable/v2-core';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { ICreateFieldsOperation } from '../../cache/types';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import type { IPerformanceCacheStore } from '../../performance-cache';
import { PerformanceCacheService } from '../../performance-cache';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { BaseService } from '../base/base.service';
import { CanaryService, type IV2Decision } from '../canary/canary.service';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';
import { SpaceService } from '../space/space.service';
import { TableOpenApiV2Service } from '../table/open-api/table-open-api-v2.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { UserService } from '../user/user.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';
import { ViewService } from '../view/view.service';
import { resolveV2TrashRecordDisplayName } from './v2-trash-record-name';
import { META_KNEX } from '../../global/knex';

@Injectable()
export class TrashService {
  constructor(
    protected readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    protected readonly prismaService: PrismaService,
    protected readonly dataPrismaService: DataPrismaService,
    protected readonly cls: ClsService<IClsStore>,
    protected readonly userService: UserService,
    protected readonly permissionService: PermissionService,
    protected readonly spaceService: SpaceService,
    protected readonly baseService: BaseService,
    protected readonly tableOpenApiService: TableOpenApiService,
    protected readonly tableOpenApiV2Service: TableOpenApiV2Service,
    protected readonly fieldOpenApiService: FieldOpenApiService,
    protected readonly recordOpenApiService: RecordOpenApiService,
    protected readonly recordService: RecordService,
    protected readonly viewService: ViewService,
    protected readonly v2ContainerService: V2ContainerService,
    protected readonly v2ExecutionContextFactory: V2ExecutionContextFactory,
    protected readonly canaryService: CanaryService,
    @ThresholdConfig() protected readonly thresholdConfig: IThresholdConfig,
    @InjectModel(META_KNEX) protected readonly knex: Knex
  ) {}

  async getAuthorizedSpacesAndBases() {
    const userId = this.cls.get('user.id');
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);

    const collaborators = await this.prismaService.txClient().collaborator.findMany({
      where: {
        principalId: { in: [userId, ...(departmentIds || [])] },
        roleName: { in: [Role.Owner, Role.Creator] },
      },
      select: {
        resourceId: true,
        resourceType: true,
      },
    });

    const baseIds = new Set<string>();
    const spaceIds = new Set<string>();

    collaborators.forEach(({ resourceId, resourceType }) => {
      if (resourceType === CollaboratorType.Base) baseIds.add(resourceId);
      if (resourceType === CollaboratorType.Space) spaceIds.add(resourceId);
    });
    const bases = await this.prismaService.base.findMany({
      where: {
        OR: [{ spaceId: { in: Array.from(spaceIds) } }, { id: { in: Array.from(baseIds) } }],
      },
      select: {
        id: true,
        name: true,
        spaceId: true,
        space: {
          select: {
            name: true,
          },
        },
      },
    });
    const spaces = await this.prismaService.space.findMany({
      where: { id: { in: Array.from(spaceIds) } },
      select: { id: true, name: true },
    });

    return {
      spaces,
      bases,
    };
  }

  async getTrash(trashRo: ITrashRo) {
    const { resourceType, spaceId } = trashRo;

    switch (resourceType) {
      case TrashType.Space:
        return await this.getSpaceTrash();
      case TrashType.Base:
        return await this.getBaseTrash(spaceId);
      default:
        throw new CustomHttpException(
          `Invalid resource type ${resourceType}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.trash.invalidResourceType',
            },
          }
        );
    }
  }

  private async getSpaceTrash() {
    const { spaces } = await this.getAuthorizedSpacesAndBases();
    const spaceIds = spaces.map((space) => space.id);
    const spaceIdMap = keyBy(spaces, 'id');
    const list = await this.prismaService.trash.findMany({
      where: { resourceId: { in: spaceIds } },
      orderBy: { deletedTime: 'desc' },
    });

    const trashItems: ITrashItemVo[] = [];
    const deletedBySet: Set<string> = new Set();
    const resourceMap: IResourceMapVo = {};

    list.forEach((item) => {
      const { id, resourceId, resourceType, deletedTime, deletedBy } = item;

      trashItems.push({
        id,
        resourceId,
        resourceType: resourceType as TrashType,
        deletedTime: deletedTime.toISOString(),
        deletedBy,
      });
      resourceMap[resourceId] = {
        id: resourceId,
        name: spaceIdMap[resourceId].name,
      };
      deletedBySet.add(deletedBy);
    });

    const userList = await this.userService.getUserInfoList(Array.from(deletedBySet));

    return {
      trashItems,
      resourceMap,
      userMap: keyBy(userList, 'id'),
      nextCursor: null,
    };
  }

  private async getBaseTrash(spaceId?: string) {
    const { bases } = await this.getAuthorizedSpacesAndBases();
    const authorizedBaseIds = bases.map((base) => base.id);
    const authorizedBaseSpaceIds = bases.map((base) => base.spaceId);
    const baseIdMap = keyBy(bases, 'id');

    const trashedSpaces = await this.prismaService.trash.findMany({
      where: {
        resourceType: TrashType.Space,
        resourceId: { in: authorizedBaseSpaceIds },
      },
      select: { resourceId: true },
    });
    const list = await this.prismaService.trash.findMany({
      where: {
        parentId: {
          notIn: trashedSpaces.map((space) => space.resourceId),
          in: spaceId ? [spaceId] : undefined,
        },
        resourceId: { in: authorizedBaseIds },
        resourceType: TrashType.Base,
      },
    });

    const trashItems: ITrashItemVo[] = [];
    const deletedBySet: Set<string> = new Set();
    const resourceMap: IResourceMapVo = {};

    list.forEach((item) => {
      const { id, resourceId, resourceType, deletedTime, deletedBy } = item;

      trashItems.push({
        id,
        resourceId,
        resourceType: resourceType as TrashType,
        deletedTime: deletedTime.toISOString(),
        deletedBy,
      });
      deletedBySet.add(deletedBy);

      const baseInfo = baseIdMap[resourceId];
      resourceMap[resourceId] = {
        id: resourceId,
        spaceId: baseInfo.spaceId,
        name: baseInfo.name,
      };
      resourceMap[baseInfo.spaceId] = {
        id: baseInfo.spaceId,
        name: baseInfo.space.name,
      };
    });
    const userList = await this.userService.getUserInfoList(Array.from(deletedBySet));

    return {
      trashItems,
      resourceMap,
      userMap: keyBy(userList, 'id'),
      nextCursor: null,
    };
  }

  async getTrashItems(trashItemsRo: ITrashItemsRo): Promise<ITrashVo> {
    const { resourceType } = trashItemsRo;

    switch (resourceType) {
      case TrashType.Base:
        return await this.getBaseTrashItems(trashItemsRo);
      case TrashType.Table:
        return await this.getTableTrashItems(trashItemsRo);
      default:
        throw new CustomHttpException(
          `Invalid resource type ${resourceType}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.trash.invalidResourceType',
            },
          }
        );
    }
  }

  private async getV2TableDomain(tableId: string): Promise<Table | null> {
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      return null;
    }

    try {
      const container = await this.v2ContainerService.getContainer();
      const tableQueryService = container.resolve<TableQueryService>(
        v2CoreTokens.tableQueryService
      );
      const queryContext = await this.v2ExecutionContextFactory.createContext();
      const tableResult = await tableQueryService.getById(queryContext, tableIdResult.value);

      return tableResult.isOk() ? tableResult.value : null;
    } catch {
      return null;
    }
  }

  private async getRecordTrashResourceMap(
    tableId: string,
    recordList: Array<{ recordId: string; snapshot: string }>
  ): Promise<IResourceMapVo> {
    const cache = { loaded: false, table: null as Table | null };
    const resourceMap: IResourceMapVo = {};

    for (const { recordId, snapshot } of recordList) {
      const parsedSnapshot = JSON.parse(snapshot) as {
        id?: string;
        name?: string;
        fields?: Record<string, unknown>;
      };

      const name = await this.resolveRecordTrashName(tableId, recordId, parsedSnapshot, cache);
      resourceMap[recordId] = { id: recordId, name };
    }

    return resourceMap;
  }

  private async getCachedV2Table(
    tableId: string,
    cache: { loaded: boolean; table: Table | null }
  ): Promise<Table | null> {
    if (!cache.loaded) {
      cache.table = await this.getV2TableDomain(tableId);
      cache.loaded = true;
    }

    return cache.table;
  }

  private async resolveRecordTrashName(
    tableId: string,
    recordId: string,
    parsedSnapshot: { id?: string; name?: string; fields?: Record<string, unknown> },
    cache: { loaded: boolean; table: Table | null }
  ): Promise<string> {
    const snapshotName = typeof parsedSnapshot.name === 'string' ? parsedSnapshot.name.trim() : '';
    if (snapshotName) {
      return snapshotName;
    }

    if (
      parsedSnapshot.fields == null ||
      typeof parsedSnapshot.fields !== 'object' ||
      Array.isArray(parsedSnapshot.fields)
    ) {
      return '';
    }

    const table = await this.getCachedV2Table(tableId, cache);
    if (!table) {
      return '';
    }

    const nameResult = resolveV2TrashRecordDisplayName(table, {
      id: parsedSnapshot.id ?? recordId,
      fields: parsedSnapshot.fields,
    });

    return nameResult.isOk() ? nameResult.value ?? '' : '';
  }

  async getResourceMapByIds(
    resourceType: TableTrashType,
    resourceIds: string[],
    tableId: string
  ): Promise<IResourceMapVo> {
    switch (resourceType) {
      case TableTrashType.View: {
        const views = await this.prismaService.view.findMany({
          where: { id: { in: resourceIds }, deletedTime: { not: null } },
          select: {
            id: true,
            name: true,
            type: true,
          },
        });
        return keyBy(views, 'id');
      }
      case TableTrashType.Field: {
        const fields = await this.prismaService.field.findMany({
          where: { id: { in: resourceIds }, deletedTime: { not: null } },
          select: {
            id: true,
            name: true,
            type: true,
            options: true,
            isLookup: true,
            isConditionalLookup: true,
          },
        });
        return fields.reduce((acc, { id, name, type, options, isLookup, isConditionalLookup }) => {
          acc[id] = {
            id,
            name,
            type: type as FieldType,
            options: options ? JSON.parse(options) : undefined,
            isLookup,
            isConditionalLookup,
          };
          return acc;
        }, {} as IResourceMapVo);
      }
      case TableTrashType.Record: {
        const recordList = await this.dataPrismaService.recordTrash.findMany({
          where: { tableId, recordId: { in: resourceIds } },
          select: {
            recordId: true,
            snapshot: true,
          },
        });

        return await this.getRecordTrashResourceMap(tableId, recordList);
      }
      default:
        throw new CustomHttpException(
          `Invalid resource type ${resourceType}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.trash.invalidResourceType',
            },
          }
        );
    }
  }

  async getTableTrashItems(trashItemsRo: ITrashItemsRo): Promise<ITrashVo> {
    const { resourceId: tableId, cursor, pageSize = 20 } = trashItemsRo;
    const accessTokenId = this.cls.get('accessTokenId');
    let nextCursor: typeof cursor | undefined = undefined;

    await this.permissionService.validPermissions(
      tableId,
      ['table|trash_read'],
      accessTokenId,
      true
    );

    const list = await this.dataPrismaService.tableTrash.findMany({
      where: {
        tableId,
      },
      select: {
        id: true,
        snapshot: true,
        resourceType: true,
        createdBy: true,
        createdTime: true,
      },
      take: pageSize + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        createdTime: 'desc',
      },
    });

    if (list.length > pageSize) {
      const nextItem = list.pop();
      nextCursor = nextItem?.id;
    }

    const deletedResourceMap: Record<
      TableTrashType.View | TableTrashType.Field | TableTrashType.Record,
      string[]
    > = {
      [TableTrashType.View]: [],
      [TableTrashType.Field]: [],
      [TableTrashType.Record]: [],
    };
    const deletedBySet: Set<string> = new Set();
    const trashItems = list.map((item) => {
      const { id, snapshot, createdBy, createdTime } = item;
      const parsedSnapshot = JSON.parse(snapshot);
      const resourceType = item.resourceType as TableTrashType;

      const resourceIds =
        resourceType === TableTrashType.Field
          ? (parsedSnapshot.fields as IFieldVo[]).map(({ id }) => id)
          : parsedSnapshot;
      deletedResourceMap[resourceType].push(...resourceIds);
      deletedBySet.add(createdBy);

      return {
        id,
        resourceType: resourceType,
        deletedTime: createdTime.toISOString(),
        deletedBy: createdBy,
        resourceIds,
      };
    });

    const resourceMap: IResourceMapVo = {};

    for (const [type, ids] of Object.entries(deletedResourceMap)) {
      if (ids.length > 0) {
        const resources = await this.getResourceMapByIds(type as TableTrashType, ids, tableId);
        Object.assign(resourceMap, resources);
      }
    }

    const userList = await this.userService.getUserInfoList(Array.from(deletedBySet));

    return {
      trashItems,
      resourceMap,
      userMap: keyBy(userList, 'id'),
      nextCursor,
    };
  }

  protected async getBaseTrashResourceList(baseId: string) {
    return await this.prismaService.tableMeta.findMany({
      where: {
        baseId,
        deletedTime: { not: null },
      },
      select: {
        id: true,
        name: true,
      },
    });
  }

  async getBaseTrashItems(trashItemsRo: ITrashItemsRo): Promise<ITrashVo> {
    const { resourceId: baseId, cursor, pageSize = 20 } = trashItemsRo;
    let nextCursor: string | null | undefined = undefined;

    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(
      baseId,
      ['table|delete', 'app|delete', 'automation|delete'],
      accessTokenId,
      true
    );

    const trashItems: ITrashItemVo[] = [];
    const deletedBySet: Set<string> = new Set();
    const resourceList = await this.getBaseTrashResourceList(baseId);
    const resourceMap: IResourceMapVo = keyBy(resourceList, 'id');

    const list = await this.prismaService.trash.findMany({
      where: {
        parentId: baseId,
      },
      take: pageSize + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { deletedTime: 'desc' },
    });

    if (list.length > pageSize) {
      const nextItem = list.pop();
      nextCursor = nextItem?.id;
    }

    list.forEach((item) => {
      const { id, resourceId, resourceType, deletedTime, deletedBy } = item;

      trashItems.push({
        id,
        resourceId,
        resourceType: resourceType as TrashType,
        deletedTime: deletedTime.toISOString(),
        deletedBy,
      });
      deletedBySet.add(deletedBy);
    });
    const userList = await this.userService.getUserInfoList(Array.from(deletedBySet));

    return {
      trashItems,
      resourceMap,
      userMap: keyBy(userList, 'id'),
      nextCursor: nextCursor ?? null,
    };
  }

  private async restoreSpace(spaceId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(spaceId, ['space|create'], accessTokenId, true);

    await this.prismaService.txClient().space.update({
      where: { id: spaceId },
      data: { deletedTime: null },
    });
  }

  private async restoreBase(baseId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(baseId, ['base|create'], accessTokenId, true);

    const prisma = this.prismaService.txClient();
    const base = await prisma.base.findUniqueOrThrow({
      where: { id: baseId },
      select: { id: true, spaceId: true },
    });
    const trashedSpace = await prisma.trash.findFirst({
      where: { resourceId: base.spaceId, resourceType: TrashType.Space },
    });

    if (trashedSpace != null) {
      throw new CustomHttpException(
        'Unable to restore this base because its parent space is also trashed',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.trash.parentSpaceTrashed',
          },
        }
      );
    }

    await this.permissionService.validPermissions(baseId, ['base|create'], accessTokenId, true);

    await prisma.base.update({
      where: { id: baseId },
      data: { deletedTime: null },
    });

    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
  }

  private async assertParentNotTrashed(parentId: string | null) {
    if (!parentId) {
      return;
    }

    // Use recursive CTE to check if any parent in the hierarchy is trashed
    const query = this.knex
      .withRecursive('parent_chain', (qb) => {
        // Base case: check if the immediate parent is in trash
        qb.select('resource_id', 'parent_id')
          .from('trash')
          .where('resource_id', parentId)
          .unionAll((qb) => {
            // Recursive case: traverse up the parent hierarchy
            qb.select('t.resource_id', 't.parent_id')
              .from('trash as t')
              .join('parent_chain as pc', 't.resource_id', 'pc.parent_id')
              .whereNotNull('pc.parent_id');
          });
      })
      .select('resource_id')
      .from('parent_chain')
      .limit(1)
      .toQuery();

    const result = await this.prismaService.$queryRawUnsafe<{ resourceId: string }[]>(query);
    if (result.length > 0) {
      throw new CustomHttpException(
        'Unable to restore this resource because its parent is also in trash',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.trash.parentBaseTrashed',
          },
        }
      );
    }
  }

  private async restoreTable(tableId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(tableId, ['table|create'], accessTokenId, true);

    const prisma = this.prismaService.txClient();
    const { baseId } = await prisma.tableMeta
      .findUniqueOrThrow({
        where: { id: tableId },
        select: { baseId: true },
      })
      .catch(() => {
        throw new CustomHttpException(`The table ${tableId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.table.notFound',
          },
        });
      });
    await this.tableOpenApiService.restoreTable(baseId, tableId);
    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
  }

  async getRestoreTableV2Decision(
    trashId: string
  ): Promise<(IV2Decision & { baseId: string; tableId: string }) | undefined> {
    if (trashId.startsWith(IdPrefix.Operation)) {
      return undefined;
    }

    const trash = await this.prismaService.txClient().trash.findUnique({
      where: { id: trashId },
      select: {
        resourceId: true,
        resourceType: true,
        parentId: true,
      },
    });

    if (!trash || trash.resourceType !== TrashType.Table) {
      return undefined;
    }

    const baseId = trash.parentId;
    if (!baseId) {
      return { useV2: false, reason: 'disabled', baseId: '', tableId: trash.resourceId };
    }

    const base = await this.prismaService.txClient().base.findUnique({
      where: { id: baseId, deletedTime: null },
      select: { spaceId: true, v2Enabled: true },
    });

    if (!base?.spaceId) {
      return { useV2: false, reason: 'disabled', baseId, tableId: trash.resourceId };
    }

    const decision = await this.canaryService.shouldUseV2ForBaseWithReason(base, 'restoreTable');
    return {
      ...decision,
      baseId,
      tableId: trash.resourceId,
    };
  }

  async restoreTrashV2(trashId: string) {
    const decision = await this.getRestoreTableV2Decision(trashId);
    if (!decision) {
      throw new CustomHttpException(`The trash ${trashId} not found`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.trash.notFound',
        },
      });
    }

    await this.assertParentNotTrashed(decision.baseId);
    await this.restoreTableV2(decision.baseId, decision.tableId);
  }

  private async restoreTableV2(baseId: string, tableId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(tableId, ['table|create'], accessTokenId, true);
    await this.tableOpenApiV2Service.restoreTable(baseId, tableId);
    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
  }

  async restoreResource(trash: { resourceType: TrashType; resourceId: string }) {
    const { resourceType, resourceId } = trash;
    switch (resourceType) {
      case TrashType.Space:
        return this.restoreSpace(resourceId);
      case TrashType.Base:
        return this.restoreBase(resourceId);
      case TrashType.Table:
        return this.restoreTable(resourceId);
      default:
        throw new CustomHttpException(
          `Invalid resource type ${resourceType}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.trash.invalidResourceType',
            },
          }
        );
    }
  }

  async restoreTableResource(trashId: string) {
    const accessTokenId = this.cls.get('accessTokenId');

    const {
      tableId,
      resourceType,
      snapshot: originSnapshot,
      createdTime,
    } = await this.dataPrismaService.tableTrash
      .findUniqueOrThrow({
        where: { id: trashId },
        select: {
          tableId: true,
          resourceType: true,
          snapshot: true,
          createdTime: true,
        },
      })
      .catch(() => {
        throw new CustomHttpException(
          `The table trash ${trashId} not found`,
          HttpErrorCode.NOT_FOUND,
          {
            localization: {
              i18nKey: 'httpErrors.trash.tableNotFound',
            },
          }
        );
      });

    await this.permissionService.validPermissions(
      tableId,
      ['table|trash_update'],
      accessTokenId,
      true
    );

    const snapshot = JSON.parse(originSnapshot);

    switch (resourceType) {
      case TableTrashType.View: {
        await this.viewService.restoreView(tableId, snapshot[0]);
        break;
      }
      case TableTrashType.Field: {
        const { fields, records } = snapshot as ICreateFieldsOperation['result'];
        await this.fieldOpenApiService.createFields(tableId, fields);
        if (records) {
          const existingSnapshots = await this.recordService.getSnapshotBulk(
            tableId,
            records.map((r) => r.id)
          );
          const existingIdSet = new Set(existingSnapshots.map((s) => s.data.id));
          const filteredRecords = records.filter((r) => existingIdSet.has(r.id));
          if (filteredRecords.length) {
            await this.recordOpenApiService.updateRecords(tableId, {
              fieldKeyType: FieldKeyType.Id,
              records: filteredRecords,
            });
          }
        }
        break;
      }
      case TableTrashType.Record: {
        const recordIds = snapshot as string[];
        type IRecordTrashSnapshotRow = Prisma.RecordTrashGetPayload<{
          select: {
            id: true;
            recordId: true;
            snapshot: true;
            createdTime: true;
          };
        }>;
        const recordTrashRows = await this.dataPrismaService.recordTrash.findMany({
          where: { tableId, recordId: { in: recordIds } },
          select: {
            id: true,
            recordId: true,
            snapshot: true,
            createdTime: true,
          },
          orderBy: [{ recordId: 'asc' }, { createdTime: 'desc' }, { id: 'desc' }],
        });

        // A record can be deleted, restored through undo, then deleted again with the same id.
        // Restore should use the snapshot that belongs to this trash item, not every historical
        // record_trash row for the same record id.
        const latestSnapshotsByRecordId = recordTrashRows.reduce<Map<string, IRecordTrashSnapshotRow>>(
          (acc, row) => {
            if (row.createdTime <= createdTime && !acc.has(row.recordId)) {
              acc.set(row.recordId, row);
            }
            return acc;
          },
          new Map<string, IRecordTrashSnapshotRow>()
        );

        const matchedRecordTrashRows = recordIds
          .map((recordId) => latestSnapshotsByRecordId.get(recordId))
          .filter((row): row is IRecordTrashSnapshotRow => row != null);
        const records = matchedRecordTrashRows.map(({ snapshot }) => JSON.parse(snapshot));

        await this.recordOpenApiService.multipleCreateRecords(
          tableId,
          {
            fieldKeyType: FieldKeyType.Id,
            records,
            typecast: true,
          },
          true
        );
        await this.dataPrismaService.$tx(
          async (prisma) => {
            await prisma.recordTrash.deleteMany({
              where: { id: { in: matchedRecordTrashRows.map(({ id }) => id) } },
            });
            await prisma.tableTrash.delete({
              where: { id: trashId },
            });
          },
          {
            timeout: this.thresholdConfig.bigTransactionTimeout,
          }
        );
        return;
      }
      default:
        throw new CustomHttpException(
          `Invalid resource type ${resourceType}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.trash.invalidResourceType',
            },
          }
        );
    }

    await this.dataPrismaService.tableTrash.delete({
      where: { id: trashId },
    });
  }

  async restoreTrash(trashId: string) {
    if (trashId.startsWith(IdPrefix.Operation)) {
      return await this.restoreTableResource(trashId);
    }

    await this.prismaService.$tx(async (prisma) => {
      const trash = await prisma.trash
        .findUniqueOrThrow({
          where: { id: trashId },
          select: {
            id: true,
            resourceId: true,
            resourceType: true,
            parentId: true,
          },
        })
        .catch(() => {
          throw new CustomHttpException(`The trash ${trashId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.trash.notFound',
            },
          });
        });

      await this.assertParentNotTrashed(trash.parentId);

      await this.restoreResource({
        resourceType: trash.resourceType as TrashType,
        resourceId: trash.resourceId,
      });

      await prisma.trash.deleteMany({
        where: { id: trashId },
      });
    });
  }

  /**
   * Reset base trash resource (tables, Apps, Workflows)
   */
  protected async resetBaseTrashResource(resetTrashItemsRo: IResetTrashItemsRo) {
    const { resourceId } = resetTrashItemsRo;
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(
      resourceId,
      ['table|delete', 'app|delete', 'automation|delete'],
      accessTokenId,
      true
    );

    const tables = await this.prismaService.tableMeta.findMany({
      where: {
        baseId: resourceId,
        deletedTime: { not: null },
      },
      select: { id: true },
    });

    if (!tables.length) return;

    const tableIds = tables.map(({ id }) => id);
    await this.tableOpenApiService.permanentDeleteTables(resourceId, tableIds);
  }

  async resetTrashItems(resetTrashItemsRo: IResetTrashItemsRo) {
    const { resourceId, resourceType } = resetTrashItemsRo;

    if (![TrashType.Base, TrashType.Table].includes(resourceType)) {
      throw new CustomHttpException(
        `Invalid resource type ${resourceType}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.trash.invalidResourceType',
          },
        }
      );
    }

    if (resourceType === TrashType.Base) {
      await this.resetBaseTrashResource(resetTrashItemsRo);
    }

    if (resourceType === TrashType.Table) {
      await this.resetTableTrashItems(resourceId);
    }
  }

  private async resetTableTrashItems(tableId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(
      tableId,
      ['table|trash_reset'],
      accessTokenId,
      true
    );

    const deletedList = await this.dataPrismaService.tableTrash.findMany({
      where: { tableId },
      select: { resourceType: true, snapshot: true },
    });
    let deletedViewIds: string[] = [];
    let deletedFieldIds: string[] = [];
    let deletedRecordIds: string[] = [];

    deletedList.forEach(({ resourceType, snapshot }) => {
      const parsedSnapshot = JSON.parse(snapshot);

      if (resourceType === TableTrashType.View) {
        deletedViewIds.push(...parsedSnapshot);
      }

      if (resourceType === TableTrashType.Field) {
        deletedFieldIds.push(...(parsedSnapshot.fields as IFieldVo[]).map(({ id }) => id));
      }

      if (resourceType === TableTrashType.Record) {
        deletedRecordIds.push(...parsedSnapshot);
      }
    });

    deletedViewIds = [...new Set(deletedViewIds)];
    deletedFieldIds = [...new Set(deletedFieldIds)];
    deletedRecordIds = [...new Set(deletedRecordIds)];

    await this.prismaService.$tx(async (prisma) => {
      await prisma.view.deleteMany({
        where: { id: { in: deletedViewIds } },
      });

      await prisma.field.deleteMany({
        where: { id: { in: deletedFieldIds } },
      });

      await prisma.taskReference.deleteMany({
        where: {
          OR: [{ fromFieldId: { in: deletedFieldIds } }, { toFieldId: { in: deletedFieldIds } }],
        },
      });

      await prisma.ops.deleteMany({
        where: {
          collection: tableId,
          docId: { in: [...deletedViewIds, ...deletedFieldIds, ...deletedRecordIds] },
        },
      });
    });

    await this.dataPrismaService.$tx(async (prisma) => {
      await prisma.recordTrash.deleteMany({
        where: { tableId },
      });

      await prisma.tableTrash.deleteMany({
        where: { tableId },
      });
    });
  }

  async delete(trashId: string, ignorePermissionCheck = false): Promise<void> {
    const trash = await this.prismaService.trash
      .findUniqueOrThrow({
        where: { id: trashId },
      })
      .catch(() => {
        throw new CustomHttpException(`The trash ${trashId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.trash.notFound',
          },
        });
      });

    await this.deleteResource(
      {
        ...trash,
        resourceType: trash.resourceType as TrashType,
      },
      ignorePermissionCheck
    );
  }

  async deleteResource(
    trash: {
      resourceType: TrashType;
      resourceId: string;
      parentId?: string | null;
    },
    ignorePermissionCheck = false
  ): Promise<void> {
    const { resourceType, resourceId, parentId } = trash;

    switch (resourceType) {
      case TrashType.Space:
        return this.spaceService.permanentDeleteSpace(resourceId, ignorePermissionCheck);
      case TrashType.Base:
        return this.baseService.permanentDeleteBase(resourceId, ignorePermissionCheck);
      case TrashType.Table: {
        const baseId = parentId ?? '';
        if (!baseId) {
          throw new CustomHttpException(
            'Base ID is required for deleting table resources',
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.trash.parentNotFound',
              },
            }
          );
        }
        if (!ignorePermissionCheck) {
          const accessTokenId = this.cls.get('accessTokenId');
          await this.permissionService.validPermissions(
            baseId,
            ['table|delete'],
            accessTokenId,
            true
          );
        }
        return this.tableOpenApiService.permanentDeleteTables(baseId, [resourceId]);
      }
      default:
        throw new CustomHttpException(
          `Unsupported resource type: ${resourceType}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.trash.invalidResourceType',
            },
          }
        );
    }
  }
}
