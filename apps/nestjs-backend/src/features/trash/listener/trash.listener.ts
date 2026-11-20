import type { OnApplicationBootstrap } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import type { IEventContext } from '../../../event-emitter/events';
import { RESOURCE_DESCRIPTORS } from '../../resource/resource-descriptor';
import type { ITrashRecordedHandler } from '../resource/trash-resource-handler';

/**
 * The kinds whose delete events an edition's trash module records. Each edition lists only its
 * own: the EE app also loads the community trash module, and the two lists never overlap, so a
 * delete event is recorded once.
 */
export const TRASH_RECORDED_HANDLERS = Symbol('TRASH_RECORDED_HANDLERS');

type ITrashDeleteEvent = {
  payload: Record<string, unknown> & { permanent?: boolean };
  context: IEventContext;
};

/** Writes the trash entry a soft delete leaves, on the delete event its descriptor names. */
@Injectable()
export class TrashListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(TrashListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(TRASH_RECORDED_HANDLERS) private readonly handlers: ITrashRecordedHandler[]
  ) {}

  onApplicationBootstrap() {
    for (const handler of this.handlers) {
      const trashedBy = RESOURCE_DESCRIPTORS[handler.type].trashedBy;
      if (!trashedBy) continue;
      // As @OnEvent does: a failure is logged, never thrown at the delete that emitted the event.
      this.eventEmitter.on(
        trashedBy.event,
        (event: ITrashDeleteEvent) =>
          this.record(handler, trashedBy.idKey, event).catch((error: Error) =>
            this.logger.error(error.message, error.stack)
          ),
        { async: true }
      );
    }
  }

  private async record(handler: ITrashRecordedHandler, idKey: string, event: ITrashDeleteEvent) {
    const { payload, context } = event;
    if (payload.permanent) return;
    const resourceId = payload[idKey] as string;
    const trashed = await handler.findTrashed(resourceId);
    const deletedTime = trashed?.deletedTime;
    if (!deletedTime) return;

    // Delete events can fire more than once for the same resource (e.g. soft delete
    // followed by permanent delete), so recording the trash entry must be idempotent.
    await this.prismaService.trash.upsert({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        resourceType_resourceId: { resourceType: handler.type, resourceId },
      },
      create: {
        resourceId,
        resourceType: handler.type,
        parentId: trashed.parentId,
        deletedTime,
        deletedBy: context.user?.id as string,
      },
      update: {
        deletedTime,
        deletedBy: context.user?.id as string,
      },
    });
  }
}
