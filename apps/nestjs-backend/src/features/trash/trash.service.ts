/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { FieldType, IFieldVo, IRecord } from '@teable/core';
import { HttpErrorCode, IdPrefix, Role } from '@teable/core';
import type { DataPrismaService } from '@teable/db-data-prisma';
import { PrismaService, type Prisma } from '@teable/db-main-prisma';
import type {
  IGetTrashItemRecordsQuery,
  IGetTrashItemRecordsVo,
  IRestoreFieldTrashStreamEvent,
  IResetTrashItemsRo,
  IResourceMapVo,
  ITrashItemRecordVo,
  ITrashItemsRo,
  ITrashItemVo,
  ITrashRo,
  ITrashVo,
  V2Feature,
} from '@teable/openapi';
import { CollaboratorType, ResourceType, TableTrashType, TrashType } from '@teable/openapi';
import {
  DELETED_RECORD_TRASH_MARKER_SNAPSHOT,
  RECORD_REMOVAL_REASON,
  RestoreFieldStreamCommand,
  RestoreRecordsStreamCommand,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  ICommandBus,
  RestoreFieldStreamResult,
  RestoreRecordInput,
  RestoreRecordsStreamResult,
  Table,
  TableQueryService,
} from '@teable/v2-core';
import { Knex } from 'knex';
import { chunk, keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { ICreateFieldsOperation } from '../../cache/types';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { META_KNEX } from '../../global/knex';
import type { IPerformanceCacheStore } from '../../performance-cache';
import { PerformanceCacheService } from '../../performance-cache';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { PermissionService } from '../auth/permission.service';
import { BaseService } from '../base/base.service';
import { CanaryService, type IV2Decision } from '../canary/canary.service';
import type { IFieldInstance } from '../field/model/factory';
import { FieldOpenApiV2Service } from '../field/open-api/field-open-api-v2.service';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { restoreFieldRecordValues } from '../field/restore-field-record-values';
import { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordRestoreService } from '../record/open-api/record-restore.service';
import { RecordService } from '../record/record.service';
import type { IColdRemovalRow } from '../record-removal-cold/part-codec';
import type { IRemovalColdBoundary } from '../record-removal-cold/record-removal-cold-read.service';
import {
  decodeRemovalColdCursor,
  encodeRemovalColdCursor,
  RecordRemovalColdReadService,
} from '../record-removal-cold/record-removal-cold-read.service';
import { RecordRemovalColdStorageService } from '../record-removal-cold/record-removal-cold-storage.service';
import {
  isTombstonedAt,
  RecordRemovalTombstoneService,
} from '../record-removal-cold/record-removal-tombstone.service';
import { SpaceDataDbMigrationGuardService } from '../space/space-data-db-migration-guard.service';
import { SpaceService } from '../space/space.service';
import { TableOpenApiV2Service } from '../table/open-api/table-open-api-v2.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { UserService } from '../user/user.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';
import { ViewService } from '../view/view.service';
import { resolveV2TrashRecordDisplayName } from './v2-trash-record-name';

// A single trash item can reference tens of thousands of resource ids (bulk record deletion),
// while postgres prepared statements accept at most 32767 bind variables per query.
const IN_CHUNK = 5000;

// The list only previews the first few resources of each trash item (name resolution
// included); the full set is paged through the item records endpoint.
const TABLE_TRASH_RESOURCE_PREVIEW_LIMIT = 20;

const TRASH_RECORD_DEFAULT_TAKE = 50;

// Hot-zone scan budget for LEGACY trash items (rows predating the operation_id column):
// the walk filters item membership app-side, so a busy table could make one page scan far
// more rows than it serves — cap the work and hand back a resume cursor instead.
const TRASH_HOT_SCAN_BATCH = 1000;
const TRASH_HOT_MAX_SCANNED = 5000;

// rth1: hot-zone cursor of the trash-item records walk — exclusive (created_time, id)
// resume point in the PG zone. Once a page is served (even partially) from cold parts the
// cursor becomes the cold reader's self-describing `rms1:` form and skips PG entirely.
const TRASH_HOT_CURSOR_PREFIX = 'rth1:';

const encodeTrashHotCursor = (k: Date, id: string): string =>
  TRASH_HOT_CURSOR_PREFIX +
  Buffer.from(JSON.stringify({ k: k.toISOString(), id })).toString('base64url');

const decodeTrashHotCursor = (cursor: string): { k: Date; id: string } | undefined => {
  if (!cursor.startsWith(TRASH_HOT_CURSOR_PREFIX)) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(cursor.slice(TRASH_HOT_CURSOR_PREFIX.length), 'base64url').toString()
    ) as { k: string; id: string };
    const k = new Date(payload.k);
    if (Number.isNaN(k.getTime()) || typeof payload.id !== 'string') return undefined;
    return { k, id: payload.id };
  } catch {
    return undefined;
  }
};

type ITrashRecordHotRow = {
  id: string;
  recordId: string;
  snapshot: string;
  createdTime: Date;
  createdBy: string;
  recordCreatedTime: Date | null;
  recordCreatedBy: string | null;
  recordLastModifiedTime: Date | null;
  recordLastModifiedBy: string | null;
};

const maxDefinedDate = (a?: Date, b?: Date): Date | undefined => {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
};

type IRestoreProgressInput = {
  phase: 'preparing' | 'restoring';
  batchIndex: number;
  totalCount?: number;
  processedCount?: number;
  restoredCount?: number;
  updatedCount?: number;
};

type IRestoreDoneInput = {
  totalCount?: number;
  restoredCount?: number;
  updatedCount?: number;
};

type IRestoreErrorInput = {
  phase: 'preparing' | 'restoring' | 'finalizing';
  message: string;
  batchIndex?: number;
  totalCount?: number;
  processedCount?: number;
  restoredCount?: number;
  updatedCount?: number;
  code?: string;
};

type IRestoreTrashStreamEvent =
  | (IRestoreProgressInput & {
      id: 'progress';
      resourceType: ResourceType;
      totalCount: number;
      processedCount: number;
      restoredCount: number;
      updatedCount: number;
    })
  | {
      id: 'done';
      resourceType: ResourceType;
      totalCount: number;
      restoredCount: number;
      updatedCount: number;
    }
  | (IRestoreErrorInput & {
      id: 'error';
      resourceType: ResourceType;
      batchIndex: number;
      totalCount: number;
      processedCount: number;
      restoredCount: number;
      updatedCount: number;
    });

