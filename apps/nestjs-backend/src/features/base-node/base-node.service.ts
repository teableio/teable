/* eslint-disable sonarjs/no-duplicate-string */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { generateBaseNodeId, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IMoveBaseNodeRo,
  IBaseNodeVo,
  IBaseNodeTreeVo,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IUpdateBaseNodeRo,
  IBaseNodeResourceMeta,
  IBaseNodeResourceMetaWithId,
  IBaseNodePresenceCreatePayload,
  IBaseNodePresenceDeletePayload,
  IBaseNodePresenceUpdatePayload,
  IBaseNodePresenceFlushPayload,
  IUserInfoVo,
  V2Feature,
} from '@teable/openapi';
import { BaseNodeResourceType, ShortLinkType } from '@teable/openapi';
import type { PreviewEffect, PreviewResourceReference } from '@teable/v2-command-explain';
import { Knex } from 'knex';
import { isString, keyBy, omit } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { LocalPresence } from 'sharedb/lib/client';
import { type IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { DistributedLockService } from '../../distributed-lock/distributed-lock.service';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { BaseNodeEventFactory } from '../../event-emitter/events/base/base-node.event';
import { Events } from '../../event-emitter/events/event.enum';
import {
  generateBaseNodeListCacheKey,
  generateBaseShareListCacheKey,
} from '../../performance-cache/generate-keys';
import { PerformanceCacheService } from '../../performance-cache/service';
import type { IPerformanceCacheStore } from '../../performance-cache/types';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import type { IV2Decision } from '../canary/canary.service';
import { CanaryService } from '../canary/canary.service';
import { resourceDescriptorOf } from '../resource/resource-descriptor';
import { ShortLinkService } from '../short-link/short-link.service';
import type { IBaseNodeListExtension } from './base-node-list.extension';
import { BASE_NODE_LIST_EXTENSIONS } from './base-node-list.extension';
import { buildBaseNodeUrl } from './base-node-url.helper';
import type { IFolderLifecycleHook } from './folder-lifecycle.hook';
import { FOLDER_LIFECYCLE_HOOKS } from './folder-lifecycle.hook';
import { buildBatchUpdateSql, presenceHandler } from './helper';
import { createMissingFolderNodes } from './missing-folder-nodes';
import { PROJECT_NODE_LOCK_TTL_SECONDS, projectNodeLockName } from './project-node-lock';
import type { IBaseNodeResourceInput } from './resource/base-node-resource-handler';
import { BaseNodeResourceHandlerRegistry } from './resource/base-node-resource-handler.registry';

type IBaseNodeEntry = {
  id: string;
  baseId: string;
  parentId: string | null;
  resourceType: string;
  resourceId: string;
  order: number;
  createdBy?: string | null;
  createdTime?: Date | string | null;
  lastModifiedBy?: string | null;
  lastModifiedTime?: Date | string | null;
  children: { id: string; order: number }[];
  parent: { id: string } | null;
};

export type IFolderSubtreeNode = {
  id: string;
  parentId: string | null;
  resourceType: BaseNodeResourceType;
  resourceId: string;
};

/** How the folder.delete preview names a resource: by name only to a caller who may read it. */
export type IFolderDeleteReference = (resource: {
  resourceType: BaseNodeResourceType;
  resourceId: string;
  name: string;
}) => PreviewResourceReference;

/** How far a folder delete is: resources deleted so far, of all it deletes. */
export type IFolderDeleteProgress = { done: number; total: number };

export type IBaseNodeDeleteOptions = {
  /**
   * Sees what a folder delete is about to delete, read under the lock it runs in: whatever it
   * allows is exactly what goes, nothing added to the folder after it looked.
   */
  assertSubtree?: (subtree: IFolderSubtreeNode[]) => Promise<void> | void;
  /** Called as a folder delete deletes each resource in it. */
  onProgress?: (progress: IFolderDeleteProgress) => void;
};

/** A node of a folder being deleted, as the folder.delete preview describes it. */
export type IFolderDeleteItem = IFolderSubtreeNode & {
  name: string;
  /** What the node list returns for the resource: edition-specific facts ride along. */
  resource: Record<string, unknown>;
  shareCount: number;
};

const folderDeleteOrderOf = (type: BaseNodeResourceType) =>
  resourceDescriptorOf(type)?.folderDeleteOrder ?? -1;

@Injectable()
export class BaseNodeService {
  private readonly logger = new Logger(BaseNodeService.name);

  @Inject(EventEmitterService) private readonly eventEmitterService!: EventEmitterService;
  @Optional()
  @Inject(DistributedLockService)
  private readonly distributedLockService?: DistributedLockService;
  @Optional()
  @Inject(FOLDER_LIFECYCLE_HOOKS)
  private readonly folderLifecycleHooks?: IFolderLifecycleHook[];
  @Optional()
  @Inject(BASE_NODE_LIST_EXTENSIONS)
  private readonly listExtensions?: IBaseNodeListExtension[];
  constructor(
    private readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    private readonly shareDbService: ShareDbService,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly cls: ClsService<IClsStore & { ignoreBaseNodeListener?: boolean }>,
    private readonly canaryService: CanaryService,
    private readonly shortLinkService: ShortLinkService,
    private readonly nodeHandlers: BaseNodeResourceHandlerRegistry
  ) {}

  private get userId() {
    return this.cls.get('user.id');
  }

  /**
   * max depth is maxFolderDepth + 1
   */
  private get maxFolderDepth() {
    return this.thresholdConfig.baseNodeMaxFolderDepth;
  }

  private setIgnoreBaseNodeListener() {
    this.cls.set('ignoreBaseNodeListener', true);
  }

  /**
   * Delete all share records for a node and invalidate cache
   */
  private async deleteNodeShares(baseId: string, nodeId: string): Promise<void> {
    const shares = await this.prismaService.baseShare.findMany({
      where: { baseId, nodeId },
      select: { shareId: true },
    });

    // Unconditional so a share committed between findMany and here is still
    // removed (its short links, if any, stay unmarked — harmless)
    const deleted = await this.prismaService.baseShare.deleteMany({
      where: { baseId, nodeId },
    });

    // The shareIds are gone for good, so their short links are dead too
    for (const share of shares) {
      await this.shortLinkService.markDeletedByResource(ShortLinkType.BaseShare, share.shareId);
    }
    if (deleted.count > 0) {
      await this.performanceCacheService.del(generateBaseShareListCacheKey(baseId));
    }
  }

  private getSelect() {
    return {
      id: true,
      baseId: true,
      parentId: true,
      resourceType: true,
      resourceId: true,
      order: true,
      createdBy: true,
      createdTime: true,
      lastModifiedBy: true,
      lastModifiedTime: true,
      children: {
        select: { id: true, order: true },
        orderBy: { order: 'asc' as const },
      },
      parent: {
        select: { id: true },
      },
    };
  }

  async getTableV2Decision(
    baseId: string,
    nodeId: string,
    feature: V2Feature
  ): Promise<IV2Decision | undefined> {
    const node = await this.prismaService.baseNode.findFirst({
      where: { baseId, id: nodeId },
      select: { resourceType: true },
    });

    if (
      node?.resourceType !== BaseNodeResourceType.Table &&
      node?.resourceType !== BaseNodeResourceType.Folder
    ) {
      return undefined;
    }

    const base = await this.prismaService.txClient().base.findUnique({
      where: { id: baseId, deletedTime: null },
      select: { spaceId: true, v2Enabled: true },
    });

    return this.canaryService.shouldUseV2ForBaseWithReason(base, feature);
  }

  async getDeleteTableV2Decision(baseId: string, nodeId: string): Promise<IV2Decision | undefined> {
    return this.getTableV2Decision(baseId, nodeId, 'deleteTable');
  }

  async getCreateTableV2Decision(baseId: string): Promise<IV2Decision | undefined> {
    const base = await this.prismaService.txClient().base.findUnique({
      where: { id: baseId, deletedTime: null },
      select: { spaceId: true, v2Enabled: true },
    });

    return this.canaryService.shouldUseV2ForBaseWithReason(base, 'createTable');
  }

  /**
   * Resolve a folder reference — its node id or its folder resource id — to
   * the node id, asserting it exists in this base and is a folder.
   */
  async resolveFolderNodeId(baseId: string, folderId: string): Promise<string> {
    await createMissingFolderNodes(this.prismaService, baseId, [folderId], this.userId);
    const node = await this.prismaService.baseNode.findFirst({
      where: { baseId, OR: [{ id: folderId }, { resourceId: folderId }] },
      select: { id: true, resourceType: true },
    });
    if (!node) {
      throw new CustomHttpException(`Parent ${folderId} not found`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.baseNode.parentNotFound',
        },
      });
    }
    if (node.resourceType !== BaseNodeResourceType.Folder) {
      throw new CustomHttpException(
        `Parent ${folderId} is not a folder`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.parentIsNotFolder',
          },
        }
      );
    }
    return node.id;
  }

  /**
   * Place a resource created outside the base-node flow under a folder, or at
   * root when parentId is null; callers validate the folder first. Upserts
   * because node-list reconciliation may have already created the row.
   */
  async attachResourceToParent(input: {
    baseId: string;
    parentId: string | null;
    resourceType: BaseNodeResourceType;
    resourceId: string;
  }): Promise<void> {
    const { baseId, parentId, resourceType, resourceId } = input;
    const userId = this.userId;
    const placement = { order: (await this.getMaxOrder(baseId)) + 1, parentId };
    await this.prismaService.baseNode.upsert({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- prisma composite unique key
        baseId_resourceType_resourceId: { baseId, resourceType, resourceId },
      },
      create: {
        id: generateBaseNodeId(),
        baseId,
        resourceType,
        resourceId,
        ...placement,
        createdBy: userId,
      },
      update: {
        ...placement,
        lastModifiedBy: userId,
      },
    });
    this.presenceHandler<IBaseNodePresenceFlushPayload>(baseId, (presence) => {
      presence.submit({
        event: 'flush',
      });
    });
  }

  private generateDefaultUrl(
    baseId: string,
    resourceType: BaseNodeResourceType,
    resourceId: string,
    resourceMeta?: IBaseNodeResourceMeta
  ): string {
    // A resource that opens on a view (a table) names its default one in its meta.
    const viewId = (resourceMeta as { defaultViewId?: string | null } | undefined)?.defaultViewId;
    return buildBaseNodeUrl(baseId, resourceType, resourceId, viewId) ?? `/base/${baseId}`;
  }

  private async entry2vo(
    entry: IBaseNodeEntry,
    resource?: IBaseNodeResourceInput,
    userMap?: Map<string, IUserInfoVo>
  ): Promise<IBaseNodeVo> {
    const baseNodeEntry = omit(entry, [
      'createdBy',
      'createdTime',
      'lastModifiedBy',
      'lastModifiedTime',
    ]) as Omit<IBaseNodeEntry, 'createdBy' | 'createdTime' | 'lastModifiedBy' | 'lastModifiedTime'>;
    const resourceType = baseNodeEntry.resourceType as BaseNodeResourceType;
    const rawResource: IBaseNodeResourceInput =
      resource ??
      (
        await this.getNodeResource(baseNodeEntry.baseId, resourceType, [baseNodeEntry.resourceId])
      )[0];
    const { id, type, createdBy, createdTime, lastModifiedBy, lastModifiedTime, ...resourceMeta } =
      rawResource;
    const map = userMap ?? (await this.getUserMap([createdBy, lastModifiedBy]));
    const resolveUser = (userId?: string | null) => (userId ? (map.get(userId) ?? null) : null);
    const formatDate = (value: unknown) =>
      value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
    const resourceMetaWithAudit = {
      ...resourceMeta,
      createdTime: formatDate(createdTime),
      createdByUser: resolveUser(createdBy),
      lastModifiedTime: formatDate(lastModifiedTime),
      lastModifiedByUser: resolveUser(lastModifiedBy),
    } as IBaseNodeResourceMeta;

    const defaultUrl = this.generateDefaultUrl(
      baseNodeEntry.baseId,
      resourceType,
      baseNodeEntry.resourceId,
      resourceMetaWithAudit
    );

    return {
      ...baseNodeEntry,
      resourceType,
      resourceMeta: resourceMetaWithAudit,
      defaultUrl,
    };
  }

  private async getUserMap(
    userIds: Array<string | null | undefined>
  ): Promise<Map<string, IUserInfoVo>> {
    const ids = [...new Set(userIds.filter(Boolean) as string[])];
    if (ids.length === 0) {
      return new Map();
    }

    const users = await this.prismaService.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });

    return new Map(
      users.map((user) => [
        user.id,
        { ...user, avatar: user.avatar && getPublicFullStorageUrl(user.avatar) },
      ])
    );
  }

  /** The handler of a node kind; an unknown kind is the caller's error. */
  private nodeHandlerOf(type: string) {
    const handler = this.nodeHandlers.get(type);
    if (!handler) {
      throw new CustomHttpException(
        `Invalid resource type ${type}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.invalidResourceType',
          },
        }
      );
    }
    return handler;
  }

  protected async getNodeResource(
    baseId: string,
    type: BaseNodeResourceType,
    ids?: string[]
  ): Promise<IBaseNodeResourceInput[]> {
    const extensions = (this.listExtensions ?? []).filter((extension) => extension.type === type);
    const [resources, extend] = await Promise.all([
      this.nodeHandlerOf(type).list(baseId, ids),
      Promise.all(extensions.map((extension) => extension.load(baseId))),
    ]);
    return extend.reduce((list, apply) => apply(list), resources);
  }

  protected getResourceTypes(): BaseNodeResourceType[] {
    return this.nodeHandlers.all().map((handler) => handler.type);
  }

  async prepareNodeList(baseId: string): Promise<IBaseNodeVo[]> {
    const resourceTypes = this.getResourceTypes();
    const resourceResults = await Promise.all(
      resourceTypes.map((type) => this.getNodeResource(baseId, type))
    );

    const resources = resourceResults.flatMap((list, index) =>
      list.map((r) => ({ ...r, type: resourceTypes[index] }))
    );

    const userMap = await this.getUserMap(
      resources.flatMap((resource) => [resource.createdBy, resource.lastModifiedBy])
    );
    const resourceMap = keyBy(resources, (r) => `${r.type}_${r.id}`);
    const resourceKeys = new Set(resources.map((r) => `${r.type}_${r.id}`));

    // Only this edition's kinds: a node of another kind is neither listed nor removed here.
    const isListed = (node: { resourceType: string }) =>
      (resourceTypes as string[]).includes(node.resourceType);
    const nodes = (
      await this.prismaService.baseNode.findMany({
        where: { baseId },
        select: this.getSelect(),
        orderBy: { order: 'asc' },
      })
    ).filter(isListed);

    const nodeKeys = new Set(nodes.map((n) => `${n.resourceType}_${n.resourceId}`));

    const toCreate = resources.filter((r) => !nodeKeys.has(`${r.type}_${r.id}`));
    const toDelete = nodes.filter((n) => !resourceKeys.has(`${n.resourceType}_${n.resourceId}`));
    const validParentIds = new Set(nodes.filter((n) => !toDelete.includes(n)).map((n) => n.id));
    const orphans = nodes.filter(
      (n) => n.parentId && !validParentIds.has(n.parentId) && !toDelete.includes(n)
    );

    if (toCreate.length === 0 && toDelete.length === 0 && orphans.length === 0) {
      return Promise.all(
        nodes.map((entry) => {
          const key = `${entry.resourceType}_${entry.resourceId}`;
          const resource = resourceMap[key];
          return this.entry2vo(entry, resource, userMap);
        })
      );
    }

    const finalMenus = await this.prismaService.$tx(async (prisma) => {
      // Delete redundant
      if (toDelete.length > 0) {
        await prisma.baseNode.deleteMany({
          where: { id: { in: toDelete.map((m) => m.id) } },
        });
      }

      // Prepare for create and update
      let nextOrder = 0;
      if (toCreate.length > 0 || orphans.length > 0) {
        const maxOrderAgg = await prisma.baseNode.aggregate({
          where: { baseId },
          _max: { order: true },
        });
        nextOrder = (maxOrderAgg._max.order ?? 0) + 1;
      }

      // Create missing; skipDuplicates absorbs concurrent reconciliations
      if (toCreate.length > 0) {
        await prisma.baseNode.createMany({
          data: toCreate.map((r) => ({
            id: generateBaseNodeId(),
            baseId,
            resourceType: r.type,
            resourceId: r.id,
            order: nextOrder++,
            parentId: null,
            createdBy: this.userId,
          })),
          skipDuplicates: true,
        });
      }

      // Reset orphans to root level with new order
      if (orphans.length > 0) {
        await this.batchUpdateBaseNodes(
          orphans.map((orphan, index) => ({
            id: orphan.id,
            values: { parentId: null, order: nextOrder + index },
          }))
        );
      }
      const listed = await prisma.baseNode.findMany({
        where: { baseId },
        select: this.getSelect(),
        orderBy: { order: 'asc' },
      });
      return listed.filter(isListed);
    });

    return await Promise.all(
      finalMenus.map(async (entry) => {
        const key = `${entry.resourceType}_${entry.resourceId}`;
        const resource = resourceMap[key];
        return await this.entry2vo(entry, resource, userMap);
      })
    );
  }

  async getNodeListWithCache(baseId: string): Promise<IBaseNodeVo[]> {
    return this.performanceCacheService.wrap(
      generateBaseNodeListCacheKey(baseId),
      () => this.prepareNodeList(baseId),
      {
        ttl: 60 * 60, // 1 hour
        statsType: 'base-node-list',
      }
    );
  }

  async getList(baseId: string): Promise<IBaseNodeVo[]> {
    return this.getNodeListWithCache(baseId);
  }

  async getTree(baseId: string): Promise<IBaseNodeTreeVo> {
    const nodes = await this.getNodeListWithCache(baseId);

    return {
      nodes,
      maxFolderDepth: this.maxFolderDepth,
    };
  }

  async getNode(baseId: string, nodeId: string) {
    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: this.getSelect(),
      })
      .catch(() => {
        throw new CustomHttpException(`Project node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });
    return {
      ...node,
      resourceType: node.resourceType as BaseNodeResourceType,
    };
  }

  async getNodeVo(baseId: string, nodeId: string): Promise<IBaseNodeVo> {
    const node = await this.getNode(baseId, nodeId);
    return this.entry2vo(node);
  }

  async create(baseId: string, ro: ICreateBaseNodeRo): Promise<IBaseNodeVo> {
    this.setIgnoreBaseNodeListener();

    const { resourceType, parentId } = ro;
    const resource = await this.createResource(baseId, ro);
    const resourceId = resource.id;

    const maxOrder = await this.getMaxOrder(baseId);
    const placement = { order: maxOrder + 1, parentId: parentId ?? null };
    // upsert: a concurrent node-list reconciliation may already hold a root-level row
    const entry = await this.prismaService.baseNode.upsert({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- prisma composite unique key
        baseId_resourceType_resourceId: { baseId, resourceType, resourceId },
      },
      create: {
        id: generateBaseNodeId(),
        baseId,
        resourceType,
        resourceId,
        ...placement,
        createdBy: this.userId,
      },
      update: {
        ...placement,
        lastModifiedBy: this.userId,
      },
      select: this.getSelect(),
    });

    const vo = await this.entry2vo(entry, resource);
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'create',
        data: { id: vo.id },
      });
    });

    return vo;
  }

  protected async createResource(
    baseId: string,
    createRo: ICreateBaseNodeRo
  ): Promise<IBaseNodeResourceMetaWithId> {
    const { resourceType, parentId, ...ro } = createRo;
    const parentNode = parentId ? await this.getParentNodeOrThrow(parentId) : null;
    if (parentNode && parentNode.resourceType !== BaseNodeResourceType.Folder) {
      throw new CustomHttpException('Parent must be a folder', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.parentMustBeFolder',
        },
      });
    }

    if (parentNode && resourceType === BaseNodeResourceType.Folder) {
      await this.assertFolderDepth(baseId, parentNode.id);
    }

    return this.nodeHandlerOf(resourceType).create(baseId, ro);
  }

  async duplicate(baseId: string, nodeId: string, ro: IDuplicateBaseNodeRo) {
    this.setIgnoreBaseNodeListener();

    const anchor = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });
    const { resourceType, resourceId } = anchor;

    if (resourceType === BaseNodeResourceType.Folder) {
      throw new CustomHttpException('Cannot duplicate folder', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.cannotDuplicateFolder',
        },
      });
    }

    const resource = await this.duplicateResource(
      baseId,
      resourceType as BaseNodeResourceType,
      resourceId,
      ro
    );
    const { entry } = await this.prismaService.$tx(async (prisma) => {
      const maxOrder = await this.getMaxOrder(baseId, anchor.parentId);
      const placement = { order: maxOrder + 1, parentId: anchor.parentId };
      // upsert: a concurrent node-list reconciliation may already hold a root-level row
      const entry = await prisma.baseNode.upsert({
        where: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- prisma composite unique key
          baseId_resourceType_resourceId: {
            baseId,
            resourceType,
            resourceId: resource.id,
          },
        },
        create: {
          id: generateBaseNodeId(),
          baseId,
          resourceType,
          resourceId: resource.id,
          ...placement,
          createdBy: this.userId,
        },
        update: {
          ...placement,
          lastModifiedBy: this.userId,
        },
        select: this.getSelect(),
      });

      await updateOrder({
        query: baseId,
        position: 'after',
        item: entry,
        anchorItem: anchor,
        getNextItem: async (whereOrder, align) => {
          return prisma.baseNode.findFirst({
            where: {
              baseId,
              parentId: anchor.parentId,
              order: whereOrder,
              id: { not: entry.id },
            },
            select: { order: true, id: true },
            orderBy: { order: align },
          });
        },
        update: async (_, id, data) => {
          await prisma.baseNode.update({
            where: { id },
            data: { parentId: anchor.parentId, order: data.newOrder },
          });
        },
        shuffle: async () => {
          await this.shuffleOrders(baseId, anchor.parentId);
        },
      });

      return {
        entry,
      };
    });

    const vo = await this.entry2vo(entry, resource);
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'create',
        data: { id: vo.id },
      });
    });
    return vo;
  }

  protected async duplicateResource(
    baseId: string,
    type: BaseNodeResourceType,
    id: string,
    duplicateRo: IDuplicateBaseNodeRo
  ): Promise<IBaseNodeResourceMetaWithId> {
    const handler = this.nodeHandlerOf(type);
    if (!handler.duplicate) {
      throw new CustomHttpException(
        `Invalid resource type ${type}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.invalidResourceType',
          },
        }
      );
    }
    return handler.duplicate(baseId, id, duplicateRo);
  }

  async update(baseId: string, nodeId: string, ro: IUpdateBaseNodeRo) {
    this.setIgnoreBaseNodeListener();

    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: this.getSelect(),
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });

    await this.updateResource(
      baseId,
      node.resourceType as BaseNodeResourceType,
      node.resourceId,
      ro
    );

    const vo = await this.entry2vo(node);
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'update',
        data: { id: vo.id },
      });
    });
    return vo;
  }

  protected async updateResource(
    baseId: string,
    type: BaseNodeResourceType,
    id: string,
    updateRo: IUpdateBaseNodeRo
  ): Promise<void> {
    await this.nodeHandlerOf(type).update(baseId, id, updateRo);
  }

  async delete(
    baseId: string,
    nodeId: string,
    permanent?: boolean,
    options: IBaseNodeDeleteOptions = {}
  ) {
    this.setIgnoreBaseNodeListener();

    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: { resourceType: true, resourceId: true },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });
    if (node.resourceType === BaseNodeResourceType.Folder) {
      await this.deleteFolderNode(baseId, nodeId, permanent, options);
      return node;
    }

    await this.deleteResource(
      baseId,
      node.resourceType as BaseNodeResourceType,
      node.resourceId,
      permanent
    );
    // After the resource: a delete that fails keeps the node's shares.
    await this.deleteNodeShares(baseId, nodeId);
    await this.prismaService.baseNode.delete({
      where: { id: nodeId },
    });

    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'delete',
        data: { id: nodeId },
      });
    });
    return node;
  }

  /**
   * The folder and everything under it, the folder first. Read from the node table, so
   * nodes the caller cannot see are included: deleting a folder must not leave them behind.
   */
  async getFolderSubtree(baseId: string, folderNodeId: string): Promise<IFolderSubtreeNode[]> {
    const nodes = await this.prismaService.baseNode.findMany({
      where: { baseId },
      select: { id: true, parentId: true, resourceType: true, resourceId: true },
      orderBy: { order: 'asc' },
    });
    const root = nodes.find((n) => n.id === folderNodeId);
    if (!root) return [];
    const childrenOf = new Map<string, typeof nodes>();
    for (const node of nodes) {
      if (!node.parentId) continue;
      childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node]);
    }
    const subtree: IFolderSubtreeNode[] = [];
    const queue = [root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      subtree.push({ ...node, resourceType: node.resourceType as BaseNodeResourceType });
      queue.push(...(childrenOf.get(node.id) ?? []));
    }
    return subtree;
  }

  /** The folder's subtree with what the folder.delete preview says about each node. */
  async getFolderDeleteItems(baseId: string, folderNodeId: string): Promise<IFolderDeleteItem[]> {
    const subtree = await this.getFolderSubtree(baseId, folderNodeId);
    const types = [...new Set(subtree.map((node) => node.resourceType))];
    const resources = new Map<string, Record<string, unknown>>();
    for (const type of types) {
      const ids = subtree.filter((n) => n.resourceType === type).map((n) => n.resourceId);
      for (const resource of await this.getNodeResource(baseId, type, ids)) {
        resources.set(`${type}:${resource.id}`, resource as Record<string, unknown>);
      }
    }
    const shares = await this.prismaService.baseShare.groupBy({
      by: ['nodeId'],
      where: { baseId, nodeId: { in: subtree.map((node) => node.id) } },
      _count: { _all: true },
    });
    const shareCounts = new Map(shares.map((share) => [share.nodeId, share._count._all]));
    // A resource already in the trash on its own is not part of this delete.
    const inDelete = subtree.filter(
      (node) =>
        node.resourceType === BaseNodeResourceType.Folder ||
        resources.has(`${node.resourceType}:${node.resourceId}`)
    );
    return inDelete.map((node) => {
      const resource = resources.get(`${node.resourceType}:${node.resourceId}`) ?? {};
      return {
        ...node,
        name: isString(resource.name) ? resource.name : '',
        resource,
        shareCount: shareCounts.get(node.id) ?? 0,
      };
    });
  }

  /** Consequences of deleting these nodes beyond the resources, as each kind's handler tells. */
  async getFolderDeleteHostEffects(
    baseId: string,
    items: IFolderDeleteItem[],
    reference: IFolderDeleteReference
  ): Promise<PreviewEffect[]> {
    const effects: PreviewEffect[] = [];
    for (const handler of this.nodeHandlers.all()) {
      effects.push(...((await handler.folderDeleteEffects?.(baseId, items, reference)) ?? []));
    }
    return effects;
  }

  /**
   * Shares the project lock with moves, within the project and across projects: a move would
   * carry nodes out of the subtree being deleted, and two overlapping deletes would each delete
   * the other's half. A second caller is told to retry.
   */
  private async withFolderDeleteLock<T>(baseId: string, task: () => Promise<T>): Promise<T> {
    if (!this.distributedLockService) return task();
    let result!: T;
    const ran = await this.distributedLockService.runExclusive(
      projectNodeLockName(baseId),
      PROJECT_NODE_LOCK_TTL_SECONDS,
      async () => {
        result = await task();
      }
    );
    if (!ran) {
      throw new CustomHttpException(
        `Another folder delete or node move in project ${baseId} is in progress`,
        HttpErrorCode.CONFLICT,
        { localization: { i18nKey: 'httpErrors.baseNode.projectBusy' } }
      );
    }
    return result;
  }

  private async deleteFolderNode(
    baseId: string,
    nodeId: string,
    permanent: boolean | undefined,
    { assertSubtree, onProgress }: IBaseNodeDeleteOptions
  ) {
    try {
      await this.withFolderDeleteLock(baseId, async () => {
        const subtree = await this.dropTrashedNodes(
          baseId,
          await this.getFolderSubtree(baseId, nodeId)
        );
        await assertSubtree?.(subtree);
        if (permanent) {
          await this.permanentDeleteEmptyFolder(baseId, subtree);
        } else {
          for (const handler of this.nodeHandlers.all()) {
            await handler.beforeFolderDelete?.(baseId, subtree);
          }
          await this.trashFolderSubtree(baseId, subtree, onProgress);
        }
        await this.deleteSubtreeShares(baseId, subtree);
        // The controller raises the event for the folder itself; its contents are raised here
        // so the audit log, pins, recent visits and the trash see each of them.
        await this.emitSubtreeDeleteEvents(baseId, subtree.slice(1), permanent);
      });
    } finally {
      // A delete that stopped part way has still taken what it deleted out of the tree.
      this.presenceHandler<IBaseNodePresenceFlushPayload>(baseId, (presence) => {
        presence.submit({ event: 'flush' });
      });
    }
  }

  /**
   * A resource deleted on its own is in the trash already, with its own entry, while its node
   * may wait for the tree to drop it. The node goes now, as the tree drops any node whose
   * resource it does not list, and the folder delete leaves the resource and its entry alone.
   */
  private async dropTrashedNodes(baseId: string, subtree: IFolderSubtreeNode[]) {
    const resources = subtree.filter((n) => n.resourceType !== BaseNodeResourceType.Folder);
    const live = await this.liveResourceIds(baseId, resources);
    const trashed = resources.filter((n) => !live.has(n.resourceId));
    if (!trashed.length) return subtree;
    await this.prismaService.baseNode.deleteMany({
      where: { id: { in: trashed.map((n) => n.id) } },
    });
    const trashedIds = new Set(trashed.map((n) => n.id));
    return subtree.filter((n) => !trashedIds.has(n.id));
  }

  private async liveResourceIds(baseId: string, nodes: IFolderSubtreeNode[]) {
    const live = new Set<string>();
    for (const type of new Set(nodes.map((n) => n.resourceType))) {
      const ids = nodes.filter((n) => n.resourceType === type).map((n) => n.resourceId);
      for (const { id } of await this.nodeHandlerOf(type).list(baseId, ids)) live.add(id);
    }
    return live;
  }

  private orderForFolderDelete(subtree: IFolderSubtreeNode[]) {
    return subtree
      .filter((node) => node.resourceType !== BaseNodeResourceType.Folder)
      .sort((a, b) => folderDeleteOrderOf(a.resourceType) - folderDeleteOrderOf(b.resourceType));
  }

  /**
   * The trash rows of a folder delete: every folder and every trashed resource, each under
   * its direct parent folder; the folder deleted is the one entry the project's trash lists.
   */
  private buildFolderTrashRows(baseId: string, subtree: IFolderSubtreeNode[], deletedTime: Date) {
    const folderIdOfNode = new Map(
      subtree
        .filter((n) => n.resourceType === BaseNodeResourceType.Folder)
        .map((n) => [n.id, n.resourceId])
    );
    const [root] = subtree;
    return subtree
      .filter((n) => resourceDescriptorOf(n.resourceType)?.nodeEvents)
      .map((n) => ({
        resourceType: n.resourceType as string,
        resourceId: n.resourceId,
        parentId: n.id === root.id ? baseId : folderIdOfNode.get(n.parentId!)!,
        deletedTime,
        deletedBy: this.userId,
      }));
  }

  /**
   * Nothing is put back when this fails part way: each delete it made is committed on its own and
   * may have changed things outside the folder (a link to a deleted table becomes text) that a
   * restore does not undo. What was deleted stays in the trash as entries of their own; the folder
   * and the rest stay where they are, and deleting the folder again finishes the job.
   */
  private async trashFolderSubtree(
    baseId: string,
    subtree: IFolderSubtreeNode[],
    onProgress?: (progress: IFolderDeleteProgress) => void
  ) {
    const deletedTime = new Date();
    const rows = this.buildFolderTrashRows(baseId, subtree, deletedTime);
    // The resources' rows go first, at the project, as any resource deleted on its own has. The
    // folders' rows, and each resource under its folder, come with the commit that trashes the
    // folders: a trash row names a folder only once that folder is in the trash, so whatever
    // stops this before then leaves ordinary entries of the project.
    const rowKeys = rows
      .filter((row) => row.resourceType !== BaseNodeResourceType.Folder)
      .map(({ resourceType, resourceId }) => ({ resourceType, resourceId }));
    await this.prismaService.$tx(async (prisma) => {
      await prisma.trash.deleteMany({ where: { OR: rowKeys } });
      await prisma.trash.createMany({
        data: rows
          .filter((row) => row.resourceType !== BaseNodeResourceType.Folder)
          .map((row) => ({ ...row, parentId: baseId })),
      });
    });

    const resources = this.orderForFolderDelete(subtree);
    const total = resources.length;
    try {
      for (const [index, node] of resources.entries()) {
        await this.deleteResource(baseId, node.resourceType, node.resourceId);
        await this.syncTrashTime(node);
        onProgress?.({ done: index + 1, total });
      }
      await this.commitFolderTrash(baseId, subtree, rows, rowKeys, deletedTime);
    } catch (error) {
      const deleted = await this.settleFailedFolderTrash(baseId, resources, rowKeys);
      if (deleted === 0) throw error;
      this.logger.error(
        `Folder delete in project ${baseId} stopped after ${deleted} of ${resources.length} items`,
        error instanceof Error ? error.stack : error
      );
      throw new CustomHttpException(
        `The folder was only partly deleted: ${deleted} of its items are in the trash on their own. Delete the folder again to finish.`,
        HttpErrorCode.INTERNAL_SERVER_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.folderDeletePartial',
            context: { count: deleted },
          },
        }
      );
    }
  }

  /**
   * After a folder delete stopped: what is actually deleted, whether or not its delete returned,
   * keeps its trash row, an entry of its own at the project; the rows of what is still live go.
   * Returns how many were deleted.
   */
  private async settleFailedFolderTrash(
    baseId: string,
    resources: IFolderSubtreeNode[],
    rowKeys: { resourceType: string; resourceId: string }[]
  ) {
    const live = await this.liveResourceIds(baseId, resources);
    const deleted = resources.filter((n) => !live.has(n.resourceId));
    for (const node of deleted) {
      await this.syncTrashTime(node);
    }
    const deletedIds = new Set(deleted.map((n) => n.resourceId));
    await this.prismaService.$tx(async (prisma) => {
      await prisma.trash.deleteMany({
        where: { OR: rowKeys.filter((key) => !deletedIds.has(key.resourceId)) },
      });
      await prisma.baseNode.deleteMany({ where: { id: { in: deleted.map((n) => n.id) } } });
    });
    // They are gone like anything deleted on its own: their shares, pins, recent visits and
    // audit rows follow them, as a finished folder delete's contents do.
    await this.deleteSubtreeShares(baseId, deleted);
    await this.emitSubtreeDeleteEvents(baseId, deleted);
    return deleted.length;
  }

  private async commitFolderTrash(
    baseId: string,
    subtree: IFolderSubtreeNode[],
    rows: ReturnType<BaseNodeService['buildFolderTrashRows']>,
    rowKeys: { resourceType: string; resourceId: string }[],
    deletedTime: Date
  ) {
    await this.prismaService.$tx(async (prisma) => {
      // Something restored from under the folder while it was being deleted would be
      // trashed again by this commit; give up instead, as any failure does.
      const count = await prisma.trash.count({ where: { OR: rowKeys } });
      if (count !== rowKeys.length) {
        throw new CustomHttpException(
          'The folder changed while it was being deleted',
          HttpErrorCode.CONFLICT,
          { localization: { i18nKey: 'httpErrors.baseNode.folderDeleteInProgress' } }
        );
      }
      const folders = subtree.filter((n) => n.resourceType === BaseNodeResourceType.Folder);
      await prisma.baseNodeFolder.updateMany({
        where: { id: { in: folders.map((n) => n.resourceId) } },
        data: { deletedTime },
      });
      // The structure: the folders' own rows, the top one at the project, and each resource
      // under its folder. All rewritten in the tree's order, which a restore rebuilds the
      // folders' contents in; a table keeps the deleted time its row was given.
      const written = await prisma.trash.findMany({
        where: { OR: rowKeys },
        select: { resourceType: true, resourceId: true, deletedTime: true },
      });
      const writtenTime = new Map(
        written.map((row) => [`${row.resourceType}:${row.resourceId}`, row.deletedTime])
      );
      await prisma.trash.deleteMany({
        where: { OR: rows.map(({ resourceType, resourceId }) => ({ resourceType, resourceId })) },
      });
      await prisma.trash.createMany({
        data: rows.map((row) => ({
          ...row,
          deletedTime: writtenTime.get(`${row.resourceType}:${row.resourceId}`) ?? row.deletedTime,
        })),
      });
      await prisma.baseNode.deleteMany({ where: { id: { in: subtree.map((n) => n.id) } } });
      for (const hook of this.folderLifecycleHooks ?? []) {
        await hook.onFoldersTrashed(baseId, folders);
      }
    });
  }

  /**
   * A resource the folder delete trashed keeps the time it was actually deleted at in its row, as
   * a delete on its own records it: a table's fields and views come back by matching that time.
   */
  private async syncTrashTime(node: { resourceType: string; resourceId: string }) {
    const table = resourceDescriptorOf(node.resourceType)?.dbTable?.name;
    if (!table) return;
    const deleted = this.knex(table).select('deleted_time').where('id', node.resourceId);
    const sql = this.knex('trash')
      .update({ deleted_time: deleted })
      .where({ resource_type: node.resourceType, resource_id: node.resourceId })
      .whereExists(deleted.clone().whereNotNull('deleted_time'))
      .toQuery();
    await this.prismaService.$executeRawUnsafe(sql);
  }

  /** Only an empty folder is deleted for good; one with contents goes to the trash first. */
  private async permanentDeleteEmptyFolder(baseId: string, subtree: IFolderSubtreeNode[]) {
    const [folder] = subtree;
    if (subtree.length > 1) {
      throw new CustomHttpException(
        'Cannot delete folder because it is not empty; move it to the trash instead',
        HttpErrorCode.VALIDATION_ERROR,
        { localization: { i18nKey: 'httpErrors.baseNode.cannotDeleteEmptyFolder' } }
      );
    }
    await this.prismaService.$tx(async (prisma) => {
      await prisma.baseNode.delete({ where: { id: folder.id } });
      await prisma.baseNodeFolder.deleteMany({ where: { baseId, id: folder.resourceId } });
    });
  }

  private async deleteSubtreeShares(baseId: string, subtree: IFolderSubtreeNode[]) {
    for (const node of subtree) {
      await this.deleteNodeShares(baseId, node.id);
    }
  }

  /** The node's own delete event, for a delete route that streams and so is not intercepted. */
  async emitDeleteEvent(baseId: string, node: { resourceType: string; resourceId: string }) {
    await this.emitSubtreeDeleteEvents(baseId, [
      { resourceType: node.resourceType as BaseNodeResourceType, resourceId: node.resourceId },
    ]);
  }

  private async emitSubtreeDeleteEvents(
    baseId: string,
    nodes: Pick<IFolderSubtreeNode, 'resourceType' | 'resourceId'>[],
    permanent?: boolean
  ) {
    for (const { resourceType, resourceId } of nodes) {
      const event = BaseNodeEventFactory.create(
        Events.BASE_NODE_DELETE,
        { baseId, node: { resourceType, resourceId, ...(permanent ? { permanent } : {}) } },
        { user: this.cls.get('user') }
      );
      if (event) await this.eventEmitterService.emitAsync(event.name, event);
    }
  }

  protected async deleteResource(
    baseId: string,
    type: BaseNodeResourceType,
    id: string,
    permanent?: boolean
  ) {
    await this.nodeHandlerOf(type).delete(baseId, id, permanent);
  }

  async move(baseId: string, nodeId: string, ro: IMoveBaseNodeRo): Promise<IBaseNodeVo> {
    // A folder delete deletes the nodes it read when it began: one moved meanwhile would go with
    // it from wherever it was moved to.
    return this.withFolderDeleteLock(baseId, () => this.moveInProject(baseId, nodeId, ro));
  }

  private async moveInProject(
    baseId: string,
    nodeId: string,
    ro: IMoveBaseNodeRo
  ): Promise<IBaseNodeVo> {
    this.setIgnoreBaseNodeListener();

    const { parentId, anchorId, position } = ro;

    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });

    if (isString(parentId) && isString(anchorId)) {
      throw new CustomHttpException(
        'Only one of parentId or anchorId must be provided',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.onlyOneOfParentIdOrAnchorIdRequired',
          },
        }
      );
    }

    if (parentId === nodeId) {
      throw new CustomHttpException('Cannot move node to itself', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.cannotMoveToItself',
        },
      });
    }

    if (anchorId === nodeId) {
      throw new CustomHttpException(
        'Cannot move node to its own child (circular reference)',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.cannotMoveToCircularReference',
          },
        }
      );
    }

    let newNode: IBaseNodeEntry;
    if (anchorId) {
      newNode = await this.moveNodeTo(baseId, node.id, { anchorId, position });
    } else if (parentId === null) {
      newNode = await this.moveNodeToRoot(baseId, node.id);
    } else if (parentId) {
      newNode = await this.moveNodeToFolder(baseId, node.id, parentId);
    } else {
      throw new CustomHttpException(
        'At least one of parentId or anchorId must be provided',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.anchorIdOrParentIdRequired',
          },
        }
      );
    }

    const vo = await this.entry2vo(newNode);
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'update',
        data: { id: vo.id },
      });
    });

    return vo;
  }

  private async moveNodeToRoot(baseId: string, nodeId: string) {
    return this.prismaService.$tx(async (prisma) => {
      const maxOrder = await this.getMaxOrder(baseId);
      return prisma.baseNode.update({
        where: { id: nodeId },
        select: this.getSelect(),
        data: {
          parentId: null,
          order: maxOrder + 1,
          lastModifiedBy: this.userId,
        },
      });
    });
  }

  private async moveNodeToFolder(baseId: string, nodeId: string, parentId: string) {
    return this.prismaService.$tx(async (prisma) => {
      const node = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: nodeId },
        })
        .catch(() => {
          throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.baseNode.notFound',
            },
          });
        });

      const parentNode = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: parentId },
        })
        .catch(() => {
          throw new CustomHttpException(`Parent ${parentId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.baseNode.parentNotFound',
            },
          });
        });

      if (parentNode.resourceType !== BaseNodeResourceType.Folder) {
        throw new CustomHttpException(
          `Parent ${parentId} is not a folder`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.parentIsNotFolder',
            },
          }
        );
      }

      if (node.resourceType === BaseNodeResourceType.Folder) {
        await this.assertFolderMoveDepth(baseId, parentId, nodeId);
      }

      const maxOrder = await this.getMaxOrder(baseId);
      return prisma.baseNode.update({
        where: { id: nodeId },
        select: this.getSelect(),
        data: {
          parentId,
          order: maxOrder + 1,
          lastModifiedBy: this.userId,
        },
      });
    });
  }

  private async moveNodeTo(
    baseId: string,
    nodeId: string,
    ro: Pick<IMoveBaseNodeRo, 'anchorId' | 'position'>
  ): Promise<IBaseNodeEntry> {
    const { anchorId, position } = ro;
    return this.prismaService.$tx(async (prisma) => {
      const node = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: nodeId },
        })
        .catch(() => {
          throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.baseNode.notFound',
            },
          });
        });

      const anchor = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: anchorId },
        })
        .catch(() => {
          throw new CustomHttpException(`Anchor ${anchorId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.baseNode.anchorNotFound',
            },
          });
        });

      if (node.resourceType === BaseNodeResourceType.Folder && anchor.parentId) {
        await this.assertFolderMoveDepth(baseId, anchor.parentId, nodeId);
      }

      await updateOrder({
        query: baseId,
        position: position ?? 'after',
        item: node,
        anchorItem: anchor,
        getNextItem: async (whereOrder, align) => {
          return prisma.baseNode.findFirst({
            where: {
              baseId,
              parentId: anchor.parentId,
              order: whereOrder,
            },
            select: { order: true, id: true },
            orderBy: { order: align },
          });
        },
        update: async (_, id, data) => {
          await prisma.baseNode.update({
            where: { id },
            data: { parentId: anchor.parentId, order: data.newOrder },
          });
        },
        shuffle: async () => {
          await this.shuffleOrders(baseId, anchor.parentId);
        },
      });

      return prisma.baseNode.findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: this.getSelect(),
      });
    });
  }

  async getMaxOrder(baseId: string, parentId?: string | null) {
    const prisma = this.prismaService.txClient();
    const aggregate = await prisma.baseNode.aggregate({
      where: { baseId, parentId },
      _max: { order: true },
    });

    return aggregate._max.order ?? 0;
  }

  private async shuffleOrders(baseId: string, parentId: string | null) {
    const prisma = this.prismaService.txClient();
    const siblings = await prisma.baseNode.findMany({
      where: { baseId, parentId },
      orderBy: { order: 'asc' },
    });

    for (const [index, sibling] of siblings.entries()) {
      await prisma.baseNode.update({
        where: { id: sibling.id },
        data: { order: index + 10, lastModifiedBy: this.userId },
      });
    }
  }

  private async getParentNodeOrThrow(id: string) {
    const entry = await this.prismaService.baseNode.findFirst({
      where: { id },
      select: {
        id: true,
        parentId: true,
        resourceType: true,
        resourceId: true,
      },
    });
    if (!entry) {
      throw new CustomHttpException('Project node not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.baseNode.notFound',
        },
      });
    }
    return entry;
  }

  private async assertFolderDepth(baseId: string, id: string) {
    const folderDepth = await this.getFolderDepth(baseId, id);
    if (folderDepth >= this.maxFolderDepth) {
      throw new CustomHttpException('Folder depth limit exceeded', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.folderDepthLimitExceeded',
        },
      });
    }
  }

  private async assertFolderMoveDepth(baseId: string, parentId: string, nodeId: string) {
    const allFolders = await this.getAllFolders(baseId);

    const parentDepth = this.getFolderDepthFromList(allFolders, parentId, nodeId);
    const subtreeDepth = this.getFolderSubtreeDepth(allFolders, nodeId);

    if (parentDepth + subtreeDepth >= this.maxFolderDepth) {
      throw new CustomHttpException('Folder depth limit exceeded', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.folderDepthLimitExceeded',
        },
      });
    }
  }

  private async getAllFolders(baseId: string) {
    return this.prismaService.txClient().baseNode.findMany({
      where: { baseId, resourceType: BaseNodeResourceType.Folder },
      select: { id: true, parentId: true },
    });
  }

  private getFolderDepthFromList(
    allFolders: { id: string; parentId: string | null }[],
    id: string,
    circularCheckNodeId?: string
  ) {
    let depth = 0;
    if (allFolders.length === 0) {
      return depth;
    }

    const folderMap = keyBy(allFolders, 'id');
    const visited = new Set<string>();
    let current = id;
    while (current) {
      if ((circularCheckNodeId && current === circularCheckNodeId) || visited.has(current)) {
        throw new CustomHttpException(
          'Circular reference detected in folder hierarchy',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.circularReference',
            },
          }
        );
      }
      visited.add(current);
      depth++;
      const folder = folderMap[current];
      if (!folder) {
        throw new CustomHttpException('Folder not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.folderNotFound',
          },
        });
      }
      current = folder.parentId ?? '';
    }
    return depth;
  }

  private getFolderSubtreeDepth(
    allFolders: { id: string; parentId: string | null }[],
    nodeId: string
  ) {
    const childrenMap: Record<string, string[]> = {};
    for (const folder of allFolders) {
      if (folder.parentId) {
        (childrenMap[folder.parentId] ??= []).push(folder.id);
      }
    }
    const calc = (id: string): number => {
      const children = childrenMap[id];
      if (!children?.length) return 0;
      return 1 + Math.max(...children.map(calc));
    };
    return calc(nodeId);
  }

  private async getFolderDepth(baseId: string, id: string) {
    const allFolders = await this.getAllFolders(baseId);
    return this.getFolderDepthFromList(allFolders, id);
  }

  async batchUpdateBaseNodes(data: { id: string; values: { [key: string]: unknown } }[]) {
    const sql = buildBatchUpdateSql(this.knex, data);
    if (!sql) {
      return;
    }
    await this.prismaService.txClient().$executeRawUnsafe(sql);
  }

  private presenceHandler<
    T =
      | IBaseNodePresenceCreatePayload
      | IBaseNodePresenceUpdatePayload
      | IBaseNodePresenceDeletePayload,
  >(baseId: string, handler: (presence: LocalPresence<T>) => void) {
    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
    // Skip if ShareDB connection is already closed (e.g., during shutdown)
    if (this.shareDbService.shareDbAdapter.closed) {
      this.logger.error('ShareDB connection is already closed, presence handler skipped');
      return;
    }
    presenceHandler(baseId, this.shareDbService, handler);
  }
}
