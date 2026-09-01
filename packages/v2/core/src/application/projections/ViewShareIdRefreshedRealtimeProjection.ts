import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewShareIdRefreshed } from '../../domain/table/events/ViewShareIdRefreshed';
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
import {
  toStandaloneViewRealtimeSnapshot,
  withPersistedViewAuditChanges,
} from './ViewRealtimeProjectionUtils';

@ProjectionHandler(ViewShareIdRefreshed)
@injectable()
export class ViewShareIdRefreshedRealtimeProjection implements IEventHandler<ViewShareIdRefreshed> {
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
    event: ViewShareIdRefreshed,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;
    return scheduleRealtimeProjection(
      context,
      ViewShareIdRefreshedRealtimeProjection.name,
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
                candidate.views.some(
                  (view) =>
                    view.id === event.viewId.toString() && view.shareId === event.nextShareId
                ),
            })
          ).safeUnwrap();
          const viewIndex = snapshot.views.findIndex((view) => view.id === event.viewId.toString());
          if (viewIndex === -1) return ok(undefined);
          const viewDto = snapshot.views[viewIndex]!;

          const tableDocId = yield* RealtimeDocId.fromParts(
            `tbl_${event.baseId.toString()}`,
            event.tableId.toString()
          ).safeUnwrap();
          yield* (await realtimeEngine.ensure(context, tableDocId, snapshot)).safeUnwrap();
          yield* (
            await realtimeEngine.applyChange(
              context,
              tableDocId,
              withPersistedViewAuditChanges(
                viewDto,
                [
                  {
                    type: 'set',
                    path: ['views', viewIndex, 'shareId'],
                    value: viewDto.shareId,
                  },
                ],
                ['views', viewIndex]
              )
            )
          ).safeUnwrap();

          const viewDocId = yield* RealtimeDocId.fromParts(
            `viw_${event.tableId.toString()}`,
            event.viewId.toString()
          ).safeUnwrap();
          yield* (
            await realtimeEngine.ensure(
              context,
              viewDocId,
              toStandaloneViewRealtimeSnapshot(viewDto)
            )
          ).safeUnwrap();
          return realtimeEngine.applyChange(
            context,
            viewDocId,
            withPersistedViewAuditChanges(viewDto, [
              { type: 'set', path: ['shareId'], value: viewDto.shareId },
            ]),
            { version: event.oldVersion }
          );
        }),
      getRealtimeProjectionScope(dispatchScope)
    );
  }
}
