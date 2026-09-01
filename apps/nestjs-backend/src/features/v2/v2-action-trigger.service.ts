import { Injectable, Logger } from '@nestjs/common';
import { getActionTriggerChannel } from '@teable/core';
import type { ITableActionKey, IViewActionKey } from '@teable/core';
import {
  FieldCreated,
  FieldDeleted,
  FieldUpdated,
  RecordCreated,
  RecordUpdated,
  RecordReordered,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  TableActionTriggerRequested,
  ViewColumnMetaUpdated,
  ViewFilterUpdated,
  ViewGroupUpdated,
  ProjectionHandler,
  ok,
  serializeFieldUpdatedValue,
  shouldSkipRealtimeBatchMutation,
} from '@teable/v2-core';
import type { IExecutionContext, IEventHandler, DomainError, Result } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ShareDbService } from '../../share-db/share-db.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

export interface IActionTriggerData {
  actionKey: ITableActionKey | IViewActionKey;
  payload?: Record<string, unknown>;
}

interface IActionTriggerSink {
  submit(targetId: string, data: IActionTriggerData[]): void;
}

type IPendingActionTriggerBatch = {
  sink: IActionTriggerSink;
  targetId: string;
  data: IActionTriggerData[];
};

class ShareDbActionTriggerSink implements IActionTriggerSink {
  constructor(private readonly shareDbService: ShareDbService) {}

  submit(targetId: string, data: IActionTriggerData[]): void {
    const channel = getActionTriggerChannel(targetId);
    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(targetId);
    localPresence.submit(data, (error) => {
      if (error) console.error('Action trigger error:', error);
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value instanceof Object && !Array.isArray(value);

const setValueAtPath = (
  target: Record<string, unknown>,
  path: ReadonlyArray<string>,
  value: unknown
) => {
  if (path.length === 0) {
    return;
  }

  let current = target;
  for (const segment of path.slice(0, -1)) {
    const nested = current[segment];
    if (!isRecord(nested)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  current[path[path.length - 1] as string] = value;
};

const buildUpdatedFieldPatch = (event: FieldUpdated): Record<string, unknown> => {
  const patch: Record<string, unknown> = {
    id: event.fieldId.toString(),
    updatedProperties: [...event.updatedProperties],
  };

  for (const property of event.updatedProperties) {
    const change = event.changes[property];
    if (!change) {
      continue;
    }

    setValueAtPath(
      patch,
      event.presencePathFor(property),
      serializeFieldUpdatedValue(change.newValue)
    );
  }

  return patch;
};

const collectChangedFieldIds = (updates: RecordsBatchUpdated['updates']): string[] => {
  const fieldIds = new Set<string>();

  for (const update of updates) {
    for (const change of update.changes) {
      fieldIds.add(change.fieldId);
    }
  }

  return [...fieldIds];
};

/**
 * Helper to emit action triggers via ShareDB presence.
 * Batches actions per table to avoid later submits overwriting earlier ones
 * within the same schema update turn.
 */
const pendingActionTriggerBatches = new Map<string, IPendingActionTriggerBatch>();
let flushScheduled = false;

const deferFlush = (flush: () => void) => {
  if (typeof setImmediate === 'function') {
    setImmediate(flush);
    return;
  }
  setTimeout(flush, 0);
};

const flushPendingActionTriggers = () => {
  flushScheduled = false;
  const batches = [...pendingActionTriggerBatches.values()];
  pendingActionTriggerBatches.clear();

  for (const batch of batches) {
    batch.sink.submit(batch.targetId, batch.data);
  }
};

const emitActionTrigger = (
  sink: IActionTriggerSink,
  targetId: string,
  data: IActionTriggerData[]
) => {
  const pending = pendingActionTriggerBatches.get(targetId) ?? {
    sink,
    targetId,
    data: [],
  };
  pending.data.push(...data);
  pendingActionTriggerBatches.set(targetId, pending);

  if (!flushScheduled) {
    flushScheduled = true;
    deferFlush(flushPendingActionTriggers);
  }
};

/**
 * V2 projection handler that emits action triggers for record create events.
 * This keeps realtime clients informed about record changes such as row-count refreshes.
 */
@ProjectionHandler(RecordCreated)
class V2RecordCreatedActionTriggerProjection implements IEventHandler<RecordCreated> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: RecordCreated
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      { actionKey: 'addRecord' },
    ]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for batch record create events.
 */
@ProjectionHandler(RecordsBatchCreated)
class V2RecordsBatchCreatedActionTriggerProjection implements IEventHandler<RecordsBatchCreated> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: RecordsBatchCreated
  ): Promise<Result<void, DomainError>> {
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.records.length;
    const skipRealtime = shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration);

    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      {
        actionKey: 'addRecord',
        payload: skipRealtime
          ? {
              tableId: event.tableId.toString(),
              recordIds: event.records.map((record) => record.recordId),
              skipRealtime: true,
              operationId: orchestration?.operationId,
              groupId: orchestration?.groupId,
              totalRecordCount,
              totalChunkCount: orchestration?.totalChunkCount,
              chunkIndex: orchestration?.chunkIndex,
              scope: orchestration?.scope,
            }
          : undefined,
      },
    ]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for record update events.
 */
@ProjectionHandler(RecordUpdated)
class V2RecordUpdatedActionTriggerProjection implements IEventHandler<RecordUpdated> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    const fieldIds = event.changes.map((c) => c.fieldId);
    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      { actionKey: 'setRecord', payload: { fieldIds } },
    ]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for batch record update events.
 */
@ProjectionHandler(RecordsBatchUpdated)
class V2RecordsBatchUpdatedActionTriggerProjection implements IEventHandler<RecordsBatchUpdated> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.updates.length;

    if (shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration)) {
      const fieldIds = collectChangedFieldIds(event.updates);
      emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
        {
          actionKey: 'setRecord',
          payload: {
            tableId: event.tableId.toString(),
            fieldIds,
            recordIds: event.updates.map((update) => update.recordId),
            skipRealtime: true,
            operationId: orchestration?.operationId,
            groupId: orchestration?.groupId,
            totalRecordCount,
            totalChunkCount: orchestration?.totalChunkCount,
            chunkIndex: orchestration?.chunkIndex,
            scope: orchestration?.scope,
          },
        },
      ]);
      return ok(undefined);
    }

    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      { actionKey: 'setRecord', payload: { fieldIds: collectChangedFieldIds(event.updates) } },
    ]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for record reorder events.
 */
