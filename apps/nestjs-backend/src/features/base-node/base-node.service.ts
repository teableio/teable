import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ANONYMOUS_USER_ID,
  generateBaseNodeId,
  getBaseNodeChannel,
  HttpErrorCode,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IBaseNodePresenceCreatePayload,
  IBaseNodePresenceDeletePayload,
  IMoveBaseNodeRo,
  IBaseNodeVo,
  IBaseNodeTreeVo,
  IBaseNodePresenceUpdatePayload,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IDuplicateTableRo,
  ICreateDashboardRo,
  ICreateFolderNodeRo,
  ICreateTableWithDefault,
  IDuplicateDashboardRo,
  IUpdateBaseNodeRo,
  IBaseNodePresenceFlushPayload,
} from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { Knex } from 'knex';
import { isString, keyBy, snakeCase } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { LocalPresence } from 'sharedb/lib/client';
import { CustomHttpException } from '../../custom.exception';
import type {
  BaseFolderUpdateEvent,
  BaseFolderDeleteEvent,
  TableDeleteEvent,
  TableUpdateEvent,
  TableCreateEvent,
  BaseFolderCreateEvent,
} from '../../event-emitter/events';
import type {
  AppCreateEvent,
  AppDeleteEvent,
  AppUpdateEvent,
} from '../../event-emitter/events/app/app.event';
import type { BaseDeleteEvent } from '../../event-emitter/events/base/base.event';
import type {
  DashboardCreateEvent,
  DashboardDeleteEvent,
  DashboardUpdateEvent,
} from '../../event-emitter/events/dashboard/dashboard.event';
import { Events } from '../../event-emitter/events/event.enum';
import type {
  WorkflowCreateEvent,
  WorkflowDeleteEvent,
  WorkflowUpdateEvent,
} from '../../event-emitter/events/workflow/workflow.event';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import { PerformanceCacheService } from '../../performance-cache/service';
import type { IPerformanceCacheStore } from '../../performance-cache/types';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { DashboardService } from '../dashboard/dashboard.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { BaseNodeFolderService } from './folder/base-node-folder.service';

type IResourceCreateEvent =
  | BaseFolderCreateEvent
  | TableCreateEvent
  | WorkflowCreateEvent
  | DashboardCreateEvent
  | AppCreateEvent;

type IResourceDeleteEvent =
  | BaseDeleteEvent
  | BaseFolderDeleteEvent
  | TableDeleteEvent
  | WorkflowDeleteEvent
  | DashboardDeleteEvent
  | AppDeleteEvent;

type IResourceUpdateEvent =
  | BaseFolderUpdateEvent
  | TableUpdateEvent
  | WorkflowUpdateEvent
  | DashboardUpdateEvent
  | AppUpdateEvent;

type IBaseNodeEntry = {
  id: string;
  baseId: string;
  parentId: string | null;
  resourceType: string;
  resourceId: string;
  order: number;
  children: { id: string; order: number }[];
  parent: { id: string } | null;
};

// max depth is maxFolderDepth + 1
const maxFolderDepth = 2;

@Injectable()
export class BaseNodeService {
  private readonly logger = new Logger(BaseNodeService.name);
  constructor(
    private readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly cls: ClsService<IClsStore>,
    private readonly shareDbService: ShareDbService,
    private readonly baseNodeFolderService: BaseNodeFolderService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly tableDuplicateService: TableDuplicateService,
    private readonly dashboardService: DashboardService
  ) {}

  private get userId() {
    return this.cls.get('user.id');
  }

  private getSelect() {
    return {
      id: true,
      baseId: true,
      parentId: true,
      resourceType: true,
      resourceId: true,
      order: true,
      children: {
        select: { id: true, order: true },
        orderBy: { order: 'asc' as const },
      },
      parent: {
        select: { id: true },
      },
    };
  }

