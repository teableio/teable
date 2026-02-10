import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import { ResourceType } from '@teable/openapi';
import type {
  SpaceDeleteEvent,
  BaseDeleteEvent,
  TableDeleteEvent,
  AppDeleteEvent,
  WorkflowDeleteEvent,
} from '../events';
import { Events } from '../events';

@Injectable()
export class TrashListener {
  constructor(private readonly prismaService: PrismaService) {}

  @OnEvent(Events.SPACE_DELETE, { async: true })
  @OnEvent(Events.BASE_DELETE, { async: true })
  @OnEvent(Events.TABLE_DELETE, { async: true })
  @OnEvent(Events.APP_DELETE, { async: true })
  @OnEvent(Events.WORKFLOW_DELETE, { async: true })
  async onEvent(
    event:
      | SpaceDeleteEvent
      | BaseDeleteEvent
      | TableDeleteEvent
      | AppDeleteEvent
      | WorkflowDeleteEvent
  ) {
    const { name, payload } = event;
    const { user } = event.context;
    let resourceId: string;
    let resourceType: ResourceType;
    let deletedTime: Date | undefined | null;
    let parentId: string | undefined;

    if ('permanent' in payload && payload.permanent) {
      return;
    }

    switch (name) {
      case Events.SPACE_DELETE: {
        resourceId = payload.spaceId;
        resourceType = ResourceType.Space;
        const space = await this.prismaService.space.findUnique({
          where: { id: resourceId },
          select: { id: true, deletedTime: true },
        });
        deletedTime = space?.deletedTime;
        break;
      }
      case Events.BASE_DELETE: {
        resourceId = payload.baseId;
        resourceType = ResourceType.Base;
        const base = await this.prismaService.base.findUnique({
          where: { id: resourceId },
          select: { id: true, spaceId: true, deletedTime: true },
        });
        deletedTime = base?.deletedTime;
        parentId = base?.spaceId;
        break;
      }
      case Events.TABLE_DELETE: {
        resourceId = payload.tableId;
        resourceType = ResourceType.Table;
        const table = await this.prismaService.tableMeta.findUnique({
          where: { id: resourceId },
          select: { id: true, baseId: true, deletedTime: true },
        });
        deletedTime = table?.deletedTime;
        parentId = table?.baseId;
        break;
      }
      case Events.APP_DELETE: {
        resourceId = payload.appId;
        resourceType = ResourceType.App;
        const app = await this.prismaService.app.findUnique({
          where: { id: resourceId },
          select: { id: true, baseId: true, deletedTime: true },
        });
        deletedTime = app?.deletedTime;
        parentId = app?.baseId;
        break;
      }
      case Events.WORKFLOW_DELETE: {
        resourceId = payload.workflowId;
        resourceType = ResourceType.Workflow;
        const workflow = await this.prismaService.workflow.findUnique({
          where: { id: resourceId },
          select: { id: true, baseId: true, deletedTime: true },
        });
        deletedTime = workflow?.deletedTime;
        parentId = workflow?.baseId;
        break;
      }
    }

    if (!deletedTime) return;

    await this.prismaService.trash.create({
      data: {
        resourceId,
        resourceType,
        parentId,
        deletedTime,
        deletedBy: user?.id as string,
      },
    });
  }
}
