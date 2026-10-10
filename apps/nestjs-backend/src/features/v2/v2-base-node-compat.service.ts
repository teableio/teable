import { Injectable, Logger } from '@nestjs/common';
import type { IBaseNodePresenceFlushPayload } from '@teable/openapi';
import {
  ProjectionHandler,
  TableCreated,
  TableDeleted,
  TablePropertiesUpdated,
  TableRenamed,
  TableRestored,
  TableTrashed,
  ok,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type Result,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import { PerformanceCacheService } from '../../performance-cache';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { presenceHandler } from '../base-node/helper';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

type TableTreeEvent =
  | TableCreated
  | TableTrashed
  | TableDeleted
  | TableRestored
  | TableRenamed
  | TablePropertiesUpdated;

// The directory tree shows a table's name and icon too: a rename or an icon change made
// through V2 has to reach it the way the legacy path's ops did, or the app's header keeps
// the old name until the tree is next loaded.
@ProjectionHandler(TableCreated)
@ProjectionHandler(TableTrashed)
@ProjectionHandler(TableDeleted)
@ProjectionHandler(TableRestored)
@ProjectionHandler(TableRenamed)
@ProjectionHandler(TablePropertiesUpdated)
export class V2TableBaseNodeProjection implements IEventHandler<TableTreeEvent> {
  constructor(
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly shareDbService: ShareDbService,
    private readonly cls: ClsService<IClsStore & { ignoreBaseNodeListener?: boolean }>
  ) {}

  async handle(
    _context: IExecutionContext,
    event: TableTreeEvent
  ): Promise<Result<void, DomainError>> {
    const ignoreBaseNodeListener = this.cls.get('ignoreBaseNodeListener');
    if (ignoreBaseNodeListener) {
      return ok(undefined);
    }
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

@V2ProjectionRegistrar()
@Injectable()
export class V2BaseNodeCompatService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2BaseNodeCompatService.name);

  constructor(
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly shareDbService: ShareDbService,
    private readonly cls: ClsService<IClsStore & { ignoreBaseNodeListener?: boolean }>
  ) {}

  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 base-node compatibility projections');

    container.registerInstance(
      V2TableBaseNodeProjection,
      new V2TableBaseNodeProjection(this.performanceCacheService, this.shareDbService, this.cls)
    );
  }
}