  private async entry2vo(
    entry: IBaseNodeEntry,
    resource?: { name?: string; icon?: string | null }
  ): Promise<IBaseNodeVo> {
    const { name, icon } = resource ?? {};
    if (name) {
      return {
        ...entry,
        name,
        icon,
        resourceType: entry.resourceType as BaseNodeResourceType,
      };
    }
    const { resourceType, resourceId } = entry;
    const list = await this.getNodeResource(entry.baseId, resourceType as BaseNodeResourceType, [
      resourceId,
    ]);
    return {
      ...entry,
      name: list[0].name,
      icon: list[0].icon ?? undefined,
      resourceType: resourceType as BaseNodeResourceType,
    };
  }

  private presenceHandler<
    T =
      | IBaseNodePresenceFlushPayload
      | IBaseNodePresenceCreatePayload
      | IBaseNodePresenceUpdatePayload
      | IBaseNodePresenceDeletePayload,
  >(baseId: string, handler: (presence: LocalPresence<T>) => void) {
    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
    const channel = getBaseNodeChannel(baseId);
    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(channel);
    handler(localPresence);
    localPresence.destroy();
  }

  protected getTableResources(baseId: string, ids?: string[]) {
    return this.prismaService.tableMeta.findMany({
      where: { baseId, id: { in: ids ? ids : undefined }, deletedTime: null },
      select: {
        id: true,
        name: true,
        icon: true,
      },
    });
  }

  protected getDashboardResources(baseId: string, ids?: string[]) {
    return this.prismaService.dashboard.findMany({
      where: { baseId, id: { in: ids ? ids : undefined } },
      select: {
        id: true,
        name: true,
      },
    });
  }

  protected getFolderResources(baseId: string, ids?: string[]) {
    return this.prismaService.baseNodeFolder.findMany({
      where: { baseId, id: { in: ids ? ids : undefined } },
      select: {
        id: true,
        name: true,
      },
    });
  }

  protected async getNodeResource(
    baseId: string,
    type: BaseNodeResourceType,
    ids?: string[]
  ): Promise<Pick<IBaseNodeVo, 'id' | 'name' | 'icon'>[]> {
    switch (type) {
      case BaseNodeResourceType.Folder:
        return this.getFolderResources(baseId, ids);
      case BaseNodeResourceType.Table:
        return this.getTableResources(baseId, ids);
      case BaseNodeResourceType.Dashboard:
        return this.getDashboardResources(baseId, ids);
      default:
        throw new CustomHttpException(
          `Invalid resource type ${type}`,
          HttpErrorCode.VALIDATION_ERROR
        );
    }
  }

  protected getResourceTypes(): BaseNodeResourceType[] {
    return [
      BaseNodeResourceType.Folder,
      BaseNodeResourceType.Table,
      BaseNodeResourceType.Dashboard,
    ];
  }

  async prepareNodeList(baseId: string): Promise<IBaseNodeVo[]> {
    const resourceTypes = this.getResourceTypes();
    const resourceResults = await Promise.all(
      resourceTypes.map((type) => this.getNodeResource(baseId, type))
    );

    const resources = resourceResults.flatMap((list, index) =>
      list.map((r) => ({ ...r, type: resourceTypes[index] }))
    );

    const resourceMap = keyBy(resources, (r) => `${r.type}_${r.id}`);
    const resourceKeys = new Set(resources.map((r) => `${r.type}_${r.id}`));

    const nodes = await this.prismaService.baseNode.findMany({
      where: { baseId },
      select: this.getSelect(),
      orderBy: { order: 'asc' },
    });

    const nodeKeys = new Set(nodes.map((n) => `${n.resourceType}_${n.resourceId}`));

    const toCreate = resources.filter((r) => !nodeKeys.has(`${r.type}_${r.id}`));
    const toDelete = nodes.filter((n) => !resourceKeys.has(`${n.resourceType}_${n.resourceId}`));
    const validParentIds = new Set(nodes.filter((n) => !toDelete.includes(n)).map((n) => n.id));
    const orphans = nodes.filter(
      (n) => n.parentId && !validParentIds.has(n.parentId) && !toDelete.includes(n)
    );

    if (toCreate.length === 0 && toDelete.length === 0 && orphans.length === 0) {
      return nodes.map((entry) => {
        const key = `${entry.resourceType}_${entry.resourceId}`;
        const resource = resourceMap[key];
        return {
          ...entry,
          resourceType: entry.resourceType as BaseNodeResourceType,
          name: resource?.name,
          icon: (resource as { icon?: string })?.icon,
        };
      });
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

      // Create missing
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
      return prisma.baseNode.findMany({
        where: { baseId },
        select: this.getSelect(),
        orderBy: { order: 'asc' },
      });
    });

