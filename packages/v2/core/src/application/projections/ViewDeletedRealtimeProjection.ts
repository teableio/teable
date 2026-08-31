import { inject, injectable } from '@teable/v2-di';
import { safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewDeleted } from '../../domain/table/events/ViewDeleted';
import type { IEventDispatchScope, IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';
import { loadRealtimeTableSnapshot } from './RealtimeTableSnapshotCache';
import {
  getRealtimeProjectionScope,
  scheduleRealtimeProjection,
} from './scheduleRealtimeProjection';

const tableCollectionPrefix = 'tbl';
const viewCollectionPrefix = 'viw';

@ProjectionHandler(ViewDeleted)
@injectable()
export class ViewDeletedRealtimeProjection implements IEventHandler<ViewDeleted> {
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
    event: ViewDeleted,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;
    return scheduleRealtimeProjection(
      context,
      ViewDeletedRealtimeProjection.name,
      (context, scope) =>
        safeTry(async function* () {
          const snapshot = yield* (
            await loadRealtimeTableSnapshot(context, {
              baseId: event.baseId,
              tableId: event.tableId,
              tableRepository,
              tableMapper,
              tableSnapshotCache: scope.tableSnapshotCache,
              isSnapshotUsable: (candidate) =>
                candidate.views.every((view) => view.id !== event.viewId.toString()),
            })
          ).safeUnwrap();

          const tableDocId = yield* RealtimeDocId.fromParts(
            `${tableCollectionPrefix}_${event.baseId.toString()}`,
            event.tableId.toString()
          ).safeUnwrap();
          yield* (await realtimeEngine.ensure(context, tableDocId, snapshot)).safeUnwrap();
          yield* (
            await realtimeEngine.applyChange(context, tableDocId, {
              type: 'set',
              path: ['views'],
              value: snapshot.views,
            })
          ).safeUnwrap();

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
