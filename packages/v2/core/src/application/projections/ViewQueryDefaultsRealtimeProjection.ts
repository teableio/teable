import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import type { DomainError } from '../../domain/shared/DomainError';
import type { TableId } from '../../domain/table/TableId';
import type { ViewId } from '../../domain/table/views/ViewId';
import type { IEventDispatchScope } from '../../ports/EventHandler';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableMapper } from '../../ports/mappers/TableMapper';
import type { RealtimeChange } from '../../ports/RealtimeChange';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import type { IRealtimeEngine } from '../../ports/RealtimeEngine';
import type { ITableRepository } from '../../ports/TableRepository';
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

type QueryProperty = 'filter' | 'group' | 'sort';

type QueryDefaultsEvent = {
  baseId: BaseId;
  tableId: TableId;
  viewId: ViewId;
  oldVersion?: number;
  newVersion?: number;
};

type Dependencies = {
  realtimeEngine: IRealtimeEngine;
  tableRepository: ITableRepository;
  tableMapper: ITableMapper;
};

const pendingKey = (event: QueryDefaultsEvent): string =>
  [
    event.baseId.toString(),
    event.tableId.toString(),
    event.viewId.toString(),
    event.oldVersion ?? 'none',
    event.newVersion ?? 'none',
  ].join(':');

export const scheduleViewQueryDefaultsRealtimeProjection = (
  context: IExecutionContext,
  event: QueryDefaultsEvent,
  property: QueryProperty,
  previousValue: unknown,
  dependencies: Dependencies,
  dispatchScope: IEventDispatchScope | undefined,
  projectionName: string
): Result<void, DomainError> => {
  const projectionScope = getRealtimeProjectionScope(dispatchScope);
  const key = pendingKey(event);
  const existing = projectionScope.viewQueryDefaultsRealtimePending.get(key);
  if (existing) {
    existing.previousByProperty.set(property, previousValue);
    return ok(undefined);
  }

  const pending = {
    previousByProperty: new Map<QueryProperty, unknown>([[property, previousValue]]),
  };
  projectionScope.viewQueryDefaultsRealtimePending.set(key, pending);

  const scheduled = scheduleRealtimeProjection(
    context,
    projectionName,
    (context, scope) =>
      safeTry(async function* () {
        try {
          const snapshot = yield* (
            await loadRealtimeTableSnapshot(context, {
              baseId: event.baseId,
              tableId: event.tableId,
              tableRepository: dependencies.tableRepository,
              tableMapper: dependencies.tableMapper,
              tableSnapshotCache: scope.tableSnapshotCache,
              isSnapshotUsable: (candidate) =>
                candidate.views.some((view) => view.id === event.viewId.toString()),
            })
          ).safeUnwrap();
          const viewIndex = snapshot.views.findIndex((view) => view.id === event.viewId.toString());
          if (viewIndex === -1) return ok(undefined);
          const viewDto = snapshot.views[viewIndex]!;

          const tableChanges: RealtimeChange[] = [
            { type: 'set', path: ['views', viewIndex, 'query'], value: viewDto.query },
          ];
          const standaloneChanges: RealtimeChange[] = [
            { type: 'set', path: ['query'], value: viewDto.query },
          ];

          if (pending.previousByProperty.has('filter')) {
            const previousFilter = pending.previousByProperty.get('filter');
            tableChanges.push(
              {
                type: 'set',
                path: ['views', viewIndex, 'sourceFilter'],
                value: viewDto.sourceFilter,
                oldValue: previousFilter,
              },
              {
                type: 'set',
                path: ['views', viewIndex, 'filter'],
                value: viewDto.sourceFilter,
                oldValue: previousFilter,
              }
            );
            standaloneChanges.push(
              {
                type: 'set',
                path: ['sourceFilter'],
                value: viewDto.sourceFilter,
                oldValue: previousFilter,
              },
              {
                type: 'set',
                path: ['filter'],
                value: viewDto.sourceFilter,
                oldValue: previousFilter,
              }
            );
          }

          if (pending.previousByProperty.has('sort')) {
            const query = viewDto.query;
            const sort =
              query?.sort === undefined && query?.manualSort === undefined
                ? undefined
                : {
                    sortObjs: query.sort ?? [],
                    ...(query.manualSort !== undefined ? { manualSort: query.manualSort } : {}),
                  };
            standaloneChanges.push({
              type: 'set',
              path: ['sort'],
              value: sort,
              oldValue: pending.previousByProperty.get('sort'),
            });
          }

          if (pending.previousByProperty.has('group')) {
            standaloneChanges.push({
              type: 'set',
              path: ['group'],
              value: viewDto.query?.group?.length ? viewDto.query.group : undefined,
              oldValue: pending.previousByProperty.get('group'),
            });
          }

          const tableDocId = yield* RealtimeDocId.fromParts(
            `${tableCollectionPrefix}_${event.baseId.toString()}`,
            event.tableId.toString()
          ).safeUnwrap();
          yield* (
            await dependencies.realtimeEngine.ensure(context, tableDocId, snapshot)
          ).safeUnwrap();
          yield* (
            await dependencies.realtimeEngine.applyChange(
              context,
              tableDocId,
              withPersistedViewAuditChanges(viewDto, tableChanges, ['views', viewIndex])
            )
          ).safeUnwrap();

          const viewDocId = yield* RealtimeDocId.fromParts(
            `${viewCollectionPrefix}_${event.tableId.toString()}`,
            event.viewId.toString()
          ).safeUnwrap();
          yield* (
            await dependencies.realtimeEngine.ensure(
              context,
              viewDocId,
              toStandaloneViewRealtimeSnapshot(viewDto)
            )
          ).safeUnwrap();
          return dependencies.realtimeEngine.applyChange(
            context,
            viewDocId,
            withPersistedViewAuditChanges(viewDto, standaloneChanges),
            { version: event.oldVersion }
          );
        } finally {
          scope.viewQueryDefaultsRealtimePending.delete(key);
        }
      }),
    projectionScope
  );

  if (scheduled.isErr()) {
    projectionScope.viewQueryDefaultsRealtimePending.delete(key);
  }
  return scheduled;
};