    return await Promise.all(
      finalMenus.map(async (entry) => {
        const key = `${entry.resourceType}_${entry.resourceId}`;
        const resource = resourceMap[key];
        return await this.entry2vo(entry, {
          name: resource?.name,
          icon: resource?.icon,
        });
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
      maxFolderDepth,
    };
  }

  async getNode(baseId: string, nodeId: string) {
    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: this.getSelect(),
      })
      .catch(() => {
        throw new CustomHttpException(`Base node ${nodeId} not found`, HttpErrorCode.NOT_FOUND);
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
    const { resourceType, parentId } = ro;

    const resource = await this.createResource(baseId, ro);
    const resourceId = resource.id;

    // Try to create menu item with correct parentId
    const maxOrder = await this.getMaxOrder(baseId);
    const entry = await this.prismaService.baseNode.create({
      data: {
        id: generateBaseNodeId(),
        baseId,
        resourceType,
        resourceId,
        order: maxOrder + 1,
        parentId,
        createdBy: this.userId,
      },
      select: this.getSelect(),
    });
    const vo = await this.entry2vo(entry, {
      name: resource.name,
      icon: resource.icon,
    });
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'create',
        data: { ...vo },
      });
    });
    return vo;
  }

  protected async createResource(
    baseId: string,
    createRo: ICreateBaseNodeRo
  ): Promise<Pick<IBaseNodeVo, 'id' | 'name' | 'icon'>> {
    const { resourceType, parentId, ...ro } = createRo;
    const parentNode = parentId ? await this.getParentNodeOrThrow(parentId) : null;
    if (parentNode && parentNode.resourceType !== BaseNodeResourceType.Folder) {
      throw new CustomHttpException('Parent must be a folder', HttpErrorCode.VALIDATION_ERROR);
    }

    if (parentNode && resourceType === BaseNodeResourceType.Folder) {
      await this.assertFolderDepth(baseId, parentNode.id);
    }

    switch (resourceType) {
      case BaseNodeResourceType.Folder: {
        const folder = await this.baseNodeFolderService.createFolder(
          baseId,
          ro as ICreateFolderNodeRo
        );
        return { id: folder.id, name: folder.name };
      }
      case BaseNodeResourceType.Table: {
        const table = await this.tableOpenApiService.createTable(
          baseId,
          ro as ICreateTableWithDefault
        );
        return { id: table.id, name: table.name, icon: table.icon };
      }
      case BaseNodeResourceType.Dashboard: {
        const dashboard = await this.dashboardService.createDashboard(
          baseId,
          ro as ICreateDashboardRo
        );
        return { id: dashboard.id, name: dashboard.name };
      }
      default:
        throw new CustomHttpException(
          `Invalid resource type ${resourceType}`,
          HttpErrorCode.VALIDATION_ERROR
        );
    }
  }

  async duplicate(baseId: string, nodeId: string, ro: IDuplicateBaseNodeRo) {
    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND);
      });
    const { resourceType, resourceId } = node;

    if (resourceType === BaseNodeResourceType.Folder) {
      throw new CustomHttpException('Cannot duplicate folder', HttpErrorCode.VALIDATION_ERROR);
    }

    const resource = await this.duplicateResource(
      baseId,
      resourceType as BaseNodeResourceType,
      resourceId,
      ro
    );

    const maxOrder = await this.getMaxOrder(baseId);
    const entry = await this.prismaService.baseNode.create({
      data: {
        id: generateBaseNodeId(),
        baseId,
        resourceType,
        resourceId: resource.id,
        order: maxOrder + 1,
        parentId: node.parentId,
        createdBy: this.userId,
      },
      select: this.getSelect(),
    });
    const vo = await this.entry2vo(entry, {
      name: resource.name,
      icon: resource.icon,
    });
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'create',
        data: { ...vo },
      });
    });
    return vo;
  }

  protected async duplicateResource(
    baseId: string,
    type: BaseNodeResourceType,
    id: string,
    duplicateRo: IDuplicateBaseNodeRo
  ): Promise<Pick<IBaseNodeVo, 'id' | 'name' | 'icon'>> {
    switch (type) {
      case BaseNodeResourceType.Table: {
        const table = await this.tableDuplicateService.duplicateTable(
          baseId,
          id,
          duplicateRo as IDuplicateTableRo
        );
        return { id: table.id, name: table.name, icon: table.icon ?? undefined };
      }
      case BaseNodeResourceType.Dashboard: {
        const dashboard = await this.dashboardService.duplicateDashboard(
          baseId,
          id,
          duplicateRo as IDuplicateDashboardRo
        );
        return { id: dashboard.id, name: dashboard.name };
      }
      default:
        throw new CustomHttpException(
          `Invalid resource type ${type}`,
          HttpErrorCode.VALIDATION_ERROR
        );
    }
  }

  async update(baseId: string, nodeId: string, ro: IUpdateBaseNodeRo) {
    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: this.getSelect(),
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND);
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
        data: { ...vo },
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
    const { name, icon } = updateRo;
    switch (type) {
      case BaseNodeResourceType.Folder:
        if (name) {
          await this.baseNodeFolderService.renameFolder(baseId, id, { name });
        }
        break;
      case BaseNodeResourceType.Table:
        if (name) {
          await this.tableOpenApiService.updateName(baseId, id, name);
        }
        if (icon) {
          await this.tableOpenApiService.updateIcon(baseId, id, icon);
        }
        break;
      case BaseNodeResourceType.Dashboard:
        if (name) {
          await this.dashboardService.renameDashboard(baseId, id, name);
        }
        break;
      default:
        throw new CustomHttpException(
          `Invalid resource type ${type}`,
          HttpErrorCode.VALIDATION_ERROR
        );
    }
  }

  async delete(baseId: string, nodeId: string) {
    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND);
      });
    if (node.resourceType === BaseNodeResourceType.Folder) {
      const children = await this.prismaService.baseNode.findMany({
        where: { baseId, parentId: nodeId },
      });
      if (children.length > 0) {
        throw new CustomHttpException('Folder is not empty', HttpErrorCode.VALIDATION_ERROR);
      }
    }
    await this.deleteResource(baseId, node.resourceType as BaseNodeResourceType, node.resourceId);
    await this.prismaService.baseNode.delete({
      where: { id: nodeId },
    });

    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'delete',
        data: { id: nodeId },
      });
    });
  }

  protected async deleteResource(baseId: string, type: BaseNodeResourceType, id: string) {
    switch (type) {
      case BaseNodeResourceType.Folder:
        await this.baseNodeFolderService.deleteFolder(baseId, id);
        break;
      case BaseNodeResourceType.Table:
        await this.tableOpenApiService.deleteTable(baseId, id);
        break;
      case BaseNodeResourceType.Dashboard:
        await this.dashboardService.deleteDashboard(baseId, id);
        break;
      default:
        throw new CustomHttpException(
          `Invalid resource type ${type}`,
          HttpErrorCode.VALIDATION_ERROR
        );
    }
  }

  async move(baseId: string, nodeId: string, ro: IMoveBaseNodeRo): Promise<IBaseNodeVo> {
    const { parentId, anchorId, position } = ro;

    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND);
      });

    if (isString(parentId) && isString(anchorId)) {
      throw new CustomHttpException(
        'Only one of parentId or anchorId must be provided',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    if (parentId === nodeId) {
      throw new CustomHttpException('Cannot move node to itself', HttpErrorCode.VALIDATION_ERROR);
    }

    if (anchorId === nodeId) {
      throw new CustomHttpException(
        'Cannot move node to its own child (circular reference)',
        HttpErrorCode.VALIDATION_ERROR
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
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const vo = await this.entry2vo(newNode);
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'update',
        data: { ...vo },
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
      const parentNode = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: parentId },
        })
        .catch(() => {
          throw new CustomHttpException(`Parent ${parentId} not found`, HttpErrorCode.NOT_FOUND);
        });

      if (parentNode.resourceType !== BaseNodeResourceType.Folder) {
        throw new CustomHttpException(
          `Parent ${parentId} is not a folder`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }

      // Check for circular reference
      const isCircular = await this.isCircularReference(baseId, nodeId, parentId);
      if (isCircular) {
        throw new CustomHttpException(
          'Cannot move node to its own child (circular reference)',
          HttpErrorCode.VALIDATION_ERROR
        );
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
          throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND);
        });

      const anchor = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: anchorId },
        })
        .catch(() => {
          throw new CustomHttpException(`Anchor ${anchorId} not found`, HttpErrorCode.NOT_FOUND);
        });

      if (node.resourceType === BaseNodeResourceType.Folder && anchor.parentId) {
        await this.assertFolderDepth(baseId, anchor.parentId);
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

  @OnEvent(Events.BASE_FOLDER_CREATE)
  @OnEvent(Events.TABLE_CREATE)
  @OnEvent(Events.DASHBOARD_CREATE)
  @OnEvent(Events.WORKFLOW_CREATE)
  @OnEvent(Events.APP_CREATE)
  async onResourceCreate(event: IResourceCreateEvent) {
    const { baseId, resourceType, resourceId, userId } = this.prepareResourceCreate(event);

    if (!baseId || !resourceType || !resourceId) {
      this.logger.error('Invalid resource create event', event);
      return;
    }

    const createNode = async (prisma: PrismaService) => {
      const findNode = await prisma.baseNode.findFirst({
        where: { baseId, resourceType, resourceId },
      });
      if (findNode) {
        return;
      }
      const maxOrder = await this.getMaxOrder(baseId);
      await prisma.baseNode.create({
        data: {
          id: generateBaseNodeId(),
          baseId,
          resourceType,
          resourceId,
          parentId: null,
          order: maxOrder + 1,
          createdBy: userId || ANONYMOUS_USER_ID,
        },
      });
    };
    await createNode(this.prismaService);

    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'flush',
      });
    });
  }

  private prepareResourceCreate(event: IResourceCreateEvent) {
    let baseId: string;
    let resourceType: BaseNodeResourceType | undefined;
    let resourceId: string | undefined;
    let name: string | undefined;
    let icon: string | undefined;
    switch (event.name) {
      case Events.BASE_FOLDER_CREATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Folder;
        resourceId = event.payload.folder.id;
        name = event.payload.folder.name;
        break;
      case Events.TABLE_CREATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Table;
        // get the table id from the table op
        resourceId = (event.payload.table as unknown as { id: string }).id;
        name = event.payload.table.name;
        icon = event.payload.table.icon;
        break;
      case Events.WORKFLOW_CREATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Workflow;
        resourceId = event.payload.workflow.id;
        name = event.payload.workflow.name;
        break;
      case Events.DASHBOARD_CREATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Dashboard;
        resourceId = event.payload.dashboard.id;
        name = event.payload.dashboard.name;
        break;
      case Events.APP_CREATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.App;
        resourceId = event.payload.app.id;
        name = event.payload.app.name;
        break;
    }
    return {
      baseId,
      resourceType,
      resourceId,
      name,
      icon,
      userId: event.context.user?.id,
    };
  }

  @OnEvent(Events.BASE_FOLDER_UPDATE)
  @OnEvent(Events.TABLE_UPDATE)
  @OnEvent(Events.DASHBOARD_UPDATE)
  @OnEvent(Events.WORKFLOW_UPDATE)
  @OnEvent(Events.APP_UPDATE)
  async onResourceUpdate(event: IResourceUpdateEvent) {
    const { baseId, resourceType, resourceId } = this.prepareResourceUpdate(event);
    if (baseId && resourceType && resourceId) {
      this.presenceHandler(baseId, (presence) => {
        presence.submit({
          event: 'flush',
        });
      });
    }
  }

  private prepareResourceUpdate(event: IResourceUpdateEvent) {
    let baseId: string;
    let resourceType: BaseNodeResourceType | undefined;
    let resourceId: string | undefined;
    let name: string | undefined;
    let icon: string | undefined;
    switch (event.name) {
      case Events.TABLE_UPDATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Table;
        resourceId = event.payload.table.id;
        name = event.payload.table?.name?.newValue as string;
        icon = event.payload.table?.icon?.newValue as string;
        break;
      case Events.WORKFLOW_UPDATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Workflow;
        resourceId = event.payload.workflow.id;
        name = event.payload.workflow.name;
        break;
      case Events.DASHBOARD_UPDATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Dashboard;
        resourceId = event.payload.dashboard.id;
        name = event.payload.dashboard.name;
        break;
      case Events.APP_UPDATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.App;
        resourceId = event.payload.app.id;
        name = event.payload.app.name;
        break;
      case Events.BASE_FOLDER_UPDATE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Folder;
        resourceId = event.payload.folder.id;
        name = event.payload.folder.name;
        break;
    }
    return {
      baseId,
      resourceType,
      resourceId,
      name,
      icon,
    };
  }

  @OnEvent(Events.BASE_DELETE)
  @OnEvent(Events.BASE_FOLDER_DELETE)
  @OnEvent(Events.TABLE_DELETE)
  @OnEvent(Events.DASHBOARD_DELETE)
  @OnEvent(Events.WORKFLOW_DELETE)
  @OnEvent(Events.APP_DELETE)
  async onResourceDelete(event: IResourceDeleteEvent) {
    const { baseId, resourceType, resourceId } = this.prepareResourceDelete(event);
    if (!baseId) {
      return;
    }
    if (event.name === Events.BASE_DELETE) {
      await this.prismaService.baseNode.deleteMany({
        where: { baseId },
      });
      return;
    }
    if (!resourceType || !resourceId) {
      this.logger.error('Invalid resource delete event', event);
      return;
    }

    const deleteNode = async (prisma: PrismaService) => {
      const toDeleteNode = await prisma.baseNode.findFirst({
        where: { baseId, resourceType, resourceId },
      });
      if (!toDeleteNode) {
        return;
      }
      const maxOrder = await this.getMaxOrder(baseId);
      await prisma.baseNode.delete({
        where: { id: toDeleteNode.id },
      });
      const orphans = await prisma.baseNode.findMany({
        where: { baseId, parentId: toDeleteNode.parentId },
        select: { id: true, order: true },
      });
      if (orphans.length > 0) {
        await this.batchUpdateBaseNodes(
          orphans.map((orphan) => ({
            id: orphan.id,
            values: {
              parentId: null,
              order: maxOrder + orphan.order + 1,
            },
          }))
        );
      }
    };
    await deleteNode(this.prismaService);

    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'flush',
      });
    });
  }

  private prepareResourceDelete(event: IResourceDeleteEvent) {
    let baseId: string;
    let resourceType: BaseNodeResourceType | undefined;
    let resourceId: string | undefined;
    switch (event.name) {
      case Events.BASE_DELETE:
        baseId = event.payload.baseId;
        break;
      case Events.TABLE_DELETE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Table;
        resourceId = event.payload.tableId;
        break;
      case Events.WORKFLOW_DELETE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Workflow;
        resourceId = event.payload.workflowId;
        break;
      case Events.DASHBOARD_DELETE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Dashboard;
        resourceId = event.payload.dashboardId;
        break;
      case Events.APP_DELETE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.App;
        resourceId = event.payload.appId;
        break;
      case Events.BASE_FOLDER_DELETE:
        baseId = event.payload.baseId;
        resourceType = BaseNodeResourceType.Folder;
        resourceId = event.payload.folderId;
        break;
    }
    return {
      baseId,
      resourceType,
      resourceId,
    };
  }

  private async getMaxOrder(baseId: string, parentId?: string | null) {
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
      throw new CustomHttpException('Base node not found', HttpErrorCode.NOT_FOUND);
    }
    return entry;
  }

  private async assertFolderDepth(baseId: string, id: string) {
    const folderDepth = await this.getFolderDepth(baseId, id);
    console.log('folderDepth', folderDepth, 'maxFolderDepth', maxFolderDepth);
    if (folderDepth >= maxFolderDepth) {
      throw new CustomHttpException('Folder depth exceeded', HttpErrorCode.VALIDATION_ERROR);
    }
  }

  private async getFolderDepth(baseId: string, id: string) {
    const prisma = this.prismaService.txClient();
    const allFolders = await prisma.baseNode.findMany({
      where: { baseId, resourceType: BaseNodeResourceType.Folder },
      select: { id: true, parentId: true },
    });

    let depth = 0;
    if (allFolders.length === 0) {
      return depth;
    }

    const folderMap = keyBy(allFolders, 'id');
    let current = id;
    while (current) {
      depth++;
      const folder = folderMap[current];
      if (!folder) {
        throw new CustomHttpException('Folder not found', HttpErrorCode.NOT_FOUND);
      }
      if (folder.parentId === id) {
        throw new CustomHttpException('Folder is itself', HttpErrorCode.VALIDATION_ERROR);
      }
      current = folder.parentId ?? '';
    }
    return depth;
  }

  private async isCircularReference(
    baseId: string,
    nodeId: string,
    parentId: string
  ): Promise<boolean> {
    const knex = this.knex;

    // Non-recursive query: Start with the parent node
    const nonRecursiveQuery = knex
      .select('id', 'parent_id', 'base_id')
      .from('base_node')
      .where('id', parentId)
      .andWhere('base_id', baseId);

    // Recursive query: Traverse up the parent chain
    const recursiveQuery = knex
      .select('bn.id', 'bn.parent_id', 'bn.base_id')
      .from('base_node as bn')
      .innerJoin('ancestors as a', function () {
        // Join condition: bn.id = a.parent_id (get parent of current ancestor)
        this.on('bn.id', '=', 'a.parent_id').andOn('bn.base_id', '=', knex.raw('?', [baseId]));
      });

    // Combine non-recursive and recursive queries
    const cteQuery = nonRecursiveQuery.union(recursiveQuery);

    // Build final query with recursive CTE
    const finalQuery = knex
      .withRecursive('ancestors', ['id', 'parent_id', 'base_id'], cteQuery)
      .select('id')
      .from('ancestors')
      .where('id', nodeId)
      .limit(1)
      .toQuery();

    // Execute query
    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<Array<{ id: string }>>(finalQuery);

    return result.length > 0;
  }

  private async batchUpdateBaseNodes(data: { id: string; values: { [key: string]: unknown } }[]) {
    const sql = this.buildBatchUpdateSql(data);
    if (!sql) {
      return;
    }
    await this.prismaService.txClient().$executeRawUnsafe(sql);
  }

  buildBatchUpdateSql(data: { id: string; values: { [key: string]: unknown } }[]): string | null {
    if (data.length === 0) {
      return null;
    }

    const caseStatements: Record<string, { when: string; then: unknown }[]> = {};
    for (const { id, values } of data) {
      for (const [key, value] of Object.entries(values)) {
        if (!caseStatements[key]) {
          caseStatements[key] = [];
        }
        caseStatements[key].push({ when: id, then: value });
      }
    }

    const updatePayload: Record<string, Knex.Raw> = {};
    for (const [key, statements] of Object.entries(caseStatements)) {
      if (statements.length === 0) {
        continue;
      }
      const column = snakeCase(key);
      const whenClauses: string[] = [];
      const caseBindings: unknown[] = [];
      for (const { when, then } of statements) {
        whenClauses.push('WHEN ?? = ? THEN ?');
        caseBindings.push('id', when, then);
      }
      const caseExpression = `CASE ${whenClauses.join(' ')} ELSE ?? END`;
      const rawExpression = this.knex.raw(caseExpression, [...caseBindings, column]);
      updatePayload[column] = rawExpression;
    }

    if (Object.keys(updatePayload).length === 0) {
      return null;
    }

    const idsToUpdate = data.map((item) => item.id);
    return this.knex('base_node').update(updatePayload).whereIn('id', idsToUpdate).toQuery();
  }
}