@ProjectionHandler(RecordReordered)
class V2RecordReorderedActionTriggerProjection implements IEventHandler<RecordReordered> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: RecordReordered
  ): Promise<Result<void, DomainError>> {
    // reorder changes row order only — the explicit empty fieldIds tells
    // field-aware listeners (row count, aggregations) that no cell value
    // changed, so they can skip refreshing
    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      { actionKey: 'setRecord', payload: { fieldIds: [] } },
    ]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for record delete events.
 */
@ProjectionHandler(RecordsDeleted)
class V2RecordsDeletedActionTriggerProjection implements IEventHandler<RecordsDeleted> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.recordIds.length;
    const skipRealtime = shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration);
    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      {
        actionKey: 'deleteRecord',
        payload: skipRealtime
          ? {
              tableId: event.tableId.toString(),
              recordIds: event.recordIds.map((recordId) => recordId.toString()),
              skipRealtime: true,
              operationId: orchestration?.operationId,
              groupId: orchestration?.groupId,
              totalRecordCount,
              totalChunkCount: orchestration?.totalChunkCount,
              chunkIndex: orchestration?.chunkIndex,
              scope: orchestration?.scope,
            }
          : undefined,
      },
    ]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for field create events.
 */
@ProjectionHandler(FieldCreated)
class V2FieldCreatedActionTriggerProjection implements IEventHandler<FieldCreated> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: FieldCreated
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      {
        actionKey: 'addField',
        payload: {
          tableId: event.tableId.toString(),
          field: {
            id: event.fieldId.toString(),
          },
        },
      },
      // Trigger schema-driven record query refresh for the newly added field.
      {
        actionKey: 'setRecord',
        payload: {
          tableId: event.tableId.toString(),
          fieldIds: [event.fieldId.toString()],
        },
      },
    ]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for field delete events.
 */
@ProjectionHandler(FieldDeleted)
class V2FieldDeletedActionTriggerProjection implements IEventHandler<FieldDeleted> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: FieldDeleted
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      {
        actionKey: 'deleteField',
        payload: {
          tableId: event.tableId.toString(),
          fieldId: event.fieldId.toString(),
        },
      },
    ]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for field update events.
 */
