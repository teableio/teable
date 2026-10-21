import { Injectable, Logger } from '@nestjs/common';
import { LastVisitResourceType, PinType } from '@teable/openapi';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  domainError,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  ProjectionHandler,
  type Result,
  ViewDeleted,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';

import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

/* eslint-disable @typescript-eslint/naming-convention */
type IV2ViewDeleteSideEffectDb = {
  pin_resource: {
    resource_id: string;
    type: string;
  };
  user_last_visit: {
    resource_id: string;
    resource_type: string;
  };
};
/* eslint-enable @typescript-eslint/naming-convention */

@ProjectionHandler(ViewDeleted)
export class V2ViewDeletedResourceCleanupProjection implements IEventHandler<ViewDeleted> {
  constructor(private readonly db: Kysely<IV2ViewDeleteSideEffectDb>) {}

  async handle(
    _context: IExecutionContext,
    event: ViewDeleted
  ): Promise<Result<void, DomainError>> {
    try {
      const viewId = event.viewId.toString();
      // View-share short-link rows are intentionally retained as advisory
      // aliases. ShortLinkService revalidates enable_share and deleted_time on
      // every uncached redirect, so a deleted View cannot authorize access.
      await Promise.all([
        this.db
          .deleteFrom('user_last_visit')
          .where('resource_id', '=', viewId)
          .where('resource_type', '=', LastVisitResourceType.View)
          .execute(),
        this.db
          .deleteFrom('pin_resource')
          .where('resource_id', '=', viewId)
          .where('type', '=', PinType.View)
          .execute(),
      ]);
      return ok(undefined);
    } catch (error) {
      return err(domainError.fromUnknown(error));
    }
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2ViewDeleteSideEffectService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2ViewDeleteSideEffectService.name);

  registerProjections(container: DependencyContainer): void {
    this.logger.debug('Registering V2 View delete resource cleanup projection');
    const db = container.resolve<Kysely<IV2ViewDeleteSideEffectDb>>(v2MetaDbTokens.db);
    container.registerInstance(
      V2ViewDeletedResourceCleanupProjection,
      new V2ViewDeletedResourceCleanupProjection(db)
    );
  }
}
