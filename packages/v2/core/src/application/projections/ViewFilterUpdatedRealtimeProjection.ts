import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewFilterUpdated } from '../../domain/table/events/ViewFilterUpdated';
import type { IEventDispatchScope, IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';
import { scheduleViewQueryDefaultsRealtimeProjection } from './ViewQueryDefaultsRealtimeProjection';

@ProjectionHandler(ViewFilterUpdated)
@injectable()
export class ViewFilterUpdatedRealtimeProjection implements IEventHandler<ViewFilterUpdated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: ViewFilterUpdated,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    return scheduleViewQueryDefaultsRealtimeProjection(
      context,
      event,
      'filter',
      event.previousFilter,
      {
        realtimeEngine: this.realtimeEngine,
        tableRepository: this.tableRepository,
        tableMapper: this.tableMapper,
      },
      dispatchScope,
      ViewFilterUpdatedRealtimeProjection.name
    );
  }
}
