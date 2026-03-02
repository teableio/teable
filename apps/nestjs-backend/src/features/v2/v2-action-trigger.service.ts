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
  ProjectionHandler,
  ok,
} from '@teable/v2-core';
import type { IExecutionContext, IEventHandler, DomainError, Result } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ShareDbService } from '../../share-db/share-db.service';

export interface IActionTriggerData {
  actionKey: ITableActionKey;
  payload?: Record<string, unknown>;
}

const serializeActionTriggerValue = (value: unknown): unknown => {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeActionTriggerValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Object) {
    if ('toDto' in value && typeof value.toDto === 'function') {
      return serializeActionTriggerValue(value.toDto());
    }

    if ('value' in value && typeof value.value === 'function') {
      return serializeActionTriggerValue(value.value());
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serializeActionTriggerValue(nested)])
    );
  }

  return value;
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

    patch[property] = serializeActionTriggerValue(change.newValue);
  }

  return patch;
};

/**
 * Helper to emit action triggers via ShareDB presence.
 */
const emitActionTrigger = (
  shareDbService: ShareDbService,
  tableId: string,
  data: IActionTriggerData[]
) => {
  const channel = getActionTriggerChannel(tableId);
  const presence = shareDbService.connect().getPresence(channel);
  const localPresence = presence.create(tableId);
  localPresence.submit(data, (error) => {
    if (error) console.error('Action trigger error:', error);
  });
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
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [{ actionKey: 'addRecord' }]);
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
    emitActionTrigger(this.shareDbService, event.tableId.toString(), [
      { actionKey: 'deleteRecord' },
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
      // Trigger clients to refresh record cells for newly backfilled field values.
      { actionKey: 'setRecord' },
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
    // Keep behavior aligned with v1 listener: only notify field updates that affect options/type.
    if (!event.hasPropertyUpdate('options') && !event.hasPropertyUpdate('type')) {
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

/**
 * Service that registers V2 action trigger projections with the V2 container.
 * These projections emit ShareDB presence events for V1 frontend compatibility.
 */
@Injectable()
export class V2ActionTriggerService {
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
  }
}
