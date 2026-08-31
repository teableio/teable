import { Injectable, Logger } from '@nestjs/common';
import { ShortLinkType } from '@teable/openapi';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ok,
  ProjectionHandler,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type Result,
  ViewShareDisabled,
  ViewShareIdRefreshed,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Kysely } from 'kysely';

import { PerformanceCacheService } from '../../performance-cache';
import { generateShortLinkCacheKey } from '../../performance-cache/generate-keys';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

/* eslint-disable @typescript-eslint/naming-convention */
type IV2ViewShareSideEffectDb = {
  short_link: {
    code: string;
    type: string;
    resource_id: string;
    deleted_time: Date | null;
  };
};
/* eslint-enable @typescript-eslint/naming-convention */

@ProjectionHandler(ViewShareIdRefreshed)
@ProjectionHandler(ViewShareDisabled)
export class V2ViewShareIdRefreshedShortLinkProjection
  implements IEventHandler<ViewShareIdRefreshed | ViewShareDisabled>
{
  private readonly logger = new Logger(V2ViewShareIdRefreshedShortLinkProjection.name);

  constructor(
    private readonly db: Kysely<IV2ViewShareSideEffectDb>,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  async handle(
    _context: IExecutionContext,
    event: ViewShareIdRefreshed | ViewShareDisabled
  ): Promise<Result<void, DomainError>> {
    const previousShareId = event.previousShareId;
    if (previousShareId === undefined) return ok(undefined);

    try {
      const links = await this.db
        .selectFrom('short_link')
        .select('code')
        .where('type', '=', ShortLinkType.ViewShare)
        .where('resource_id', '=', previousShareId)
        .where('deleted_time', 'is', null)
        .execute();
      if (links.length === 0) return ok(undefined);

      await this.db
        .updateTable('short_link')
        .set({ deleted_time: new Date() })
        .where('type', '=', ShortLinkType.ViewShare)
        .where('resource_id', '=', previousShareId)
        .where('deleted_time', 'is', null)
        .execute();
      await Promise.all(
        links.map(({ code }) => this.performanceCacheService.del(generateShortLinkCacheKey(code)))
      );
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate short links for revoked View share ${previousShareId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return ok(undefined);
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2ViewShareSideEffectService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2ViewShareSideEffectService.name);

  constructor(private readonly performanceCacheService: PerformanceCacheService) {}

  registerProjections(container: DependencyContainer): void {
    this.logger.debug('Registering V2 View share side-effect projections');
    const db = container.resolve<Kysely<IV2ViewShareSideEffectDb>>(v2MetaDbTokens.db);
    container.registerInstance(
      V2ViewShareIdRefreshedShortLinkProjection,
      new V2ViewShareIdRefreshedShortLinkProjection(db, this.performanceCacheService)
    );
  }
}
