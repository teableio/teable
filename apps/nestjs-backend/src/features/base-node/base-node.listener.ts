import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseNodePresenceFlushPayload } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { LocalPresence } from 'sharedb/lib/client';
import type { BaseDeleteEvent } from '../../event-emitter/events/base/base.event';
import { Events } from '../../event-emitter/events/event.enum';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import { PerformanceCacheService } from '../../performance-cache/service';
import type { IPerformanceCacheStore } from '../../performance-cache/types';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { RESOURCE_DESCRIPTORS } from '../resource/resource-descriptor';
import { presenceHandler } from './helper';

enum NodeChange {
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
}

type INodeResourceEvent = { name: string; payload: Record<string, unknown> & { baseId?: string } };

/**
 * Tells a project's clients to reload its node tree when a resource behind a node changes. It
 * subscribes at startup to the events each kind's descriptor names.
 */
@Injectable()
export class BaseNodeListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(BaseNodeListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    private readonly shareDbService: ShareDbService,
    private readonly cls: ClsService<IClsStore & { ignoreBaseNodeListener?: boolean }>,
    private readonly eventEmitter: EventEmitter2
  ) {}

  private getIgnoreBaseNodeListener() {
    return this.cls.get('ignoreBaseNodeListener');
  }

  onApplicationBootstrap() {
    for (const { nodeEvents } of Object.values(RESOURCE_DESCRIPTORS)) {
      if (!nodeEvents) continue;
      for (const change of Object.values(NodeChange)) {
        // As @OnEvent does: a failure is logged, never thrown at whoever emitted the event.
        this.eventEmitter.on(
          nodeEvents[change],
          (event: INodeResourceEvent) =>
            this.onResourceChange(change, nodeEvents.payloadKey, event).catch((error: Error) =>
              this.logger.error(error.message, error.stack)
            ),
          { async: true }
        );
      }
    }
  }

  private async onResourceChange(change: NodeChange, key: string, event: INodeResourceEvent) {
    if (this.getIgnoreBaseNodeListener()) {
      return;
    }
    const { payload } = event;
    const named = (payload[key] as { id?: string } | undefined)?.id;
    const resourceId =
      change === NodeChange.Delete
        ? (payload[`${key}Id`] as string | undefined)
        : change === NodeChange.Create
          ? (named ?? (payload[`${key}Id`] as string | undefined))
          : named;
    const { baseId } = payload;
    if (!baseId || !resourceId) {
      // An update without them names nothing to show; the others should always carry them.
      if (change !== NodeChange.Update) {
        this.logger.error(`Invalid resource ${change} event`, event);
      }
      return;
    }

    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'flush',
      });
    });
  }

  // The share-base copy path writes base_node rows with raw SQL and emits none of the
  // per-resource events above, so the cached node list of an existing target base would
  // stay stale and the saved nodes stay invisible until an unrelated change flushes it.
  @OnEvent(Events.BASE_SHARE_COPY_COMPLETE, { async: true })
  async onBaseShareCopyComplete(payload: { baseId: string }) {
    const baseId = payload?.baseId;
    if (!baseId) {
      this.logger.error('Invalid base share copy complete event', payload);
      return;
    }

    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'flush',
      });
    });
  }

  @OnEvent(Events.BASE_DELETE, { async: true })
  async onBaseDelete(event: BaseDeleteEvent) {
    if (this.getIgnoreBaseNodeListener()) {
      return;
    }
    const { baseId } = event.payload;
    if (!baseId) {
      return;
    }
    await this.prismaService.baseNode.deleteMany({
      where: { baseId },
    });
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
