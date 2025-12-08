import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { generateBaseNodeId, ANONYMOUS_USER_ID, getBaseNodeChannel } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import type {
  IBaseNodePresenceCreatePayload,
  IBaseNodePresenceDeletePayload,
  IBaseNodePresenceFlushPayload,
  IBaseNodePresenceUpdatePayload,
} from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import type { LocalPresence } from 'sharedb/lib/client';
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
import { buildBatchUpdateSql } from './helper';

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

@Injectable()
export class BaseNodeListener {
  private readonly logger = new Logger(BaseNodeListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    private readonly shareDbService: ShareDbService
  ) {}

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

    const deleteNode = async (prisma: Prisma.TransactionClient) => {
      const toDeleteNode = await prisma.baseNode.findFirst({
        where: { baseId, resourceType, resourceId },
      });
      if (!toDeleteNode) {
        return;
      }
      await prisma.baseNode.deleteMany({
        where: { id: toDeleteNode.id },
      });
      const maxOrder = await this.getMaxOrder(baseId);
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

  presenceHandler<
    T =
      | IBaseNodePresenceFlushPayload
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
    const channel = getBaseNodeChannel(baseId);
    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(channel);
    handler(localPresence);
    localPresence.destroy();
  }

  async getMaxOrder(baseId: string, parentId?: string | null) {
    const prisma = this.prismaService.txClient();
    const aggregate = await prisma.baseNode.aggregate({
      where: { baseId, parentId },
      _max: { order: true },
    });

    return aggregate._max.order ?? 0;
  }

  async batchUpdateBaseNodes(data: { id: string; values: { [key: string]: unknown } }[]) {
    const sql = buildBatchUpdateSql(this.knex, data);
    if (!sql) {
      return;
    }
    await this.prismaService.$executeRawUnsafe(sql);
  }
}