type ITableTrashDelegate = {
  findMany<TArgs>(args: TArgs): Promise<
    Array<{
      id: string;
      tableId: string;
      resourceType: string;
      snapshot: string;
      createdBy: string;
      createdTime: Date;
    }>
  >;
  findFirst<TArgs>(args: TArgs): Promise<{
    id: string;
    resourceType: string;
    snapshot: string;
    createdTime: Date;
  } | null>;
  findUniqueOrThrow<TArgs>(args: TArgs): Promise<{
    tableId: string;
    resourceType: string;
    snapshot: string;
    createdTime: Date;
  }>;
  delete<TArgs>(args: TArgs): Promise<unknown>;
  deleteMany<TArgs>(args: TArgs): Promise<unknown>;
};

type IRecordTrashDelegate = {
  findMany<TArgs>(args: TArgs): Promise<
    Array<{
      id: string;
      recordId: string;
      snapshot: string;
      createdTime: Date;
      createdBy: string;
      recordCreatedTime: Date | null;
      recordCreatedBy: string | null;
      recordLastModifiedTime: Date | null;
      recordLastModifiedBy: string | null;
    }>
  >;
  deleteMany<TArgs>(args: TArgs): Promise<unknown>;
};

type ITrashDataPrisma = {
  tableTrash: ITableTrashDelegate;
  recordTrash: IRecordTrashDelegate;
};

export type IGetTrashItemsOptions = {
  // Hide table-trash rows created before this instant (plan read window); rows are hidden,
  // never deleted.
  createdTimeAfter?: Date;
};

type IScopedTrashDataPrisma = ITrashDataPrisma & {
  txClient?: () => ITrashDataPrisma;
  $tx?: <T>(
    fn: (prisma: ITrashDataPrisma) => Promise<T>,
    options?: { timeout?: number }
  ) => Promise<T>;
  $transaction?: <T>(
    fn: (prisma: ITrashDataPrisma) => Promise<T>,
    options?: { timeout?: number }
  ) => Promise<T>;
};

@Injectable()
export class TrashService {
  constructor(
    protected readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    protected readonly prismaService: PrismaService,
    protected readonly cls: ClsService<IClsStore>,
    protected readonly userService: UserService,
    protected readonly permissionService: PermissionService,
    protected readonly spaceService: SpaceService,
    protected readonly baseService: BaseService,
    protected readonly tableOpenApiService: TableOpenApiService,
    protected readonly tableOpenApiV2Service: TableOpenApiV2Service,
    protected readonly fieldOpenApiService: FieldOpenApiService,
    protected readonly fieldOpenApiV2Service: FieldOpenApiV2Service,
    protected readonly recordOpenApiService: RecordOpenApiService,
    protected readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    protected readonly recordRestoreService: RecordRestoreService,
    protected readonly recordService: RecordService,
    protected readonly viewService: ViewService,
    protected readonly v2ContainerService: V2ContainerService,
    protected readonly v2ExecutionContextFactory: V2ExecutionContextFactory,
    protected readonly canaryService: CanaryService,
    protected readonly dataDbClientManager: DataDbClientManager,
    protected readonly recordRemovalTombstoneService: RecordRemovalTombstoneService,
    protected readonly recordRemovalColdStorageService: RecordRemovalColdStorageService,
    protected readonly recordRemovalColdReadService: RecordRemovalColdReadService,
    @ThresholdConfig() protected readonly thresholdConfig: IThresholdConfig,
    @InjectModel(META_KNEX) protected readonly knex: Knex,
    @Optional()
    protected readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService
  ) {}

  private async assertSpaceWritable(spaceId: string) {
    await this.spaceDataDbMigrationGuard?.assertSpaceWritable(spaceId);
  }

