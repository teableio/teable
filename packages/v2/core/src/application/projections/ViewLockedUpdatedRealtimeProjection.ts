import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewLockedUpdated } from '../../domain/table/events/ViewLockedUpdated';
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

const tableCollectionPrefix = 'tbl';
const viewCollectionPrefix = 'viw';

@ProjectionHandler(ViewLockedUpdated)
@injectable()
export class ViewLockedUpdatedRealtimeProjection implements IEventHandler<ViewLockedUpdated> {
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
    event: ViewLockedUpdated,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;
    return scheduleRealtimeProjection(
      context,
      ViewLockedUpdatedRealtimeProjection.name,
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
                    view.id === event.viewId.toString() && view.isLocked === event.nextIsLocked
                ),
            })
          ).safeUnwrap();

          const viewIndex = snapshot.views.findIndex((view) => view.id === event.viewId.toString());
          if (viewIndex === -1) return ok(undefined);
          const viewDto = snapshot.views[viewIndex];
          const hasStateChange =
            event.previousIsLocked !== undefined || event.nextIsLocked !== undefined;
          const hasAuditChange =
            viewDto.lastModifiedBy !== undefined || viewDto.lastModifiedTime !== undefined;

          const tableDocId = yield* RealtimeDocId.fromParts(
            `${tableCollectionPrefix}_${event.baseId.toString()}`,
            event.tableId.toString()
          ).safeUnwrap();
          yield* (await realtimeEngine.ensure(context, tableDocId, snapshot)).safeUnwrap();
          if (hasStateChange || hasAuditChange) {
            yield* (
              await realtimeEngine.applyChange(
                context,
                tableDocId,
                withPersistedViewAuditChanges(
                  viewDto,
                  hasStateChange
                    ? {
                        type: 'set',
                        path: ['views', viewIndex, 'isLocked'],
                        value: viewDto.isLocked,
                        oldValue: event.previousIsLocked,
                      }
                    : [],
                  ['views', viewIndex]
                )
              )
            ).safeUnwrap();
          }

          const viewDocId = yield* RealtimeDocId.fromParts(
            `${viewCollectionPrefix}_${event.tableId.toString()}`,
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
            withPersistedViewAuditChanges(
              viewDto,
              hasStateChange
                ? {
                    type: 'set',
                    path: ['isLocked'],
                    value: event.nextIsLocked,
                    oldValue: event.previousIsLocked,
                  }
                : hasAuditChange
                  ? []
                  : {
                      type: 'set',
                      path: ['id'],
                      value: event.viewId.toString(),
                      oldValue: event.viewId.toString(),
                    }
            ),
            { version: event.oldVersion }
          );
        }),
      getRealtimeProjectionScope(dispatchScope)
    );
  }
}
