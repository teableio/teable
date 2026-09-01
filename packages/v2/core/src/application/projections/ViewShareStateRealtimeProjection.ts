import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewShareDisabled } from '../../domain/table/events/ViewShareDisabled';
import { ViewShareEnabled } from '../../domain/table/events/ViewShareEnabled';
import type { IEventDispatchScope, IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import type { ITableViewPersistenceDTO } from '../../ports/mappers/TableMapper';
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

type ViewShareStateEvent = ViewShareEnabled | ViewShareDisabled;

abstract class ViewShareStateRealtimeProjection<TEvent extends ViewShareStateEvent>
  implements IEventHandler<TEvent>
{
  constructor(
    protected readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    protected readonly tableRepository: TableRepositoryPort.ITableRepository,
    protected readonly tableMapper: TableMapperPort.ITableMapper
  ) {}

  protected abstract isSnapshotUsable(view: ITableViewPersistenceDTO, event: TEvent): boolean;

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: TEvent,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;
    const isSnapshotUsable = this.isSnapshotUsable.bind(this);
    return scheduleRealtimeProjection(
      context,
      this.constructor.name,
      (context, scope) =>
        safeTry(async function* () {
          const snapshot = yield* (
            await loadRealtimeTableSnapshot(context, {
              baseId: event.baseId,
              tableId: event.tableId,
              tableRepository,
              tableMapper,
              tableSnapshotCache: scope.tableSnapshotCache,
              isSnapshotUsable: (candidate) => {
                const view = candidate.views.find(
                  (candidateView) => candidateView.id === event.viewId.toString()
                );
                if (!view) return false;
                return isSnapshotUsable(view, event);
              },
            })
          ).safeUnwrap();
          const viewIndex = snapshot.views.findIndex((view) => view.id === event.viewId.toString());
          if (viewIndex === -1) return ok(undefined);
          const viewDto = snapshot.views[viewIndex]!;
          const changes = [
            { type: 'set' as const, path: ['enableShare'] as const, value: viewDto.enableShare },
            { type: 'set' as const, path: ['shareId'] as const, value: viewDto.shareId },
            { type: 'set' as const, path: ['shareMeta'] as const, value: viewDto.shareMeta },
          ];

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
                changes.map((change) => ({
                  ...change,
                  path: ['views', viewIndex, ...change.path],
                })),
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
            withPersistedViewAuditChanges(viewDto, changes),
            {
              version: event.oldVersion,
            }
          );
        }),
      getRealtimeProjectionScope(dispatchScope)
    );
  }
}

@ProjectionHandler(ViewShareEnabled)
@injectable()
export class ViewShareEnabledRealtimeProjection extends ViewShareStateRealtimeProjection<ViewShareEnabled> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    @inject(v2CoreTokens.tableRepository)
    tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    tableMapper: TableMapperPort.ITableMapper
  ) {
    super(realtimeEngine, tableRepository, tableMapper);
  }

  protected isSnapshotUsable(view: ITableViewPersistenceDTO, event: ViewShareEnabled): boolean {
    return (
      view.enableShare === true &&
      view.shareId === event.shareId &&
      JSON.stringify(view.shareMeta) === JSON.stringify(event.shareMeta)
    );
  }
}

@ProjectionHandler(ViewShareDisabled)
@injectable()
export class ViewShareDisabledRealtimeProjection extends ViewShareStateRealtimeProjection<ViewShareDisabled> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    @inject(v2CoreTokens.tableRepository)
    tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    tableMapper: TableMapperPort.ITableMapper
  ) {
    super(realtimeEngine, tableRepository, tableMapper);
  }

  protected isSnapshotUsable(view: ITableViewPersistenceDTO, event: ViewShareDisabled): boolean {
    return (
      view.enableShare === false &&
      view.shareId === event.previousShareId &&
      JSON.stringify(view.shareMeta) === JSON.stringify(event.shareMeta)
    );
  }
}