  private async assertBaseWritable(baseId: string) {
    await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);
  }

  private async assertTableWritable(tableId: string) {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
  }

  private async assertTrashResourceWritable(
    resourceType: TrashType,
    resourceId: string,
    parentId?: string | null
  ) {
    switch (resourceType) {
      case TrashType.Space:
        return await this.assertSpaceWritable(resourceId);
      case TrashType.Base:
        return await this.assertBaseWritable(resourceId);
      case TrashType.Table:
        return parentId
          ? await this.assertBaseWritable(parentId)
          : await this.assertTableWritable(resourceId);
    }
  }

  private getTrashDataPrismaExecutor(prisma: IScopedTrashDataPrisma): ITrashDataPrisma {
    return prisma.txClient?.() ?? prisma;
  }

  private async trashDataPrismaForTable(tableId: string): Promise<IScopedTrashDataPrisma> {
    return (await this.dataDbClientManager.dataPrismaForTable(tableId, {
      useTransaction: true,
    })) as IScopedTrashDataPrisma;
  }

  // Full-typed executor for the tombstone service (the narrow ITrashDataPrisma
  // view has no recordRemovalTombstone delegate); the tombstone table lives in
  // the same data db as record_trash.
  private async trashTombstoneClientForTable(tableId: string): Promise<DataPrismaService> {
    const prisma = (await this.dataDbClientManager.dataPrismaForTable(tableId, {
      useTransaction: true,
    })) as DataPrismaService;
    return (prisma.txClient?.() ?? prisma) as DataPrismaService;
  }

  private async trashDataPrismaTransactionForTable<T>(
    tableId: string,
    fn: (prisma: ITrashDataPrisma) => Promise<T>
  ): Promise<T> {
    const prisma = await this.trashDataPrismaForTable(tableId);

    if (prisma.$tx) {
      return await prisma.$tx(fn, {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      });
    }

    if (prisma.$transaction) {
      return await prisma.$transaction(fn, {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      });
    }

    return await fn(this.getTrashDataPrismaExecutor(prisma));
  }

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
      select: { id: true, name: true, avatar: true },
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
      const { name, avatar } = spaceIdMap[resourceId];
      resourceMap[resourceId] = {
        id: resourceId,
        name,
        avatar: avatar ? getPublicFullStorageUrl(avatar) : null,
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

  async getTrashItems(
    trashItemsRo: ITrashItemsRo,
    options?: IGetTrashItemsOptions
  ): Promise<ITrashVo> {
    const { resourceType } = trashItemsRo;

    switch (resourceType) {
      case TrashType.Base:
        return await this.getBaseTrashItems(trashItemsRo);
      case TrashType.Table:
        return await this.getTableTrashItems(trashItemsRo, options);
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
      const container = await this.v2ContainerService.getContainerForTable(tableId);
      const tableQueryService = container.resolve<TableQueryService>(
        v2CoreTokens.tableQueryService
      );
      const queryContext = await this.v2ExecutionContextFactory.createContext(container);
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
      if (snapshot === DELETED_RECORD_TRASH_MARKER_SNAPSHOT) {
        continue;
      }

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
        const views = (
          await Promise.all(
            chunk(resourceIds, IN_CHUNK).map((ids) =>
              this.prismaService.view.findMany({
                where: { id: { in: ids }, deletedTime: { not: null } },
                select: {
                  id: true,
                  name: true,
                  type: true,
                },
              })
            )
          )
        ).flat();
        return keyBy(views, 'id');
      }
      case TableTrashType.Field: {
        const fields = (
          await Promise.all(
            chunk(resourceIds, IN_CHUNK).map((ids) =>
              this.prismaService.field.findMany({
                where: { id: { in: ids }, deletedTime: { not: null } },
                select: {
                  id: true,
                  name: true,
                  type: true,
                  options: true,
                  isLookup: true,
                  isConditionalLookup: true,
                },
              })
            )
          )
        ).flat();
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
        const dataPrisma = this.getTrashDataPrismaExecutor(
          await this.trashDataPrismaForTable(tableId)
        );
        const recordList = (
          await Promise.all(
            chunk(resourceIds, IN_CHUNK).map((ids) =>
              dataPrisma.recordTrash.findMany({
                where: { tableId, recordId: { in: ids }, reason: RECORD_REMOVAL_REASON.Deleted },
                select: {
                  recordId: true,
                  snapshot: true,
                },
              })
            )
          )
        ).flat();

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

  async getTableTrashItems(
    trashItemsRo: ITrashItemsRo,
    options?: IGetTrashItemsOptions
  ): Promise<ITrashVo> {
    const {
      resourceId: tableId,
      cursor,
      pageSize = 20,
      resourceTypes,
      deletedBy,
      deletedTimeStart,
      deletedTimeEnd,
    } = trashItemsRo;
    const accessTokenId = this.cls.get('accessTokenId');
    let nextCursor: typeof cursor | undefined = undefined;

    await this.permissionService.validPermissions(
      tableId,
      ['table|trash_read'],
      accessTokenId,
      true
    );

    // Plan read window (EE) and the user's deleted-time filter combine to the later bound;
    // rows outside the window stay stored but are hidden from the list.
    const createdTimeGte = maxDefinedDate(
      options?.createdTimeAfter,
      deletedTimeStart ? new Date(deletedTimeStart) : undefined
    );
    const createdTimeLte = deletedTimeEnd ? new Date(deletedTimeEnd) : undefined;

    const dataPrisma = this.getTrashDataPrismaExecutor(await this.trashDataPrismaForTable(tableId));
    const list = await dataPrisma.tableTrash.findMany({
      where: {
        tableId,
        ...(resourceTypes?.length ? { resourceType: { in: resourceTypes } } : {}),
        ...(deletedBy?.length ? { createdBy: { in: deletedBy } } : {}),
        ...(createdTimeGte || createdTimeLte
          ? {
              createdTime: {
                ...(createdTimeGte ? { gte: createdTimeGte } : {}),
                ...(createdTimeLte ? { lte: createdTimeLte } : {}),
              },
            }
          : {}),
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

      const resourceIds: string[] =
        resourceType === TableTrashType.Field
          ? (parsedSnapshot.fields as IFieldVo[]).map(({ id }) => id)
          : parsedSnapshot;
      const previewResourceIds = resourceIds.slice(0, TABLE_TRASH_RESOURCE_PREVIEW_LIMIT);
      deletedResourceMap[resourceType].push(...previewResourceIds);
      deletedBySet.add(createdBy);

      return {
        id,
        resourceType: resourceType,
        deletedTime: createdTime.toISOString(),
        deletedBy: createdBy,
        resourceIds: previewResourceIds,
        totalResourceCount: resourceIds.length,
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
    // Delete commits a table_trash index before recycle-bin JSON lands. Hide the
    // item until every preview id has a real snapshot so list/restore cannot race
    // the async projection.
    const readyTrashItems = trashItems.filter((item) => {
      if (item.resourceType !== TableTrashType.Record) {
        return true;
      }
      return item.resourceIds.every((resourceId) => resourceMap[resourceId] != null);
    });

    return {
      trashItems: readyTrashItems,
      resourceMap,
      userMap: keyBy(userList, 'id'),
      nextCursor,
    };
  }

  async getTableTrashItemRecords(
    trashId: string,
    query: IGetTrashItemRecordsQuery,
    options?: IGetTrashItemsOptions
  ): Promise<IGetTrashItemRecordsVo> {
    const { tableId, cursor, take = TRASH_RECORD_DEFAULT_TAKE } = query;
    const accessTokenId = this.cls.get('accessTokenId');

    await this.permissionService.validPermissions(
      tableId,
      ['table|trash_read'],
      accessTokenId,
      true
    );

    const dataPrisma = this.getTrashDataPrismaExecutor(await this.trashDataPrismaForTable(tableId));
    const [trashItem, fieldInstances] = await Promise.all([
      this.loadRecordTrashItem(dataPrisma, trashId, tableId, options),
      this.recordService.getFieldsByProjection(tableId),
    ]);

    const recordIds = JSON.parse(trashItem.snapshot) as string[];
    const idSet = new Set(recordIds);

    // Dual-zone cursor, mirroring the archive list merge: while pages come from PG the
    // cursor is the rth1: keyset form; once a page is served (even partially) from cold
    // parts it becomes the cold reader's rms1: cursor, which skips PG entirely.
    const coldCursor = cursor ? decodeRemovalColdCursor(cursor) : undefined;
    const hotCursor = cursor && !coldCursor ? decodeTrashHotCursor(cursor) : undefined;
    if (cursor && !coldCursor && !hotCursor) {
      throw new CustomHttpException('Invalid trash records cursor', HttpErrorCode.VALIDATION_ERROR);
    }

    let hotRows: ITrashRecordHotRow[] = [];
    let nextCursor: string | null = null;
    let boundary: IRemovalColdBoundary | undefined = coldCursor?.boundary;
    let fillFromCold = Boolean(coldCursor);
    if (!coldCursor) {
      const hot = await this.collectHotTrashItemRecords({
        dataPrisma,
        trashId,
        tableId,
        itemCreatedTime: trashItem.createdTime,
        idSet,
        query,
        take,
        hotCursor,
      });
      hotRows = hot.rows;
      if (hot.nextCursor) {
        nextCursor = hot.nextCursor;
      } else {
        fillFromCold = true;
        boundary = hot.boundary;
      }
    }

    let coldRows: IColdRemovalRow[] = [];
    if (fillFromCold) {
      ({ coldRows, nextCursor } = await this.fillTrashItemColdPage({
        tableId,
        idSet,
        itemCreatedTime: trashItem.createdTime,
        query,
        pageSize: take,
        hotRows,
        boundary,
      }));
    }

    const items = hotRows.map((row) => this.buildTrashItemRecordVo(row, fieldInstances));
    // cold rows are already predicate-filtered and ordered after the PG zone; their
    // time dims are the flusher's canonical ISO strings
    for (const row of coldRows) {
      items.push({
        id: row.id,
        recordId: row.recordId,
        record: this.normalizeTrashRecordSnapshot(
          fieldInstances,
          JSON.parse(row.snapshot) as IRecord
        ),
        deletedTime: row.removedTime,
        deletedBy: row.removedBy,
        recordCreatedTime: row.recordCreatedTime ?? null,
        recordCreatedBy: row.recordCreatedBy ?? null,
        recordLastModifiedTime: row.recordLastModifiedTime ?? null,
        recordLastModifiedBy: row.recordLastModifiedBy ?? null,
      });
    }

    const userList = await this.userService.getUserInfoList(
      Array.from(this.collectTrashRecordUserIds(items))
    );

    return {
      items,
      userMap: keyBy(userList, 'id'),
      nextCursor,
    };
  }

  // Hot (PG) zone of one trash-item records page, keyset-ordered by
  // (created_time DESC, id DESC). Items whose rows carry operation_id read straight off
  // the operation-scoped partial index; LEGACY items (rows predating the column) walk the
  // table's deleted timeline and filter item membership app-side under a scan budget.
  // Latest-wins per record id holds within one request via `servedRecordIds`; a duplicate
  // pair split across pages can only exist in the transient window between a restore and
  // its row cleanup — the same accepted edge the pre-merge implementation carried.
  private async collectHotTrashItemRecords(params: {
    dataPrisma: ITrashDataPrisma;
    trashId: string;
    tableId: string;
    itemCreatedTime: Date;
    idSet: Set<string>;
    query: IGetTrashItemRecordsQuery;
    take: number;
    hotCursor?: { k: Date; id: string };
  }): Promise<{
    rows: ITrashRecordHotRow[];
    nextCursor: string | null;
    boundary?: IRemovalColdBoundary;
  }> {
    const { dataPrisma, trashId, tableId, itemCreatedTime, idSet, query, take } = params;
    const probe = await dataPrisma.recordTrash.findMany({
      where: { tableId, operationId: trashId, reason: RECORD_REMOVAL_REASON.Deleted },
      select: { id: true },
      take: 1,
    });
    const usesOperationId = probe.length > 0;
    const filters = this.buildTrashRecordSnapshotFilters(query);

    const rows: ITrashRecordHotRow[] = [];
    const servedRecordIds = new Set<string>();
    let position = params.hotCursor;
    let scanned = 0;
    let exhausted = false;

    while (rows.length <= take && !exhausted && scanned < TRASH_HOT_MAX_SCANNED) {
      const batchTake = usesOperationId ? take + 1 - rows.length : TRASH_HOT_SCAN_BATCH;
      const batch = (await dataPrisma.recordTrash.findMany({
        where: {
          tableId,
          reason: RECORD_REMOVAL_REASON.Deleted,
          ...(usesOperationId ? { operationId: trashId } : {}),
          ...filters,
          ...this.buildHotTrashKeysetWhere(itemCreatedTime, position),
        },
        select: {
          id: true,
          recordId: true,
          snapshot: true,
          createdTime: true,
          createdBy: true,
          recordCreatedTime: true,
          recordCreatedBy: true,
          recordLastModifiedTime: true,
          recordLastModifiedBy: true,
        },
        orderBy: [{ createdTime: 'desc' }, { id: 'desc' }],
        take: batchTake,
      })) as ITrashRecordHotRow[];

      scanned += batch.length;
      this.collectHotTrashBatch({ batch, take, idSet, servedRecordIds, rows });
      if (batch.length < batchTake) {
        exhausted = true;
      } else {
        const last = batch[batch.length - 1];
        position = { k: last.createdTime, id: last.id };
      }
    }

    return this.resolveHotTrashPageOutcome({
      rows,
      take,
      exhausted,
      position,
      hotCursor: params.hotCursor,
    });
  }

  // Keyset predicate of the hot walk: an exclusive (created_time, id) resume point, or —
  // from the top — only snapshots that belong to this trash item, not rows written by a
  // later delete of the same record ids.
  private buildHotTrashKeysetWhere(itemCreatedTime: Date, position?: { k: Date; id: string }) {
    return position
      ? {
          OR: [
            { createdTime: { lt: position.k } },
            { createdTime: position.k, id: { lt: position.id } },
          ],
        }
      : { createdTime: { lte: itemCreatedTime } };
  }

  private collectHotTrashBatch(params: {
    batch: ITrashRecordHotRow[];
    take: number;
    idSet: Set<string>;
    servedRecordIds: Set<string>;
    rows: ITrashRecordHotRow[];
  }): void {
    const { batch, take, idSet, servedRecordIds, rows } = params;
    for (const row of batch) {
      if (rows.length > take) return;
      if (!idSet.has(row.recordId) || servedRecordIds.has(row.recordId)) continue;
      servedRecordIds.add(row.recordId);
      rows.push(row);
    }
  }

  private resolveHotTrashPageOutcome(params: {
    rows: ITrashRecordHotRow[];
    take: number;
    exhausted: boolean;
    position?: { k: Date; id: string };
    hotCursor?: { k: Date; id: string };
  }): { rows: ITrashRecordHotRow[]; nextCursor: string | null; boundary?: IRemovalColdBoundary } {
    const { rows, take, exhausted, position, hotCursor } = params;
    if (rows.length > take) {
      rows.pop();
      const last = rows[rows.length - 1];
      return { rows, nextCursor: encodeTrashHotCursor(last.createdTime, last.id) };
    }
    if (!exhausted) {
      // scan budget hit before the page filled: a partial page with a resume point at
      // the last scanned row — every request makes progress
      return {
        rows,
        nextCursor: position ? encodeTrashHotCursor(position.k, position.id) : null,
      };
    }
    // hot zone exhausted: cold continues strictly after the last served row (or the
    // incoming resume point when this request served nothing)
    const lastServed = rows[rows.length - 1];
    const boundary = lastServed
      ? { k: lastServed.createdTime.toISOString(), id: lastServed.id }
      : hotCursor
        ? { k: hotCursor.k.toISOString(), id: hotCursor.id }
        : undefined;
    return { rows, nextCursor: null, boundary };
  }

  // Cold continuation of one trash-item records page: shortfall fill from the deleted/
  // parts (or the seam cursor when PG filled the page exactly) plus the S3 degradation
  // rule, mirroring the archive list merge.
  private async fillTrashItemColdPage(params: {
    tableId: string;
    idSet: Set<string>;
    itemCreatedTime: Date;
    query: IGetTrashItemRecordsQuery;
    pageSize: number;
    hotRows: ITrashRecordHotRow[];
    boundary?: IRemovalColdBoundary;
  }): Promise<{ coldRows: IColdRemovalRow[]; nextCursor: string | null }> {
    const { tableId, idSet, itemCreatedTime, query, pageSize, hotRows, boundary } = params;
    const shortfall = pageSize - hotRows.length;
    // seeded with the hot page ids: rows already sunk to parts but not yet deleted from
    // the buffer exist in both stores and must not be served twice
    const seenIds = new Set(hotRows.map((row) => row.id));
    try {
      if (shortfall <= 0) {
        // hot rows filled the page exactly: hand out a seam cursor instead of probing S3
        // now — the next request serves the (possibly empty) cold tail
        return { coldRows: [], nextCursor: encodeRemovalColdCursor(boundary) };
      }
      const tombstoneClient = await this.trashTombstoneClientForTable(tableId);
      const tombstones = await this.recordRemovalTombstoneService.loadTombstonedRecordIds(
        tombstoneClient,
        tableId
      );
      const cold = await this.recordRemovalColdReadService.collectArchivedRows({
        tableId,
        reason: RECORD_REMOVAL_REASON.Deleted,
        limit: shortfall,
        orderBy: 'removedTime',
        direction: 'desc',
        boundary,
        filters: {
          // rows of this item share the item's delete instant; later re-deletes of the
          // same record ids carry newer removedTimes and stay out
          removedTimeEnd: itemCreatedTime.toISOString(),
          recordCreatedBys: query.recordCreatedBy,
          recordCreatedTimeStart: query.recordCreatedTimeStart,
          recordCreatedTimeEnd: query.recordCreatedTimeEnd,
        },
        // item membership: rows of other delete operations in the same month do not
        // count toward the page
        rowPredicate: (row) => idSet.has(row.recordId),
        isTombstoned: (recordId, removedTime) => isTombstonedAt(tombstones, recordId, removedTime),
        seenIds,
      });
      return { coldRows: cold.rows, nextCursor: cold.nextCursor };
    } catch (error) {
      // an S3 outage/timeout must not take the hot rows down with it: degrade to the hot
      // rows plus a retryable cold cursor pinned at the boundary. Only an entirely empty
      // response propagates the failure, mirroring the archive merge.
      if (!(error instanceof ServiceUnavailableException) || hotRows.length === 0) {
        throw error;
      }
      return { coldRows: [], nextCursor: encodeRemovalColdCursor(boundary) };
    }
  }

  // Cold fallback for a trash-item restore: ids with no PG snapshot row may have sunk
  // past the flush horizon. Latest cold row per id, tombstone-filtered, and bounded to
  // rows belonging to THIS item (removedTime <= the item's delete instant) — a record
  // individually restored and re-deleted later owns a newer cold row that must stay
  // untouched. The read service throws ServiceUnavailable past its S3 budget and that
  // propagates deliberately: restore stays all-or-nothing per request (a partial scan
  // could restore a stale snapshot); retries progress through the part byte cache.
  private async lookupColdTrashRows(
    tableId: string,
    recordIds: string[],
    itemCreatedTime: Date
  ): Promise<IColdRemovalRow[]> {
    const client = await this.trashTombstoneClientForTable(tableId);
    const tombstones = await this.recordRemovalTombstoneService.loadTombstonedRecordIds(
      client,
      tableId
    );
    const found = await this.recordRemovalColdReadService.lookupArchivedRowsByRecordIds({
      tableId,
      reason: RECORD_REMOVAL_REASON.Deleted,
      recordIds,
      isTombstoned: (recordId, removedTime) => isTombstonedAt(tombstones, recordId, removedTime),
    });
    const itemTimeIso = itemCreatedTime.toISOString();
    return [...found.values()].filter((row) => row.removedTime <= itemTimeIso);
  }

  private buildTrashRecordSnapshotFilters(query: IGetTrashItemRecordsQuery) {
    const { recordCreatedBy, recordCreatedTimeStart, recordCreatedTimeEnd } = query;
    return {
      ...(recordCreatedBy?.length ? { recordCreatedBy: { in: recordCreatedBy } } : {}),
      ...(recordCreatedTimeStart || recordCreatedTimeEnd
        ? {
            recordCreatedTime: {
              ...(recordCreatedTimeStart ? { gte: new Date(recordCreatedTimeStart) } : {}),
              ...(recordCreatedTimeEnd ? { lte: new Date(recordCreatedTimeEnd) } : {}),
            },
          }
        : {}),
    };
  }

  private async loadRecordTrashItem(
    dataPrisma: ITrashDataPrisma,
    trashId: string,
    tableId: string,
    options?: IGetTrashItemsOptions
  ) {
    const trashItem = await dataPrisma.tableTrash.findFirst({
      where: {
        id: trashId,
        tableId,
        // Plan read window (EE): items hidden from the list are hidden from the detail too.
        ...(options?.createdTimeAfter ? { createdTime: { gte: options.createdTimeAfter } } : {}),
      },
      select: {
        id: true,
        resourceType: true,
        snapshot: true,
        createdTime: true,
      },
    });

    if (!trashItem) {
      throw new CustomHttpException(
        `The table trash ${trashId} not found`,
        HttpErrorCode.NOT_FOUND,
        {
          localization: {
            i18nKey: 'httpErrors.trash.tableNotFound',
          },
        }
      );
    }

    if (trashItem.resourceType !== TableTrashType.Record) {
      throw new CustomHttpException(
        `Invalid resource type ${trashItem.resourceType}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.trash.invalidResourceType',
          },
        }
      );
    }

    return trashItem;
  }

  private buildTrashItemRecordVo(
    row: ITrashRecordHotRow,
    fieldInstances: IFieldInstance[]
  ): ITrashItemRecordVo {
    return {
      id: row.id,
      recordId: row.recordId,
      record: this.normalizeTrashRecordSnapshot(
        fieldInstances,
        JSON.parse(row.snapshot) as IRecord
      ),
      deletedTime: row.createdTime.toISOString(),
      deletedBy: row.createdBy,
      recordCreatedTime: row.recordCreatedTime?.toISOString() ?? null,
      recordCreatedBy: row.recordCreatedBy ?? null,
      recordLastModifiedTime: row.recordLastModifiedTime?.toISOString() ?? null,
      recordLastModifiedBy: row.recordLastModifiedBy ?? null,
    };
  }

  private collectTrashRecordUserIds(items: ITrashItemRecordVo[]): Set<string> {
    const userIds = new Set<string>();
    for (const item of items) {
      userIds.add(item.deletedBy);
      if (item.recordCreatedBy) {
        userIds.add(item.recordCreatedBy);
      }
      if (item.recordLastModifiedBy) {
        userIds.add(item.recordLastModifiedBy);
      }
    }
    return userIds;
  }

  // Deletion snapshots differ by engine: v1 stores normalized cell values while v2 stores
  // raw db column values. convertDBValue2CellValue is idempotent on normalized values, so
  // it is applied unconditionally; a field that fails to convert keeps its snapshot value.
  private normalizeTrashRecordSnapshot(fieldInstances: IFieldInstance[], record: IRecord): IRecord {
    const fields: IRecord['fields'] = { ...record.fields };
    for (const field of fieldInstances) {
      if (!(field.id in fields)) {
        continue;
      }
      try {
        fields[field.id] = field.convertDBValue2CellValue(fields[field.id] as never);
      } catch {
        // Keep the snapshot value; the client tolerates unknown shapes.
      }
    }
    return { ...record, fields };
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

  async getRestoreTableResourceV2Decision(
    trashId: string,
    routedTableId?: string
  ): Promise<
    | (IV2Decision & {
        tableId: string;
        resourceType: TableTrashType;
        feature: V2Feature;
      })
    | undefined
  > {
    if (!trashId.startsWith(IdPrefix.Operation) || !routedTableId) {
      return undefined;
    }

    const lookupDataPrisma = this.getTrashDataPrismaExecutor(
      await this.trashDataPrismaForTable(routedTableId)
    );
    const tableTrash = await lookupDataPrisma.tableTrash
      .findUniqueOrThrow({
        where: { id: trashId },
        select: {
          tableId: true,
          resourceType: true,
        },
      })
      .catch(() => undefined);

    if (!tableTrash) {
      return undefined;
    }

    const feature = this.getRestoreTableResourceV2Feature(
      tableTrash.resourceType as TableTrashType
    );
    if (!feature) {
      return undefined;
    }

    const table = await this.prismaService.txClient().tableMeta.findFirst({
      where: { id: tableTrash.tableId, deletedTime: null },
      select: {
        base: {
          select: {
            spaceId: true,
            v2Enabled: true,
          },
        },
      },
    });

    if (!table?.base?.spaceId) {
      return {
        useV2: false,
        reason: 'disabled',
        tableId: tableTrash.tableId,
        resourceType: tableTrash.resourceType as TableTrashType,
        feature,
      };
    }

    const decision = await this.canaryService.shouldUseV2ForBaseWithReason(table.base, feature);
    return {
      ...decision,
      tableId: tableTrash.tableId,
      resourceType: tableTrash.resourceType as TableTrashType,
      feature,
    };
  }

  private getRestoreTableResourceV2Feature(resourceType: TableTrashType): V2Feature | undefined {
    switch (resourceType) {
      case TableTrashType.Field:
        return 'createField';
      case TableTrashType.Record:
        return 'createRecord';
      default:
        return undefined;
    }
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

    await this.assertBaseWritable(decision.baseId);
    await this.assertParentNotTrashed(decision.baseId);
    await this.restoreTableV2(decision.baseId, decision.tableId);
  }

  private async restoreTableV2(baseId: string, tableId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(tableId, ['table|create'], accessTokenId, true);
    await this.tableOpenApiV2Service.restoreTable(baseId, tableId);
    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
  }

  async restoreTableResourceV2(trashId: string, routedTableId?: string) {
    const decision = await this.getRestoreTableResourceV2Decision(trashId, routedTableId);
    if (!decision?.useV2) {
      return await this.restoreTableResource(trashId, routedTableId);
    }

    switch (decision.resourceType) {
      case TableTrashType.Field:
        return await this.restoreFieldTableResourceV2(trashId, routedTableId);
      case TableTrashType.Record:
        for await (const event of await this.restoreRecordTableResourceV2Stream(
          trashId,
          routedTableId
        )) {
          if (event.id === 'error') {
            throw new CustomHttpException(event.message, HttpErrorCode.INTERNAL_SERVER_ERROR);
          }
        }
        return;
      default:
        throw new CustomHttpException(
          `Invalid resource type ${decision.resourceType}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.trash.invalidResourceType',
            },
          }
        );
    }
  }

  private async restoreFieldTableResourceV2(trashId: string, routedTableId?: string) {
    for await (const event of this.restoreFieldTableResourceV2Stream(trashId, routedTableId)) {
      if (event.id === 'error') {
        throw new CustomHttpException(event.message, HttpErrorCode.INTERNAL_SERVER_ERROR);
      }
    }
  }

  async *restoreFieldTableResourceV2Stream(
    trashId: string,
    routedTableId?: string
  ): AsyncGenerator<IRestoreFieldTrashStreamEvent> {
    if (!routedTableId) {
      yield {
        id: 'error',
        phase: 'preparing',
        batchIndex: -1,
        totalCount: 0,
        processedCount: 0,
        updatedCount: 0,
        message: `Table id is required to restore table trash ${trashId}`,
      };
      return;
    }

    const container = await this.v2ContainerService.getContainerForTable(routedTableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ExecutionContextFactory.createContext(container);
    const commandResult = RestoreFieldStreamCommand.create({
      tableId: routedTableId,
      trashId,
    });
    if (commandResult.isErr()) {
      yield {
        id: 'error',
        phase: 'preparing',
        batchIndex: -1,
        totalCount: 0,
        processedCount: 0,
        updatedCount: 0,
        message: commandResult.error.message,
        code: commandResult.error.code,
      };
      return;
    }

    const result = await commandBus.execute<RestoreFieldStreamCommand, RestoreFieldStreamResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      yield {
        id: 'error',
        phase: 'restoring',
        batchIndex: -1,
        totalCount: 0,
        processedCount: 0,
        updatedCount: 0,
        message: result.error.message,
        code: result.error.code,
      };
      return;
    }

    for await (const event of result.value) {
      yield event;
    }
  }

  private async *restoreRecordTableResourceV2Stream(
    trashId: string,
    routedTableId?: string
  ): AsyncGenerator<IRestoreTrashStreamEvent> {
    const accessTokenId = this.cls.get('accessTokenId');
    if (!routedTableId) {
      yield this.createRestoreErrorEvent(ResourceType.Record, {
        phase: 'preparing',
        message: `Table id is required to restore table trash ${trashId}`,
      });
      return;
    }

    await this.assertTableWritable(routedTableId);
    const lookupDataPrisma = this.getTrashDataPrismaExecutor(
      await this.trashDataPrismaForTable(routedTableId)
    );
    const {
      tableId,
      resourceType,
      snapshot: originSnapshot,
      createdTime,
    } = await lookupDataPrisma.tableTrash
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
    if (tableId !== routedTableId) {
      await this.assertTableWritable(tableId);
    }

    if (resourceType !== TableTrashType.Record) {
      yield this.createRestoreErrorEvent(ResourceType.Record, {
        phase: 'preparing',
        message: `Invalid resource type ${resourceType}`,
      });
      return;
    }

    await this.permissionService.validPermissions(
      tableId,
      ['table|trash_update'],
      accessTokenId,
      true
    );

    const recordIds = JSON.parse(originSnapshot) as string[];
    const recordTrashRows = (
      await Promise.all(
        chunk(recordIds, IN_CHUNK).map((ids) =>
          lookupDataPrisma.recordTrash.findMany({
            where: { tableId, recordId: { in: ids }, reason: RECORD_REMOVAL_REASON.Deleted },
            select: {
              id: true,
              recordId: true,
              snapshot: true,
              createdTime: true,
            },
            orderBy: [{ recordId: 'asc' }, { createdTime: 'desc' }, { id: 'desc' }],
          })
        )
      )
    ).flat();
    const { matched: matchedRecordTrashRows, missingIds } = this.pickHotRecordTrashRowsForRestore(
      recordIds,
      recordTrashRows,
      createdTime
    );
    // Cold fallback: ids with no PG snapshot row may have sunk past the flush horizon.
    const coldTrashRows = missingIds.length
      ? await this.lookupColdTrashRows(tableId, missingIds, createdTime)
      : [];
    const readyRows = [...matchedRecordTrashRows, ...coldTrashRows].filter(({ snapshot }) =>
      this.isReadyRecordTrashSnapshot(snapshot)
    );
    if (recordIds.length > 0 && readyRows.length === 0) {
      yield this.createRestoreErrorEvent(ResourceType.Record, {
        phase: 'preparing',
        message: `The trash ${trashId} snapshots are not ready`,
      });
      return;
    }
    const records = readyRows.map(({ snapshot }) =>
      this.recordRestoreService.toV2RestoreRecord(JSON.parse(snapshot))
    );

    yield this.createRestoreProgressEvent(ResourceType.Record, {
      phase: 'preparing',
      batchIndex: -1,
      totalCount: records.length,
    });

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ExecutionContextFactory.createContext(container);
    const commandResult = RestoreRecordsStreamCommand.create({
      tableId,
      records: this.createRestoreRecordInputStream(records),
    });
    if (commandResult.isErr()) {
      yield this.createRestoreErrorEvent(ResourceType.Record, {
        phase: 'preparing',
        message: commandResult.error.message,
        code: commandResult.error.code,
      });
      return;
    }

    const result = await commandBus.execute<
      RestoreRecordsStreamCommand,
      RestoreRecordsStreamResult
    >(context, commandResult.value);
    if (result.isErr()) {
      yield this.createRestoreErrorEvent(ResourceType.Record, {
        phase: 'restoring',
        message: result.error.message,
        code: result.error.code,
      });
      return;
    }

    let restoredCount = 0;
    for await (const event of result.value) {
      if (event.id === 'progress') {
        restoredCount = event.totalInserted;
        yield this.createRestoreProgressEvent(ResourceType.Record, {
          phase: 'restoring',
          batchIndex: event.batchIndex,
          totalCount: records.length,
          processedCount: event.totalInserted,
          restoredCount: event.totalInserted,
        });
      }
      if (event.id === 'error') {
        yield this.createRestoreErrorEvent(ResourceType.Record, {
          phase: event.phase,
          batchIndex: event.batchIndex,
          totalCount: records.length,
          processedCount: event.totalInserted,
          restoredCount: event.totalInserted,
          message: event.message,
          code: event.code,
        });
        return;
      }
      if (event.id === 'done') {
        restoredCount = event.restoredCount;
      }
    }

    await this.trashDataPrismaTransactionForTable(tableId, async (prisma) => {
      await prisma.recordTrash.deleteMany({
        where: { id: { in: matchedRecordTrashRows.map(({ id }) => id) } },
      });
      await prisma.tableTrash.delete({
        where: { id: trashId },
      });
    });

    // Cold-copy suppression: a trash row already uploaded to a cold part (flush
    // overlap window) outlives the deleteMany above and would resurface in merged
    // reads once the buffer drains; cold-fetched rows have no PG row at all and rely
    // on the marker alone. Marked only after the restore succeeded, matching the
    // archive restore ordering.
    await this.recordRemovalTombstoneService.markRestored(
      await this.trashTombstoneClientForTable(tableId),
      tableId,
      [...matchedRecordTrashRows, ...coldTrashRows].map(({ recordId }) => recordId)
    );

    yield this.createRestoreDoneEvent(ResourceType.Record, {
      totalCount: records.length,
      restoredCount,
    });
  }

  private createRestoreRecordInputStream(
    records: ReadonlyArray<RestoreRecordInput>
  ): AsyncIterable<RestoreRecordInput> {
    return (async function* () {
      for (const record of records) {
        yield record;
      }
    })();
  }

  private createRestoreProgressEvent(
    resourceType: ResourceType,
    event: IRestoreProgressInput
  ): IRestoreTrashStreamEvent {
    return {
      id: 'progress',
      phase: event.phase,
      resourceType,
      batchIndex: event.batchIndex,
      totalCount: event.totalCount ?? 0,
      processedCount: event.processedCount ?? 0,
      restoredCount: event.restoredCount ?? 0,
      updatedCount: event.updatedCount ?? 0,
    };
  }

  private createRestoreDoneEvent(
    resourceType: ResourceType,
    event: IRestoreDoneInput = {}
  ): IRestoreTrashStreamEvent {
    return {
      id: 'done',
      resourceType,
      totalCount: event.totalCount ?? 0,
      restoredCount: event.restoredCount ?? 0,
      updatedCount: event.updatedCount ?? 0,
    };
  }

  private createRestoreErrorEvent(
    resourceType: ResourceType,
    event: IRestoreErrorInput
  ): IRestoreTrashStreamEvent {
    return {
      id: 'error',
      phase: event.phase,
      resourceType,
      batchIndex: event.batchIndex ?? -1,
      totalCount: event.totalCount ?? 0,
      processedCount: event.processedCount ?? 0,
      restoredCount: event.restoredCount ?? 0,
      updatedCount: event.updatedCount ?? 0,
      message: event.message,
      ...(event.code ? { code: event.code } : {}),
    };
  }

  private isReadyRecordTrashSnapshot(snapshot: string): boolean {
    return snapshot !== DELETED_RECORD_TRASH_MARKER_SNAPSHOT;
  }

  private pickHotRecordTrashRowsForRestore<
    T extends { recordId: string; createdTime: Date; snapshot: string },
  >(
    recordIds: readonly string[],
    recordTrashRows: readonly T[],
    trashCreatedTime: Date
  ): { matched: T[]; missingIds: string[] } {
    const latestAtOrBefore = new Map<string, T>();
    const latestAnyReady = new Map<string, T>();
    for (const row of recordTrashRows) {
      if (!latestAnyReady.has(row.recordId) && this.isReadyRecordTrashSnapshot(row.snapshot)) {
        latestAnyReady.set(row.recordId, row);
      }
      if (
        row.createdTime <= trashCreatedTime &&
        !latestAtOrBefore.has(row.recordId) &&
        this.isReadyRecordTrashSnapshot(row.snapshot)
      ) {
        latestAtOrBefore.set(row.recordId, row);
      }
    }
    // Delete commits table_trash first; recycle-bin JSON can land afterwards with a
    // later created_time. Fall back to those later rows only when nothing in the
    // original time window is ready.
    const useLaterSnapshots =
      recordIds.every((recordId) => latestAtOrBefore.get(recordId) == null) &&
      recordIds.some((recordId) => latestAnyReady.has(recordId));
    const source = useLaterSnapshots ? latestAnyReady : latestAtOrBefore;
    const matched = recordIds
      .map((recordId) => source.get(recordId))
      .filter((row): row is T => row != null);
    const missingIds = recordIds.filter((recordId) => source.get(recordId) == null);
    return { matched, missingIds };
  }

  private assertRecordTrashSnapshotsReady(
    trashId: string,
    recordIds: readonly string[],
    readyRows: readonly unknown[]
  ): void {
    if (recordIds.length > 0 && readyRows.length === 0) {
      throw new CustomHttpException(
        `The trash ${trashId} snapshots are not ready`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.trash.notFound',
          },
        }
      );
    }
  }

  async restoreResource(trash: { resourceType: TrashType; resourceId: string }) {
    const { resourceType, resourceId } = trash;
    await this.assertTrashResourceWritable(resourceType, resourceId);
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

  async restoreTableResource(trashId: string, routedTableId?: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    if (!routedTableId) {
      throw new CustomHttpException(
        `Table id is required to restore table trash ${trashId}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.trash.tableNotFound',
          },
        }
      );
    }
    await this.assertTableWritable(routedTableId);
    const lookupDataPrisma = this.getTrashDataPrismaExecutor(
      await this.trashDataPrismaForTable(routedTableId)
    );

    const {
      tableId,
      resourceType,
      snapshot: originSnapshot,
      createdTime,
    } = await lookupDataPrisma.tableTrash
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
    if (tableId !== routedTableId) {
      await this.assertTableWritable(tableId);
    }
    const dataPrisma = routedTableId
      ? lookupDataPrisma
      : this.getTrashDataPrismaExecutor(await this.trashDataPrismaForTable(tableId));

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
          await restoreFieldRecordValues(tableId, filteredRecords, this.recordOpenApiService);
        }
        break;
      }
      case TableTrashType.Record: {
        const recordIds = snapshot as string[];
        const recordTrashRows = (
          await Promise.all(
            chunk(recordIds, IN_CHUNK).map((ids) =>
              dataPrisma.recordTrash.findMany({
                where: { tableId, recordId: { in: ids }, reason: RECORD_REMOVAL_REASON.Deleted },
                select: {
                  id: true,
                  recordId: true,
                  snapshot: true,
                  createdTime: true,
                },
                orderBy: [{ recordId: 'asc' }, { createdTime: 'desc' }, { id: 'desc' }],
              })
            )
          )
        ).flat();

        const { matched: matchedRecordTrashRows, missingIds } =
          this.pickHotRecordTrashRowsForRestore(recordIds, recordTrashRows, createdTime);
        // Cold fallback: ids with no PG snapshot row may have sunk past the flush horizon.
        const coldTrashRows = missingIds.length
          ? await this.lookupColdTrashRows(tableId, missingIds, createdTime)
          : [];
        const readyRows = [...matchedRecordTrashRows, ...coldTrashRows].filter(({ snapshot }) =>
          this.isReadyRecordTrashSnapshot(snapshot)
        );
        this.assertRecordTrashSnapshotsReady(trashId, recordIds, readyRows);
        const records = readyRows.map(({ snapshot }) => JSON.parse(snapshot));

        await this.recordRestoreService.restoreRecordSnapshots(tableId, records);
        await this.trashDataPrismaTransactionForTable(tableId, async (prisma) => {
          await prisma.recordTrash.deleteMany({
            where: { id: { in: matchedRecordTrashRows.map(({ id }) => id) } },
          });
          await prisma.tableTrash.delete({
            where: { id: trashId },
          });
        });
        // Cold-copy suppression, same rule as the stream restore path above.
        await this.recordRemovalTombstoneService.markRestored(
          await this.trashTombstoneClientForTable(tableId),
          tableId,
          [...matchedRecordTrashRows, ...coldTrashRows].map(({ recordId }) => recordId)
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

    await dataPrisma.tableTrash.delete({
      where: { id: trashId },
    });
  }

  // Lets EE guards inspect what a table-trash operation restores (e.g. row-quota checks
  // only apply to record restores) without duplicating the data-db routing.
  async getTableTrashResourceType(trashId: string, tableId: string): Promise<string | null> {
    const prisma = this.getTrashDataPrismaExecutor(await this.trashDataPrismaForTable(tableId));
    const rows = await prisma.tableTrash.findMany({
      where: { id: trashId },
      select: { resourceType: true },
    });
    return rows[0]?.resourceType ?? null;
  }

  async restoreTrash(trashId: string, tableId?: string) {
    if (trashId.startsWith(IdPrefix.Operation)) {
      return await this.restoreTableResource(trashId, tableId);
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
      await this.assertTrashResourceWritable(
        trash.resourceType as TrashType,
        trash.resourceId,
        trash.parentId
      );

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

    await this.assertTrashResourceWritable(resourceType, resourceId);

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

    const dataPrisma = this.getTrashDataPrismaExecutor(await this.trashDataPrismaForTable(tableId));
    const deletedList = await dataPrisma.tableTrash.findMany({
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

    await this.trashDataPrismaTransactionForTable(tableId, async (prisma) => {
      // Scope to trash rows: archive snapshots share record_trash (reason 'archived') and
      // must survive a trash reset together with their kept attachment reference rows.
      await prisma.recordTrash.deleteMany({
        where: { tableId, reason: RECORD_REMOVAL_REASON.Deleted },
      });

      await prisma.tableTrash.deleteMany({
        where: { tableId },
      });
    });

    // The deleted/ cold subtree mirrors the PG rows just removed — wipe it too so
    // sunk copies cannot resurface in merged reads. Same rule as archive reset: a
    // full prefix wipe needs no tombstones, and running after the PG deletes
    // leaves a retryable state if the wipe fails. The archived/ subtree is
    // untouched.
    await this.recordRemovalColdStorageService.deleteReasonPrefix(
      tableId,
      RECORD_REMOVAL_REASON.Deleted
    );
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
    await this.assertTrashResourceWritable(resourceType, resourceId, parentId);

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
