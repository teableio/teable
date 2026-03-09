import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ResourceType } from '@teable/openapi';
import { FieldDeleted, ProjectionHandler, ok } from '@teable/v2-core';
import type { DomainError, IEventHandler, IExecutionContext, Result } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ViewService } from '../view/view.service';
import { V2_FIELD_DELETE_COMPAT_CONTEXT_KEY } from './v2-field-delete-compat.constants';
import type { IV2FieldDeleteCompatContext } from './v2-field-delete-compat.constants';
import { V2ContainerService } from './v2-container.service';
import type { IV2ProjectionRegistrar } from './v2-projection-registrar';

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
class V2FieldDeletedCompatProjection implements IEventHandler<FieldDeleted> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewService: ViewService
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
      await this.viewService.batchUpdateViewByOps(
        compatContext.tableId,
        compatContext.frozenFieldOps
      );
    }

    await this.prisma.tableTrash.create({
      data: {
        id: compatContext.operationId,
        tableId: compatContext.tableId,
        createdBy: compatContext.userId,
        resourceType: ResourceType.Field,
        snapshot: JSON.stringify({
          fields: compatContext.legacyDeletePayload.fields,
          records: compatContext.legacyDeletePayload.records,
        }),
      },
    });

    return ok(undefined);
  }
}

@Injectable()
export class V2FieldDeleteCompatService implements IV2ProjectionRegistrar, OnModuleInit {
  private readonly logger = new Logger(V2FieldDeleteCompatService.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly prisma: PrismaService,
    private readonly viewService: ViewService
  ) {}

  onModuleInit(): void {
    this.v2ContainerService.addProjectionRegistrar(this);
  }

  registerProjections(container: DependencyContainer): void {
    this.logger.debug('Registering V2 field delete compatibility projections');
    container.registerInstance(
      V2FieldDeletedCompatProjection,
      new V2FieldDeletedCompatProjection(this.prisma, this.viewService)
    );
  }
}
