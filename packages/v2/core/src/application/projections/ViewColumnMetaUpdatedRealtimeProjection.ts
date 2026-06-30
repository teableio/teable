import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
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
  type RealtimeProjectionScope,
} from './scheduleRealtimeProjection';

const tableCollectionPrefix = 'tbl';
const viewCollectionPrefix = 'viw';

const canUseColumnMetaSnapshot = (
  event: ViewColumnMetaUpdated,
  candidate: TableMapperPort.ITablePersistenceDTO
): boolean => {
  const view = candidate.views.find((view) => view.id === event.viewId.toString());
  if (!view) {
    return false;
  }

  const fieldId = event.fieldId.toString();
  const fieldInSnapshot = Boolean(view.columnMeta[fieldId]);
  return event.fieldInColumnMeta ? fieldInSnapshot : !fieldInSnapshot;
};

const reserveViewColumnMetaRealtimeProjection = (
  scope: RealtimeProjectionScope,
  event: ViewColumnMetaUpdated
): (() => void) | undefined => {
  const key = `${event.baseId.toString()}:${event.tableId.toString()}:${event.viewId.toString()}`;
  const pendingKeys = scope.viewColumnMetaRealtimePendingKeys;
  if (pendingKeys.has(key)) {
    return undefined;
  }
  pendingKeys.add(key);
  return () => {
    pendingKeys.delete(key);
  };
};

@ProjectionHandler(ViewColumnMetaUpdated)
@injectable()
export class ViewColumnMetaUpdatedRealtimeProjection
  implements IEventHandler<ViewColumnMetaUpdated>
{
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
    event: ViewColumnMetaUpdated,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;
    const projectionScope = getRealtimeProjectionScope(dispatchScope);
    const releasePending = reserveViewColumnMetaRealtimeProjection(projectionScope, event);
    if (!releasePending) {
      return ok(undefined);
    }

    return scheduleRealtimeProjection(
      context,
      ViewColumnMetaUpdatedRealtimeProjection.name,
      (context, scope) =>
        safeTry(async function* () {
          try {
            const snapshot = yield* (
              await loadRealtimeTableSnapshot(context, {
                baseId: event.baseId,
                tableId: event.tableId,
                tableRepository,
                tableMapper,
                tableSnapshotCache: scope.tableSnapshotCache,
                isSnapshotUsable: (candidate) => canUseColumnMetaSnapshot(event, candidate),
              })
            ).safeUnwrap();

            const viewIndex = snapshot.views.findIndex(
              (view) => view.id === event.viewId.toString()
            );
            if (viewIndex === -1) return ok(undefined);

            const viewDto = snapshot.views[viewIndex];

            const collection = `${tableCollectionPrefix}_${event.baseId.toString()}`;
            const docId = yield* RealtimeDocId.fromParts(
              collection,
              event.tableId.toString()
            ).safeUnwrap();

            // Ensure table document exists first (for tables created before realtime was enabled)
            yield* (await realtimeEngine.ensure(context, docId, snapshot)).safeUnwrap();

            // Keep the table snapshot in sync for table-level consumers.
            yield* (
              await realtimeEngine.applyChange(context, docId, {
                type: 'set',
                path: ['views', viewIndex, 'columnMeta'],
                value: viewDto.columnMeta,
              })
            ).safeUnwrap();

            // Keep the standalone view document in sync for ShareDB/SDK view subscriptions.
            const viewCollection = `${viewCollectionPrefix}_${event.tableId.toString()}`;
            const viewDocId = yield* RealtimeDocId.fromParts(
              viewCollection,
              event.viewId.toString()
            ).safeUnwrap();
            yield* (await realtimeEngine.ensure(context, viewDocId, viewDto)).safeUnwrap();

            return realtimeEngine.applyChange(
              context,
              viewDocId,
              {
                type: 'set',
                path: ['columnMeta'],
                value: viewDto.columnMeta,
              },
              {
                version: event.oldVersion,
              }
            );
          } finally {
            releasePending();
          }
        }),
      projectionScope
    );
  }
}
