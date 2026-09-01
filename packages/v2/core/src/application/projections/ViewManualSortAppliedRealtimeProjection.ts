import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewManualSortApplied } from '../../domain/table/events/ViewManualSortApplied';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';
import { buildRecordCollection } from './TableRecordRealtimeDTO';

@ProjectionHandler(ViewManualSortApplied)
@injectable()
export class ViewManualSortAppliedRealtimeProjection
  implements IEventHandler<ViewManualSortApplied>
{
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: ViewManualSortApplied
  ): Promise<Result<void, DomainError>> {
    const collection = buildRecordCollection(event.tableId.toString());
    return this.realtimeEngine.invalidateCollection(context, collection, {
      type: 'set',
      path: ['fields', event.viewId.toRowOrderColumnName()],
      value: null,
      oldValue: null,
    });
  }
}
