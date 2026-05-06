import { Injectable, Logger } from '@nestjs/common';
import { ResourceType } from '@teable/openapi';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { FieldDeleted, ProjectionHandler, ok } from '@teable/v2-core';
import type { DomainError, IEventHandler, IExecutionContext, Result } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { V2ContainerService } from './v2-container.service';
import { V2_FIELD_DELETE_COMPAT_CONTEXT_KEY } from './v2-field-delete-compat.constants';
import type { IV2FieldDeleteCompatContext } from './v2-field-delete-compat.constants';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';
import { V2ViewCompatService } from './v2-view-compat.service';

/* eslint-disable @typescript-eslint/naming-convention */
type IV2FieldDeleteCompatDb = V1TeableDatabase & {
  table_trash: {
    id: string;
    table_id: string;
    resource_type: string;
    snapshot: string;
    created_by: string;
  };
};
/* eslint-enable @typescript-eslint/naming-convention */

const getFieldDeleteCompatContext = (
  context: IExecutionContext,
  event: FieldDeleted
): IV2FieldDeleteCompatContext | undefined => {
  const compatContext = (
    context as IExecutionContext & {
      [V2_FIELD_DELETE_COMPAT_CONTEXT_KEY]?: IV2FieldDeleteCompatContext;
    }
  )[V2_FIELD_DELETE_COMPAT_CONTEXT_KEY];

  if (!compatContext || compatContext.completed) {
    return undefined;
  }

  if (compatContext.tableId !== event.tableId.toString()) {
    return undefined;
  }

  return compatContext;
};

@ProjectionHandler(FieldDeleted)
export class V2FieldDeletedCompatProjection implements IEventHandler<FieldDeleted> {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ViewCompatService: V2ViewCompatService
  ) {}

  async handle(
    context: IExecutionContext,
    event: FieldDeleted
  ): Promise<Result<void, DomainError>> {
    const compatContext = getFieldDeleteCompatContext(context, event);
    if (!compatContext) {
      return ok(undefined);
    }

    const fieldId = event.fieldId.toString();
    if (!compatContext.remainingFieldIds.has(fieldId)) {
      return ok(undefined);
    }

    compatContext.remainingFieldIds.delete(fieldId);
    if (compatContext.remainingFieldIds.size > 0) {
      return ok(undefined);
    }

    compatContext.completed = true;

    if (Object.keys(compatContext.frozenFieldOps).length > 0) {
      await this.v2ViewCompatService.batchUpdateViewByOps(
        compatContext.tableId,
        compatContext.frozenFieldOps
      );
    }

    const container = await this.v2ContainerService.getContainer();
    const db = container.resolve<Kysely<IV2FieldDeleteCompatDb>>(v2DataDbTokens.db);

    await db
      .insertInto('table_trash')
      .values({
        id: compatContext.operationId,
        table_id: compatContext.tableId,
        created_by: compatContext.userId,
        resource_type: ResourceType.Field,
        snapshot: JSON.stringify({
          fields: compatContext.legacyDeletePayload.fields,
          records: compatContext.legacyDeletePayload.records,
        }),
      })
      .execute();

    return ok(undefined);
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2FieldDeleteCompatService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2FieldDeleteCompatService.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ViewCompatService: V2ViewCompatService
  ) {}

  registerProjections(container: DependencyContainer): void {
    this.logger.debug('Registering V2 field delete compatibility projections');
    container.registerInstance(
      V2FieldDeletedCompatProjection,
      new V2FieldDeletedCompatProjection(this.v2ContainerService, this.v2ViewCompatService)
    );
  }
}
