import { Injectable, Logger } from '@nestjs/common';
import { getActionTriggerChannel } from '@teable/core';
import type { ITableActionKey } from '@teable/core';
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
  actionKey: ITableActionKey;
  payload?: Record<string, unknown>;
}

type IPendingActionTriggerBatch = {
  shareDbService: ShareDbService;
  tableId: string;
  data: IActionTriggerData[];
};

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
    const channel = getActionTriggerChannel(batch.tableId);
    const presence = batch.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(batch.tableId);
    localPresence.submit(batch.data, (error) => {
      if (error) console.error('Action trigger error:', error);
    });
  }
};

const emitActionTrigger = (
  shareDbService: ShareDbService,
  tableId: string,
  data: IActionTriggerData[]
) => {
  const pending = pendingActionTriggerBatches.get(tableId) ?? {
    shareDbService,
    tableId,
    data: [],
  };
  pending.data.push(...data);
  pendingActionTriggerBatches.set(tableId, pending);

  if (!flushScheduled) {
    flushScheduled = true;
    deferFlush(flushPendingActionTriggers);
  }
};

/**
 * V2 projection handler that emits action triggers for record create events.
 * This enables V1 frontend features like row count refresh.
 */
@ProjectionHandler(RecordCreated)
class V2RecordCreatedActionTriggerProjection implements IEventHandler<RecordCreated> {
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: RecordCreated
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [{ actionKey: 'addRecord' }]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for batch record create events.
 */
@ProjectionHandler(RecordsBatchCreated)
class V2RecordsBatchCreatedActionTriggerProjection implements IEventHandler<RecordsBatchCreated> {
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: RecordsBatchCreated
  ): Promise<Result<void, DomainError>> {
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.records.length;
    const skipRealtime = shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration);

    emitActionTrigger(this.shareDbService, event.tableId.toString(), [
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
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [{ actionKey: 'setRecord' }]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for batch record update events.
 */
@ProjectionHandler(RecordsBatchUpdated)
class V2RecordsBatchUpdatedActionTriggerProjection implements IEventHandler<RecordsBatchUpdated> {
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.updates.length;

    if (shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration)) {
      const fieldIds = collectChangedFieldIds(event.updates);
      emitActionTrigger(this.shareDbService, event.tableId.toString(), [
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

    emitActionTrigger(this.shareDbService, event.tableId.toString(), [{ actionKey: 'setRecord' }]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for record reorder events.
 */
@ProjectionHandler(RecordReordered)
class V2RecordReorderedActionTriggerProjection implements IEventHandler<RecordReordered> {
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: RecordReordered
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [{ actionKey: 'setRecord' }]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that emits action triggers for record delete events.
 */
@ProjectionHandler(RecordsDeleted)
class V2RecordsDeletedActionTriggerProjection implements IEventHandler<RecordsDeleted> {
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.recordIds.length;
    const skipRealtime = shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration);
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [
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
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: FieldCreated
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [
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
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: FieldDeleted
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [
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
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: FieldUpdated
  ): Promise<Result<void, DomainError>> {
    if (!event.mayRequirePresence()) {
      return ok(undefined);
    }

    emitActionTrigger(this.shareDbService, event.tableId.toString(), [
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

@ProjectionHandler(TableActionTriggerRequested)
class V2TableActionTriggerRequestedProjection
  implements IEventHandler<TableActionTriggerRequested>
{
  constructor(private readonly shareDbService: ShareDbService) {}

  async handle(
    _context: IExecutionContext,
    event: TableActionTriggerRequested
  ): Promise<Result<void, DomainError>> {
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [
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
 * These projections emit ShareDB presence events for V1 frontend compatibility.
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

    const shareDbService = this.shareDbService;

    // Register projection instances directly since they depend on NestJS ShareDbService
    container.registerInstance(
      V2RecordCreatedActionTriggerProjection,
      new V2RecordCreatedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2RecordsBatchCreatedActionTriggerProjection,
      new V2RecordsBatchCreatedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2RecordUpdatedActionTriggerProjection,
      new V2RecordUpdatedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2RecordsBatchUpdatedActionTriggerProjection,
      new V2RecordsBatchUpdatedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2RecordReorderedActionTriggerProjection,
      new V2RecordReorderedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2RecordsDeletedActionTriggerProjection,
      new V2RecordsDeletedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2FieldCreatedActionTriggerProjection,
      new V2FieldCreatedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2FieldDeletedActionTriggerProjection,
      new V2FieldDeletedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2FieldUpdatedActionTriggerProjection,
      new V2FieldUpdatedActionTriggerProjection(shareDbService)
    );

    container.registerInstance(
      V2TableActionTriggerRequestedProjection,
      new V2TableActionTriggerRequestedProjection(shareDbService)
    );
  }
}
