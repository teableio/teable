import { inject, injectable } from '@teable/v2-di';
import { safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewDeleted } from '../../domain/table/events/ViewDeleted';
import type { IEventDispatchScope, IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';
import {
  getRealtimeProjectionScope,
  scheduleRealtimeProjection,
} from './scheduleRealtimeProjection';

const viewCollectionPrefix = 'viw';

@ProjectionHandler(ViewDeleted)
@injectable()
export class ViewDeletedRealtimeProjection implements IEventHandler<ViewDeleted> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: ViewDeleted,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;
    return scheduleRealtimeProjection(
      context,
      ViewDeletedRealtimeProjection.name,
      (context) =>
        safeTry(async function* () {
          const viewDocId = yield* RealtimeDocId.fromParts(
            `${viewCollectionPrefix}_${event.tableId.toString()}`,
            event.viewId.toString()
          ).safeUnwrap();
          return realtimeEngine.delete(context, viewDocId, { version: event.oldVersion });
        }),
      getRealtimeProjectionScope(dispatchScope)
    );
  }
}
