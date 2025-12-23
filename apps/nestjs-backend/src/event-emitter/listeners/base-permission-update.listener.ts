import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { getBasePermissionUpdateChannel } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ShareDbService } from '../../share-db/share-db.service';
import { EventEmitterService } from '../event-emitter.service';
import { Events, BasePermissionUpdateEvent } from '../events';
import { CollaboratorUpdateEvent } from '../events/space/collaborator.event';

@Injectable()
export class BasePermissionUpdateListener {
  private readonly logger = new Logger(BasePermissionUpdateListener.name);

  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly prismaService: PrismaService,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  @OnEvent(Events.BASE_PERMISSION_UPDATE, { async: true })
  async basePermissionUpdateListener(listenerEvent: BasePermissionUpdateEvent) {
    const {
      payload: { baseId },
      context: { user },
    } = listenerEvent;
    const space = await this.prismaService.base.findUnique({
      where: {
        id: baseId,
      },
      select: {
        spaceId: true,
      },
    });

    if (space?.spaceId) {
      this.eventEmitterService.emitAsync(
        Events.COLLABORATOR_UPDATE,
        new CollaboratorUpdateEvent(space.spaceId)
      );
    }

    const channel = getBasePermissionUpdateChannel(baseId);
    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create();

    // Include the operator user ID in the message to allow filtering on the client side
    localPresence.submit(user?.id, (error) => {
      error && this.logger.error(error);
    });
  }
}
