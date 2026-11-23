import {
  FieldCreated,
  FieldDeleted,
  FieldDuplicated,
  FieldOptionsAdded,
  FieldUpdated,
  RecordCreated,
  RecordReordered,
  RecordUpdated,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  SameTxProjectionHandler,
  TableCreated,
  TableDeleted,
  TablePropertiesUpdated,
  TableRenamed,
  TableRestored,
  TableTrashed,
  ViewColumnMetaUpdated,
  ViewCreated,
  ViewDeleted,
  ViewDescriptionUpdated,
  ViewFilterUpdated,
  ViewGroupUpdated,
  ViewManualSortApplied,
  ViewOptionsUpdated,
  ViewOrderUpdated,
  ViewRenamed,
  ViewSortUpdated,
  err,
  ok,
  type DomainError,
  type EventType,
  type IDomainEvent,
  type IEventHandler,
  type IExecutionContext,
  type Result,
  type Table,
  type TableQueryService,
} from '@teable/v2-core';
import { injectable } from '@teable/v2-di';

import type { IBaseVcsLogRepository } from '../ports/server';
import { buildVcsChangesFromEvent, type BaseVcsTrackedEvent } from './extractDirtyKeys';

export const BASE_VCS_TRACKED_EVENTS: readonly EventType<IDomainEvent>[] = [
  TableCreated,
  TableDeleted,
  TableRestored,
  TableTrashed,
  TableRenamed,
  TablePropertiesUpdated,
  FieldCreated,
  FieldUpdated,
  FieldDeleted,
  FieldOptionsAdded,
  FieldDuplicated,
  ViewCreated,
  ViewDeleted,
  ViewRenamed,
  ViewDescriptionUpdated,
  ViewFilterUpdated,
  ViewGroupUpdated,
  ViewSortUpdated,
  ViewOrderUpdated,
  ViewColumnMetaUpdated,
  ViewOptionsUpdated,
  ViewManualSortApplied,
  RecordCreated,
  RecordsBatchCreated,
  RecordUpdated,
  RecordsBatchUpdated,
  RecordsDeleted,
  RecordReordered,
];

@injectable()
@SameTxProjectionHandler(TableCreated, { id: 'teable.vcs.BaseVcsChangeLogProjection.TableCreated' })
@SameTxProjectionHandler(TableDeleted, { id: 'teable.vcs.BaseVcsChangeLogProjection.TableDeleted' })
@SameTxProjectionHandler(TableRestored, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.TableRestored',
})
@SameTxProjectionHandler(TableTrashed, { id: 'teable.vcs.BaseVcsChangeLogProjection.TableTrashed' })
@SameTxProjectionHandler(TableRenamed, { id: 'teable.vcs.BaseVcsChangeLogProjection.TableRenamed' })
@SameTxProjectionHandler(TablePropertiesUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.TablePropertiesUpdated',
})
@SameTxProjectionHandler(FieldCreated, { id: 'teable.vcs.BaseVcsChangeLogProjection.FieldCreated' })
@SameTxProjectionHandler(FieldUpdated, { id: 'teable.vcs.BaseVcsChangeLogProjection.FieldUpdated' })
@SameTxProjectionHandler(FieldDeleted, { id: 'teable.vcs.BaseVcsChangeLogProjection.FieldDeleted' })
@SameTxProjectionHandler(FieldOptionsAdded, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.FieldOptionsAdded',
})
@SameTxProjectionHandler(FieldDuplicated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.FieldDuplicated',
})
@SameTxProjectionHandler(ViewCreated, { id: 'teable.vcs.BaseVcsChangeLogProjection.ViewCreated' })
@SameTxProjectionHandler(ViewDeleted, { id: 'teable.vcs.BaseVcsChangeLogProjection.ViewDeleted' })
@SameTxProjectionHandler(ViewRenamed, { id: 'teable.vcs.BaseVcsChangeLogProjection.ViewRenamed' })
@SameTxProjectionHandler(ViewDescriptionUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.ViewDescriptionUpdated',
})
@SameTxProjectionHandler(ViewFilterUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.ViewFilterUpdated',
})
@SameTxProjectionHandler(ViewGroupUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.ViewGroupUpdated',
})
@SameTxProjectionHandler(ViewSortUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.ViewSortUpdated',
})
@SameTxProjectionHandler(ViewOrderUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.ViewOrderUpdated',
})
@SameTxProjectionHandler(ViewColumnMetaUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.ViewColumnMetaUpdated',
})
@SameTxProjectionHandler(ViewOptionsUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.ViewOptionsUpdated',
})
@SameTxProjectionHandler(ViewManualSortApplied, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.ViewManualSortApplied',
})
@SameTxProjectionHandler(RecordCreated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.RecordCreated',
})
@SameTxProjectionHandler(RecordsBatchCreated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.RecordsBatchCreated',
})
@SameTxProjectionHandler(RecordUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.RecordUpdated',
})
@SameTxProjectionHandler(RecordsBatchUpdated, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.RecordsBatchUpdated',
})
@SameTxProjectionHandler(RecordsDeleted, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.RecordsDeleted',
})
@SameTxProjectionHandler(RecordReordered, {
  id: 'teable.vcs.BaseVcsChangeLogProjection.RecordReordered',
})
export class BaseVcsChangeLogProjection implements IEventHandler<BaseVcsTrackedEvent> {
  constructor(
    private readonly logRepository?: IBaseVcsLogRepository,
    private readonly tableQueryService?: Pick<TableQueryService, 'getById'>
  ) {}

  private async resolveFallbackTable(
    context: IExecutionContext,
    event: BaseVcsTrackedEvent
  ): Promise<Table | undefined> {
    if (!this.tableQueryService) return undefined;
    const res = await this.tableQueryService.getById(context, event.tableId);
    return res.isOk() ? res.value : undefined;
  }

  async handle(
    context: IExecutionContext,
    event: BaseVcsTrackedEvent
  ): Promise<Result<void, DomainError>> {
    if (!this.logRepository) {
      return ok(undefined);
    }

    const enabledRes = await this.logRepository.isEnabled(context, event.baseId);
    if (enabledRes.isErr()) {
      return err(enabledRes.error);
    }
    if (!enabledRes.value) {
      return ok(undefined);
    }

    const tableId = event.tableId.toString();
    const prevTable = context.sameTxProjection?.previousTables?.get(tableId) as Table | undefined;
    const nextTable = context.sameTxProjection?.tables.get(tableId) as Table | undefined;
    const fallbackTable =
      prevTable ?? nextTable ?? (await this.resolveFallbackTable(context, event));

    const builtRes = buildVcsChangesFromEvent(event, {
      prevTable,
      nextTable,
      fallbackTable,
    });
    if (builtRes.isErr()) {
      return err(builtRes.error);
    }
    if (builtRes.value.length === 0) {
      return ok(undefined);
    }

    const actorId = context.actorId?.toString();
    const rows = builtRes.value.map((row) => ({
      ...row,
      actorId: row.actorId ?? actorId,
    }));

    return this.logRepository.appendChanges(context, event.baseId, rows);
  }
}
