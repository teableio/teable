import { Injectable } from '@nestjs/common';
import {
  ok,
  ProjectionHandler,
  RecordCreated,
  RecordsBatchCreated,
  RecordUpdated,
  RecordsBatchUpdated,
  RecordsDeleted,
  scheduleExecutionContextBackgroundTask,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type RecordFieldChangeDTO,
  type RecordFieldValueDTO,
  type RecordValuesDTO,
  type Result,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import {
  SSA_MAX_CELL_CONTEXTS,
  SSA_MAX_SAMPLE_RECORDS,
  SsaEventForwarder,
} from './ssa-event-forwarder';
import type { ISsaRecordEvent, ISsaSampleRecord } from './ssa-event-forwarder';

const SSA_SOURCE_NAME = 'SsaEventForwardingProjection';

const isUndoRedoReplay = (context: IExecutionContext): boolean =>
  context.undoRedo?.mode === 'undo' || context.undoRedo?.mode === 'redo';

const actorToUser = (context: IExecutionContext): ISsaRecordEvent['user'] => {
  const actorId = context.actorId?.toString();
  return actorId ? { id: actorId } : undefined;
};

const fieldValuesToObject = (
  fieldValues: ReadonlyArray<RecordFieldValueDTO>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const fieldValue of fieldValues) {
    result[fieldValue.fieldId] = fieldValue.value;
  }
  return result;
};

const changesToCellContexts = (changes: ReadonlyArray<RecordFieldChangeDTO>) =>
  changes.slice(0, SSA_MAX_CELL_CONTEXTS).map((change) => ({
    fieldId: change.fieldId,
    oldValue: change.oldValue,
    newValue: change.newValue,
  }));

const sourceName = (source: unknown): string | undefined => {
  if (typeof source === 'string') {
    return source;
  }
  if (source && typeof source === 'object' && 'type' in source) {
    const type = (source as { type?: unknown }).type;
    return typeof type === 'string' ? type : undefined;
  }
  return undefined;
};

const buildSample = (id: string, fields: Record<string, unknown>): ISsaSampleRecord => ({
  id,
  fields,
});

/**
 * V2 domain-event dispatcher: converts record domain events into the same
 * canonical `ISsaRecordEvent` payloads the v1 listeners produce, and hands
 * them to the shared forwarder (which suppresses duplicates).
 */
@Injectable()
export class V2SsaEventDispatcher {
  constructor(private readonly forwarder: SsaEventForwarder) {}

  private schedule(
    context: IExecutionContext,
    task: () => Promise<void>,
    _eventType: string
  ): void {
    scheduleExecutionContextBackgroundTask(context, async () => {
      try {
        await task();
      } catch {
        // The forwarder logs its own failures; projection tasks must stay silent.
      }
    });
  }

  onRecordCreated(context: IExecutionContext, event: RecordCreated): Result<void, DomainError> {
    if (isUndoRedoReplay(context)) {
      return ok(undefined);
    }
    this.schedule(
      context,
      () =>
        this.forwarder.forward({
          version: 1,
          event: 'record.created',
          tableId: event.tableId.toString(),
          recordIds: [event.recordId.toString()],
          recordCount: 1,
          isBulk: false,
          truncated: false,
          user: actorToUser(context),
          timestamp: new Date().toISOString(),
          source: sourceName(event.source),
          records: [buildSample(event.recordId.toString(), fieldValuesToObject(event.fieldValues))],
        }),
      `${SSA_SOURCE_NAME}:record.created`
    );
    return ok(undefined);
  }

  onRecordsBatchCreated(
    context: IExecutionContext,
    event: RecordsBatchCreated
  ): Result<void, DomainError> {
    if (isUndoRedoReplay(context)) {
      return ok(undefined);
    }
    const records = event.records.map((record: RecordValuesDTO) =>
      buildSample(record.recordId, fieldValuesToObject(record.fields))
    );
    this.schedule(
      context,
      () =>
        this.forwarder.forward({
          version: 1,
          event: 'record.created',
          tableId: event.tableId.toString(),
          recordIds: records.map((record) => record.id),
          recordCount: records.length,
          isBulk: records.length > 1,
          truncated: records.length > SSA_MAX_SAMPLE_RECORDS,
          user: actorToUser(context),
          timestamp: new Date().toISOString(),
          source: sourceName(event.source),
          records: records.slice(0, SSA_MAX_SAMPLE_RECORDS),
        }),
      `${SSA_SOURCE_NAME}:record.created`
    );
    return ok(undefined);
  }

  onRecordUpdated(context: IExecutionContext, event: RecordUpdated): Result<void, DomainError> {
    if (isUndoRedoReplay(context)) {
      return ok(undefined);
    }
    const cellContexts = changesToCellContexts(event.changes);
    this.schedule(
      context,
      () =>
        this.forwarder.forward({
          version: 1,
          event: 'record.updated',
          tableId: event.tableId.toString(),
          recordIds: [event.recordId.toString()],
          recordCount: 1,
          isBulk: false,
          truncated: event.changes.length > SSA_MAX_CELL_CONTEXTS,
          user: actorToUser(context),
          timestamp: new Date().toISOString(),
          source: sourceName(event.source),
          changes: {
            fieldIds: event.changes.map((change) => change.fieldId),
            cellContexts,
          },
        }),
      `${SSA_SOURCE_NAME}:record.updated`
    );
    return ok(undefined);
  }

