import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import { ResourceType } from '@teable/openapi';
import type { SpaceDeleteEvent, BaseDeleteEvent, TableDeleteEvent } from '../events';
import { Events } from '../events';

@Injectable()
export class TrashListener {
  constructor(private readonly prismaService: PrismaService) {}

  @OnEvent(Events.SPACE_DELETE, { async: true })
  @OnEvent(Events.BASE_DELETE, { async: true })
  @OnEvent(Events.TABLE_DELETE, { async: true })
  async spaceDeleteListener(event: SpaceDeleteEvent | BaseDeleteEvent | TableDeleteEvent) {
    const { name, payload, context } = event;
    const { user } = context;
    let resourceId: string;
    let resourceType: ResourceType;
    let deletedTime: Date | null = null;
    let parentId: string | undefined;

    switch (name) {
      case Events.SPACE_DELETE: {
        resourceId = payload.spaceId;
        resourceType = ResourceType.Space;
        const space = await this.prismaService.space.findUniqueOrThrow({
          where: { id: resourceId },
          select: { id: true, deletedTime: true },
        });
        deletedTime = space.deletedTime;
        break;
      }
      case Events.BASE_DELETE: {
        resourceId = payload.baseId;
        resourceType = ResourceType.Base;
        const base = await this.prismaService.base.findUniqueOrThrow({
          where: { id: resourceId },
          select: { id: true, spaceId: true, deletedTime: true },
        });
        deletedTime = base.deletedTime;
        parentId = base?.spaceId;
        break;
      }
      case Events.TABLE_DELETE: {
        resourceId = payload.tableId;
        resourceType = ResourceType.Table;
        const space = await this.prismaService.tableMeta.findUniqueOrThrow({
          where: { id: resourceId },
          select: { id: true, baseId: true, deletedTime: true },
        });
        deletedTime = space.deletedTime;
        parentId = space?.baseId;
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
