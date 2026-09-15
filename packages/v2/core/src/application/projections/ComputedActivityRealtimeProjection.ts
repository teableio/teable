import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  ComputedActivityBatchChanged,
  isComputedActivityBatchChangedEvent,
} from '../../domain/computed/events/ComputedActivityBatchChanged';
import type { DomainError } from '../../domain/shared/DomainError';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';

/**
 * Tells table subscribers that compute activity changed so they refetch the
 * authoritative, permission-scoped snapshot over HTTP. The signal carries no
 * activity data, so it needs no per-field authorization of its own.
 */
@ProjectionHandler(ComputedActivityBatchChanged)
@injectable()
export class ComputedActivityRealtimeProjection
  implements IEventHandler<ComputedActivityBatchChanged>
{
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: ComputedActivityBatchChanged
  ): Promise<Result<void, DomainError>> {
    if (!isComputedActivityBatchChangedEvent(event)) {
      return ok(undefined);
    }

    const tableIds = new Set<string>();
    for (const table of event.tables) {
      tableIds.add(table.tableId);
    }
    for (const field of event.fields) {
      tableIds.add(field.tableId);
    }

    for (const tableId of tableIds) {
      const result = await this.realtimeEngine.notifyTableComputeActivity(context, tableId);
      if (result.isErr()) {
        return err(result.error);
      }
    }

    return ok(undefined);
  }
}