  onRecordsBatchUpdated(
    context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Result<void, DomainError> {
    if (isUndoRedoReplay(context)) {
      return ok(undefined);
    }
    const recordIds = event.updates.map((update) => update.recordId);
    const fieldIds = [
      ...new Set(event.updates.flatMap((update) => update.changes.map((change) => change.fieldId))),
    ];
    const cellContexts = event.updates
      .flatMap((update) =>
        changesToCellContexts(update.changes).map((change) => ({
          recordId: update.recordId,
          ...change,
        }))
      )
      .slice(0, SSA_MAX_CELL_CONTEXTS);

    this.schedule(
      context,
      () =>
        this.forwarder.forward({
          version: 1,
          event: 'record.updated',
          tableId: event.tableId.toString(),
          recordIds,
          recordCount: recordIds.length,
          isBulk: recordIds.length > 1,
          truncated: cellContexts.length >= SSA_MAX_CELL_CONTEXTS,
          user: actorToUser(context),
          timestamp: new Date().toISOString(),
          source: sourceName(event.source),
          changes: { fieldIds, cellContexts },
        }),
      `${SSA_SOURCE_NAME}:record.updated`
    );
    return ok(undefined);
  }

  onRecordsDeleted(context: IExecutionContext, event: RecordsDeleted): Result<void, DomainError> {
    const recordIds = event.recordIds.map((recordId) => recordId.toString());
    this.schedule(
      context,
      () =>
        this.forwarder.forward({
          version: 1,
          event: 'record.deleted',
          tableId: event.tableId.toString(),
          recordIds,
          recordCount: recordIds.length,
          isBulk: recordIds.length > 1,
          truncated: false,
          user: actorToUser(context),
          timestamp: new Date().toISOString(),
        }),
      `${SSA_SOURCE_NAME}:record.deleted`
    );
    return ok(undefined);
  }
}

@ProjectionHandler(RecordCreated)
class V2SsaRecordCreatedProjection implements IEventHandler<RecordCreated> {
  constructor(private readonly dispatcher: V2SsaEventDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordCreated
  ): Promise<Result<void, DomainError>> {
    return this.dispatcher.onRecordCreated(context, event);
  }
}

@ProjectionHandler(RecordsBatchCreated)
class V2SsaRecordsBatchCreatedProjection implements IEventHandler<RecordsBatchCreated> {
  constructor(private readonly dispatcher: V2SsaEventDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchCreated
  ): Promise<Result<void, DomainError>> {
    return this.dispatcher.onRecordsBatchCreated(context, event);
  }
}

@ProjectionHandler(RecordUpdated)
class V2SsaRecordUpdatedProjection implements IEventHandler<RecordUpdated> {
  constructor(private readonly dispatcher: V2SsaEventDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    return this.dispatcher.onRecordUpdated(context, event);
  }
}

@ProjectionHandler(RecordsBatchUpdated)
class V2SsaRecordsBatchUpdatedProjection implements IEventHandler<RecordsBatchUpdated> {
  constructor(private readonly dispatcher: V2SsaEventDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    return this.dispatcher.onRecordsBatchUpdated(context, event);
  }
}

@ProjectionHandler(RecordsDeleted)
class V2SsaRecordsDeletedProjection implements IEventHandler<RecordsDeleted> {
  constructor(private readonly dispatcher: V2SsaEventDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    return this.dispatcher.onRecordsDeleted(context, event);
  }
}

/**
 * Registers the SSA projections into the V2 container. Discovered app-wide via
 * `DiscoveryService`, so no edit to `features/v2/v2.module.ts` is required.
 */
@V2ProjectionRegistrar()
export class V2SsaProjectionRegistrar implements IV2ProjectionRegistrar {
  constructor(private readonly dispatcher: V2SsaEventDispatcher) {}

  registerProjections(container: DependencyContainer): void {
    container
      .registerInstance(
        V2SsaRecordCreatedProjection,
        new V2SsaRecordCreatedProjection(this.dispatcher)
      )
      .registerInstance(
        V2SsaRecordsBatchCreatedProjection,
        new V2SsaRecordsBatchCreatedProjection(this.dispatcher)
      )
      .registerInstance(
        V2SsaRecordUpdatedProjection,
        new V2SsaRecordUpdatedProjection(this.dispatcher)
      )
      .registerInstance(
        V2SsaRecordsBatchUpdatedProjection,
        new V2SsaRecordsBatchUpdatedProjection(this.dispatcher)
      )
      .registerInstance(
        V2SsaRecordsDeletedProjection,
        new V2SsaRecordsDeletedProjection(this.dispatcher)
      );
  }
}
