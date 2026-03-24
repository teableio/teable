import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { IBaseNodePresenceFlushPayload } from '@teable/openapi';
import {
  ProjectionHandler,
  TableCreated,
  ok,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type Result,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { PerformanceCacheService } from '../../performance-cache';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import { ShareDbService } from '../../share-db/share-db.service';
import { presenceHandler } from '../base-node/helper';
import { V2ContainerService } from './v2-container.service';
import type { IV2ProjectionRegistrar } from './v2-projection-registrar';

@ProjectionHandler(TableCreated)
class V2TableCreatedBaseNodeProjection implements IEventHandler<TableCreated> {
  constructor(
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly shareDbService: ShareDbService
  ) {}

  async handle(
    _context: IExecutionContext,
    event: TableCreated
  ): Promise<Result<void, DomainError>> {
    const baseId = event.baseId.toString();
    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));

    if (this.shareDbService.shareDbAdapter.closed) {
      return ok(undefined);
    }

    presenceHandler<IBaseNodePresenceFlushPayload>(baseId, this.shareDbService, (presence) => {
      presence.submit({
        event: 'flush',
      });
    });

    return ok(undefined);
  }
}

@Injectable()
export class V2BaseNodeCompatService implements IV2ProjectionRegistrar, OnModuleInit {
  private readonly logger = new Logger(V2BaseNodeCompatService.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly shareDbService: ShareDbService
  ) {}

  onModuleInit(): void {
    this.v2ContainerService.addProjectionRegistrar(this);
  }

  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 base-node compatibility projections');

    container.registerInstance(
      V2TableCreatedBaseNodeProjection,
      new V2TableCreatedBaseNodeProjection(this.performanceCacheService, this.shareDbService)
    );
  }
}
