import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  v2RecordRepositoryPostgresTokens,
  type IPeriodicFieldRefreshLifecycleSink,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  FieldCreated,
  FieldUpdated,
  ProjectionHandler,
  ok,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type Result,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import {
  FieldPeriodicRefreshStateService,
  syncFieldPeriodicRefreshMetadata,
} from './field-periodic-refresh-state.service';

@ProjectionHandler(FieldCreated)
@ProjectionHandler(FieldUpdated)
export class V2FieldPeriodicRefreshSyncHandler implements IEventHandler<
  FieldCreated | FieldUpdated
> {
  private readonly logger = new Logger(V2FieldPeriodicRefreshSyncHandler.name);

  constructor(private readonly prismaService: PrismaService) {}

  async handle(
    _context: IExecutionContext,
    event: FieldCreated | FieldUpdated
  ): Promise<Result<void, DomainError>> {
    const fieldId = event.fieldId.toString();
    try {
      await syncFieldPeriodicRefreshMetadata(this.prismaService.txClient(), fieldId);
    } catch (error) {
      this.logger.warn(`Failed to sync periodic refresh metadata for field=${fieldId}`, error);
    }
    return ok(undefined);
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2PeriodicRefreshSyncProjection implements IV2ProjectionRegistrar {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly stateService: FieldPeriodicRefreshStateService
  ) {}

  registerProjections(container: DependencyContainer): void {
    container.registerInstance(
      V2FieldPeriodicRefreshSyncHandler,
      new V2FieldPeriodicRefreshSyncHandler(this.prismaService)
    );

    const lifecycleSink: IPeriodicFieldRefreshLifecycleSink = {
      onCompleted: async (event) => {
        const triggeredAt = new Date(event.triggeredAtIso);
        await this.stateService.recordAsyncCompleted({
          fieldId: event.sourceFieldId,
          tableId: event.sourceTableId,
          baseId: event.baseId,
          timeZone: event.timeZone,
          containsNowPrecision: event.containsNowPrecision,
          completedAt: event.completedAt,
          triggeredAt: Number.isNaN(triggeredAt.getTime()) ? event.completedAt : triggeredAt,
          localDate: event.localDate,
          rangeHash: event.rangeHash,
        });
      },
      onFailed: async (event) => {
        await this.stateService.recordAsyncFailed({
          fieldId: event.sourceFieldId,
          rangeHash: event.rangeHash,
          taskId: event.taskId,
          message: event.message,
        });
      },
    };
    container.registerInstance(
      v2RecordRepositoryPostgresTokens.periodicFieldRefreshLifecycleSink,
      lifecycleSink
    );
  }
}
