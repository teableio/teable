import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseNodePresenceFlushPayload } from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
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
import type { IClsStore } from '../../types/cls';
import { presenceHandler } from './helper';

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
    private readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    private readonly shareDbService: ShareDbService,
    private readonly cls: ClsService<IClsStore & { ignoreBaseNodeListener?: boolean }>
  ) {}

  private getIgnoreBaseNodeListener() {
    return this.cls.get('ignoreBaseNodeListener');
  }

  @OnEvent(Events.BASE_FOLDER_CREATE, { async: true })
  @OnEvent(Events.TABLE_CREATE, { async: true })
  @OnEvent(Events.DASHBOARD_CREATE, { async: true })
  @OnEvent(Events.WORKFLOW_CREATE, { async: true })
  @OnEvent(Events.APP_CREATE, { async: true })
  async onResourceCreate(event: IResourceCreateEvent) {
    const ignoreBaseNodeListener = this.getIgnoreBaseNodeListener();
    if (ignoreBaseNodeListener) {
      return;
    }

    const { baseId, resourceType, resourceId } = this.prepareResourceCreate(event);
    if (!baseId || !resourceType || !resourceId) {
      this.logger.error('Invalid resource create event', event);
      return;
    }

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

  @OnEvent(Events.BASE_FOLDER_UPDATE, { async: true })
  @OnEvent(Events.TABLE_UPDATE, { async: true })
  @OnEvent(Events.DASHBOARD_UPDATE, { async: true })
  @OnEvent(Events.WORKFLOW_UPDATE, { async: true })
  @OnEvent(Events.APP_UPDATE, { async: true })
  async onResourceUpdate(event: IResourceUpdateEvent) {
    const ignoreBaseNodeListener = this.getIgnoreBaseNodeListener();
    if (ignoreBaseNodeListener) {
      return;
    }

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

  @OnEvent(Events.BASE_DELETE, { async: true })
  @OnEvent(Events.BASE_FOLDER_DELETE, { async: true })
  @OnEvent(Events.TABLE_DELETE, { async: true })
  @OnEvent(Events.DASHBOARD_DELETE, { async: true })
  @OnEvent(Events.WORKFLOW_DELETE, { async: true })
  @OnEvent(Events.APP_DELETE, { async: true })
  async onResourceDelete(event: IResourceDeleteEvent) {
    const ignoreBaseNodeListener = this.getIgnoreBaseNodeListener();
    if (ignoreBaseNodeListener) {
      return;
    }

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

  private presenceHandler<T = IBaseNodePresenceFlushPayload>(
    baseId: string,
    handler: (presence: LocalPresence<T>) => void
  ) {
    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
    // Skip if ShareDB connection is already closed (e.g., during shutdown)
    if (this.shareDbService.shareDbAdapter.closed) {
      this.logger.error('ShareDB connection is already closed, presence handler skipped');
      return;
    }
    presenceHandler(baseId, this.shareDbService, handler);
  }
}