@ProjectionHandler(FieldUpdated)
class V2FieldUpdatedActionTriggerProjection implements IEventHandler<FieldUpdated> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: FieldUpdated
  ): Promise<Result<void, DomainError>> {
    if (!event.mayRequirePresence()) {
      return ok(undefined);
    }

    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      {
        actionKey: 'setField',
        payload: {
          tableId: event.tableId.toString(),
          field: buildUpdatedFieldPatch(event),
        },
      },
    ]);
    return ok(undefined);
  }
}

@ProjectionHandler(ViewFilterUpdated)
class V2ViewFilterUpdatedActionTriggerProjection implements IEventHandler<ViewFilterUpdated> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: ViewFilterUpdated
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.actionTriggerSink, event.viewId.toString(), [
      { actionKey: 'applyViewFilter' },
    ]);
    return ok(undefined);
  }
}

@ProjectionHandler(ViewGroupUpdated)
class V2ViewGroupUpdatedActionTriggerProjection implements IEventHandler<ViewGroupUpdated> {
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: ViewGroupUpdated
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.actionTriggerSink, event.viewId.toString(), [
      { actionKey: 'applyViewGroup' },
    ]);
    return ok(undefined);
  }
}

@ProjectionHandler(ViewColumnMetaUpdated)
class V2ViewColumnMetaUpdatedActionTriggerProjection
  implements IEventHandler<ViewColumnMetaUpdated>
{
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: ViewColumnMetaUpdated
  ): Promise<Result<void, DomainError>> {
    const actions: IActionTriggerData[] = [];
    for (const change of event.changes ?? []) {
      const previous = change.previousColumnMeta;
      const next = change.nextColumnMeta;
      if (!next.hidden && previous?.hidden !== next.hidden) {
        actions.push({ actionKey: 'showViewField' });
      }
      if (previous?.statisticFunc !== next.statisticFunc) {
        actions.push({ actionKey: 'applyViewStatisticFunc' });
      }
    }
    if (actions.length > 0) {
      emitActionTrigger(this.actionTriggerSink, event.viewId.toString(), actions);
    }
    return ok(undefined);
  }
}

@ProjectionHandler(TableActionTriggerRequested)
class V2TableActionTriggerRequestedProjection
  implements IEventHandler<TableActionTriggerRequested>
{
  constructor(private readonly actionTriggerSink: IActionTriggerSink) {}

  async handle(
    _context: IExecutionContext,
    event: TableActionTriggerRequested
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.actionTriggerSink, event.tableId.toString(), [
      {
        actionKey: event.actionKey,
        ...(event.payload ? { payload: event.payload } : {}),
      },
    ]);
    return ok(undefined);
  }
}

/**
 * Service that registers V2 action trigger projections with the V2 container.
 * The projections target a narrow sink port; the Nest adapter owns ShareDB integration.
 */
@V2ProjectionRegistrar()
@Injectable()
export class V2ActionTriggerService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2ActionTriggerService.name);

  constructor(private readonly shareDbService: ShareDbService) {}

  /**
   * Register action trigger projections with the V2 container.
   * Call this after the V2 container is created.
   */
  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 action trigger projections');

    const actionTriggerSink = new ShareDbActionTriggerSink(this.shareDbService);

    // Register projection instances directly since they depend on NestJS ShareDbService
    container.registerInstance(
      V2RecordCreatedActionTriggerProjection,
      new V2RecordCreatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2RecordsBatchCreatedActionTriggerProjection,
      new V2RecordsBatchCreatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2RecordUpdatedActionTriggerProjection,
      new V2RecordUpdatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2RecordsBatchUpdatedActionTriggerProjection,
      new V2RecordsBatchUpdatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2RecordReorderedActionTriggerProjection,
      new V2RecordReorderedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2RecordsDeletedActionTriggerProjection,
      new V2RecordsDeletedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2FieldCreatedActionTriggerProjection,
      new V2FieldCreatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2FieldDeletedActionTriggerProjection,
      new V2FieldDeletedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2FieldUpdatedActionTriggerProjection,
      new V2FieldUpdatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2ViewFilterUpdatedActionTriggerProjection,
      new V2ViewFilterUpdatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2ViewGroupUpdatedActionTriggerProjection,
      new V2ViewGroupUpdatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2ViewColumnMetaUpdatedActionTriggerProjection,
      new V2ViewColumnMetaUpdatedActionTriggerProjection(actionTriggerSink)
    );

    container.registerInstance(
      V2TableActionTriggerRequestedProjection,
      new V2TableActionTriggerRequestedProjection(actionTriggerSink)
    );
  }
}
