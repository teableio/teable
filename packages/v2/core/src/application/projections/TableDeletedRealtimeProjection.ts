import { inject, injectable } from '@teable/v2-di';
import { safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { TableDeleted } from '../../domain/table/events/TableDeleted';
import { TableTrashed } from '../../domain/table/events/TableTrashed';
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

const tableCollectionPrefix = 'tbl';

/**
 * Remove the Table document from the per-base realtime collection when the
 * table is trashed or permanently deleted.
 *
 * The legacy path publishes this removal itself (table.service deleteTable
 * saves a Del raw op), so clients subscribed to the base's table list see the
 * table leave in realtime. Without this projection the v2 path only flushes
 * the base-node presence channel: the sidebar refetches, but every client
 * anchored to the table keeps a ghost entry in its subscribed list and stays
 * on the dead table. Publishing for an already-removed document is harmless —
 * the triggered query re-poll simply finds nothing changed.
 */
@ProjectionHandler(TableTrashed)
@ProjectionHandler(TableDeleted)
@injectable()
export class TableDeletedRealtimeProjection implements IEventHandler<TableTrashed | TableDeleted> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: TableTrashed | TableDeleted,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine } = this;
    return scheduleRealtimeProjection(
      context,
      TableDeletedRealtimeProjection.name,
      (context) =>
        safeTry(async function* () {
          const tableDocId = yield* RealtimeDocId.fromParts(
            `${tableCollectionPrefix}_${event.baseId.toString()}`,
            event.tableId.toString()
          ).safeUnwrap();
          return realtimeEngine.delete(context, tableDocId);
        }),
      getRealtimeProjectionScope(dispatchScope)
    );
  }
}
